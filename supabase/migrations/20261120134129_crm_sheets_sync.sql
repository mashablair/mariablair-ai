begin;

-- A deployment is paired to one reviewed Sheet. The database stores only a digest of its ID.
create table public.crm_sheets_sync_connection (
  connection_key text primary key check (connection_key ~ '^[0-9a-f]{64}$'),
  singleton boolean unique not null default true check (singleton),
  lease_token uuid,
  lease_until timestamptz,
  baseline jsonb not null default '[]'::jsonb,
  check ((lease_token is null) = (lease_until is null)),
  check (jsonb_typeof(baseline) = 'array' and octet_length(baseline::text) <= 4000000)
);
create table public.crm_sheets_sync_links (
  connection_key text not null references public.crm_sheets_sync_connection(connection_key),
  kind text not null check (kind in ('contacts','tasks')),
  external_id text not null check (length(external_id) between 1 and 100 and external_id = btrim(external_id)
    and external_id !~ '[[:cntrl:]:]'),
  app_id uuid not null,
  primary key (connection_key, kind, external_id),
  unique (connection_key, kind, app_id)
);
create table public.crm_sheets_sync_previews (
  connection_key text not null references public.crm_sheets_sync_connection(connection_key),
  id uuid not null,
  expires_at timestamptz not null,
  body jsonb not null check (octet_length(body::text) <= 12000000),
  primary key (connection_key,id)
);
create table public.crm_sheets_sync_receipts (
  connection_key text not null references public.crm_sheets_sync_connection(connection_key),
  id uuid not null,
  phase text not null check (phase in ('prepared','needs_review','complete')),
  body jsonb not null check (octet_length(body::text) <= 24000000),
  links jsonb not null,
  app_written boolean not null default false,
  completed_at timestamptz,
  primary key (connection_key,id)
);
create unique index crm_sheets_sync_one_pending on public.crm_sheets_sync_receipts(connection_key)
  where phase <> 'complete';

alter table public.crm_sheets_sync_connection enable row level security;
alter table public.crm_sheets_sync_links enable row level security;
alter table public.crm_sheets_sync_previews enable row level security;
alter table public.crm_sheets_sync_receipts enable row level security;
revoke all on public.crm_sheets_sync_connection, public.crm_sheets_sync_links,
  public.crm_sheets_sync_previews, public.crm_sheets_sync_receipts from public, anon, authenticated, service_role;
grant select, update on public.crm_sheets_sync_connection to service_role;
grant select on public.crm_sheets_sync_links to service_role;
grant select, insert, delete on public.crm_sheets_sync_previews to service_role;
grant select, insert, update, delete on public.crm_sheets_sync_receipts to service_role;

-- Manual link changes serialize with the lease and are blocked until pending writes are resolved.
create function public.crm_sheets_sync_guard_links() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_connection text := case when tg_op = 'INSERT' then new.connection_key else old.connection_key end;
  v_until timestamptz;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Sync links are append only; use a reviewed maintenance migration to remap';
  end if;
  select lease_until into v_until from public.crm_sheets_sync_connection where connection_key=v_connection for update;
  if v_until > clock_timestamp() or exists (select 1 from public.crm_sheets_sync_receipts
    where connection_key=v_connection and phase <> 'complete') then
    raise exception 'Link changes blocked during sync or recovery';
  end if;
  return new;
end $$;
revoke all on function public.crm_sheets_sync_guard_links() from public, anon, authenticated;
create trigger crm_sheets_sync_guard_links before insert or update or delete on public.crm_sheets_sync_links
  for each row execute function public.crm_sheets_sync_guard_links();

-- Read only allowlisted CRM columns. Link IDs are not editable through the sync RPC.
create function public.crm_sheets_sync_snapshot(p_connection text) returns jsonb
language plpgsql security invoker stable set search_path = '' as $$
declare
  v_app jsonb;
  v_links jsonb;
begin
  if (select count(*) from public.crm_sheets_sync_links as l where l.connection_key = p_connection) > 2000 then
    raise exception 'Sync link limit exceeded';
  end if;
  if exists (
    select 1 from public.crm_sheets_sync_links l
    join public.tasks t on l.kind = 'tasks' and t.id = l.app_id
    where l.connection_key = p_connection and t.contact_id is not null
      and not exists (select 1 from public.crm_sheets_sync_links c
        where c.connection_key = p_connection and c.kind = 'contacts' and c.app_id = t.contact_id)
  ) then
    raise exception 'A linked follow-up has an unlinked app contact';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',l.kind,'id',l.external_id,'appId',l.app_id)
     order by l.kind, l.external_id collate "C"), '[]'::jsonb) into v_links
  from public.crm_sheets_sync_links l where l.connection_key = p_connection;
  select coalesce(jsonb_agg(projected.item order by projected.kind, projected.external_id collate "C"), '[]'::jsonb)
    into v_app
  from (
    select l.kind, l.external_id,
      jsonb_build_object('kind',l.kind,'id',l.external_id,'fields',jsonb_build_object(
        'name','','source',coalesce(c.source,''),'next_action',coalesce(c.next_action,''),
        'follow_up_date',coalesce(to_char(c.follow_up_date,'YYYY-MM-DD'),''))) as item
    from public.crm_sheets_sync_links l join public.contacts c on l.kind = 'contacts' and c.id = l.app_id
    where l.connection_key = p_connection
    union all
    select l.kind, l.external_id,
      jsonb_build_object('kind',l.kind,'id',l.external_id,'fields',jsonb_build_object(
        'title',t.title,'due_date',coalesce(to_char(t.due_date,'YYYY-MM-DD'),''),
        'contact_id',coalesce(c.external_id,''),'status','open'))
    from public.crm_sheets_sync_links l join public.tasks t on l.kind = 'tasks' and t.id = l.app_id
    left join public.crm_sheets_sync_links c on c.connection_key = l.connection_key
      and c.kind = 'contacts' and c.app_id = t.contact_id
    where l.connection_key = p_connection
  ) as projected;
  if octet_length(v_app::text) > 4000000 then raise exception 'Sync snapshot byte limit exceeded'; end if;
  return jsonb_build_object('app',v_app,'links',v_links,
    'binding',encode(sha256(convert_to(v_links::text,'UTF8')),'hex'));
end $$;

-- Compare JSON arrays as sets of complete records, including field values and immutable IDs.
create function public.crm_sheets_sync_sorted(p_records jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(r order by (r->>'kind') collate "C", (r->>'id') collate "C"), '[]'::jsonb)
  from jsonb_array_elements(p_records) r
$$;
revoke all on function public.crm_sheets_sync_snapshot(text), public.crm_sheets_sync_sorted(jsonb)
  from public, anon, authenticated;
grant execute on function public.crm_sheets_sync_snapshot(text), public.crm_sheets_sync_sorted(jsonb) to service_role;

create function public.crm_sheets_sync(p_connection text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_state public.crm_sheets_sync_connection%rowtype;
  v_receipt public.crm_sheets_sync_receipts%rowtype;
  v_id uuid;
  v_token uuid;
  v_body jsonb;
  v_snapshot jsonb;
  v_current jsonb;
  v_target jsonb;
  v_before jsonb;
  v_fields jsonb;
  v_change jsonb;
  v_next jsonb;
  v_link public.crm_sheets_sync_links%rowtype;
  v_expires timestamptz;
begin
  if p_action is null or p_connection is null or p_connection !~ '^[0-9a-f]{64}$'
    or p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 24000000 then
    raise exception 'Invalid sync request';
  end if;
  if p_action in ('read','pending','preview_get','receipt_get') then
    select * into v_state from public.crm_sheets_sync_connection where connection_key = p_connection;
  else
    select * into v_state from public.crm_sheets_sync_connection where connection_key = p_connection for update;
  end if;
  if not found then raise exception 'Sync connection is not provisioned'; end if;

  if p_action = 'read' then
    return public.crm_sheets_sync_snapshot(p_connection) || jsonb_build_object('baseline',v_state.baseline,
      'unlinkedApp', (select count(*) from public.contacts c where not exists (
          select 1 from public.crm_sheets_sync_links l where l.connection_key=p_connection and l.kind='contacts' and l.app_id=c.id))
        + (select count(*) from public.tasks t where not exists (
          select 1 from public.crm_sheets_sync_links l where l.connection_key=p_connection and l.kind='tasks' and l.app_id=t.id)));
  elsif p_action = 'pending' then
    select body into v_body from public.crm_sheets_sync_receipts where connection_key=p_connection and phase <> 'complete';
    return v_body;
  elsif p_action = 'receipt_get' then
    select body into v_body from public.crm_sheets_sync_receipts where connection_key=p_connection and id=(p_args->>'id')::uuid;
    return v_body;
  elsif p_action = 'preview_get' then
    select body into v_body from public.crm_sheets_sync_previews where connection_key=p_connection and id=(p_args->>'id')::uuid;
    return v_body;
  elsif p_action = 'preview_put' then
    delete from public.crm_sheets_sync_previews where connection_key=p_connection and expires_at < clock_timestamp();
    if (select count(*) from public.crm_sheets_sync_previews where connection_key=p_connection) >= 32 then
      raise exception 'Too many active sync previews';
    end if;
    v_body := p_args->'preview';
    v_expires := to_timestamp((v_body->>'expiresAt')::double precision / 1000);
    if v_expires is null or v_expires <= clock_timestamp() or v_expires > clock_timestamp() + interval '11 minutes'
      or nullif(v_body->>'owner','') is null then raise exception 'Invalid sync preview'; end if;
    insert into public.crm_sheets_sync_previews(connection_key,id,expires_at,body)
    values (p_connection,(v_body->>'id')::uuid,v_expires,v_body);
    return null;
  end if;

  v_token := (p_args->>'token')::uuid;
  if v_token is null then raise exception 'Missing sync lease token'; end if;
  if p_action = 'acquire' then
    if v_state.lease_until > clock_timestamp() then return 'false'::jsonb; end if;
    update public.crm_sheets_sync_connection set lease_token=v_token, lease_until=clock_timestamp()+interval '2 minutes'
      where connection_key=p_connection;
    return 'true'::jsonb;
  elsif p_action = 'release' then
    update public.crm_sheets_sync_connection set lease_token=null, lease_until=null
      where connection_key=p_connection and lease_token=v_token;
    return null;
  end if;
  if v_state.lease_token is distinct from v_token or v_state.lease_until <= clock_timestamp() then
    raise exception 'Sync lease expired or changed';
  end if;
  if p_action = 'lease_check' then return 'true'::jsonb; end if;

  if p_action = 'receipt_put' then
    v_body := p_args->'receipt';
    v_id := (v_body->>'id')::uuid;
    if v_body->>'phase' = 'prepared' then
      delete from public.crm_sheets_sync_receipts
        where connection_key=p_connection and phase='complete' and completed_at < clock_timestamp()-interval '30 days';
      if (select count(*) from public.crm_sheets_sync_receipts where connection_key=p_connection) >= 256 then
        raise exception 'Sync receipt limit exceeded';
      end if;
      if not exists (select 1 from public.crm_sheets_sync_previews
        where connection_key=p_connection and id=v_id and expires_at >= clock_timestamp()
          and body->>'owner'=v_body->>'owner' and v_body->>'previewId'=v_id::text
          and body->'input'=v_body->'before')
        then raise exception 'Sync preview unavailable'; end if;
      v_snapshot := public.crm_sheets_sync_snapshot(p_connection);
      if v_body#>>'{before,binding}' is distinct from v_snapshot->>'binding'
        or public.crm_sheets_sync_sorted(v_body#>'{before,app}') is distinct from v_snapshot->'app'
        or public.crm_sheets_sync_sorted(v_body#>'{before,baseline}') is distinct from public.crm_sheets_sync_sorted(v_state.baseline)
        then raise exception 'Sync snapshot changed'; end if;
      insert into public.crm_sheets_sync_receipts(connection_key,id,phase,body,links)
        values (p_connection,v_id,'prepared',v_body,v_snapshot->'links');
    elsif v_body->>'phase' = 'needs_review' then
      update public.crm_sheets_sync_receipts set phase='needs_review', body=jsonb_set(body,'{phase}','"needs_review"')
        where connection_key=p_connection and id=v_id and phase <> 'complete';
      if not found then raise exception 'Sync receipt unavailable'; end if;
    else
      raise exception 'Invalid sync receipt phase';
    end if;
    return null;
  end if;

  if p_action not in ('app_write','complete') then raise exception 'Unknown sync action'; end if;
  v_id := (p_args->>'id')::uuid;
  select * into v_receipt from public.crm_sheets_sync_receipts
    where connection_key=p_connection and id=v_id for update;
  if not found or v_receipt.phase='complete' then raise exception 'Sync receipt unavailable'; end if;

  -- Lock exactly the linked current rows before comparing; concurrent normal CRM writes
  -- cannot slip between the expected-value comparison and the update.
  perform c.id from public.contacts c join public.crm_sheets_sync_links l on c.id=l.app_id
    where l.connection_key=p_connection and l.kind='contacts' order by c.id for update of c;
  perform t.id from public.tasks t join public.crm_sheets_sync_links l on t.id=l.app_id
    where l.connection_key=p_connection and l.kind='tasks' order by t.id for update of t;
  v_snapshot := public.crm_sheets_sync_snapshot(p_connection);
  if v_receipt.links is distinct from v_snapshot->'links'
    or v_receipt.body#>>'{before,binding}' is distinct from v_snapshot->>'binding' then raise exception 'Sync links changed'; end if;
  v_current := v_snapshot->'app';
  v_before := public.crm_sheets_sync_sorted(v_receipt.body#>'{before,app}');
  v_target := public.crm_sheets_sync_sorted(v_receipt.body#>'{target,app}');

  if p_action = 'complete' then
    if v_current is distinct from v_target
      or public.crm_sheets_sync_sorted(v_state.baseline) is distinct from public.crm_sheets_sync_sorted(v_receipt.body#>'{before,baseline}')
      then raise exception 'Sync completion mismatch'; end if;
    update public.crm_sheets_sync_connection set baseline=v_receipt.body#>'{target,baseline}'
      where connection_key=p_connection;
    update public.crm_sheets_sync_receipts set phase='complete', body=jsonb_set(body,'{phase}','"complete"'), completed_at=clock_timestamp()
      where connection_key=p_connection and id=v_id;
    return null;
  end if;

  if v_receipt.app_written or v_receipt.phase <> 'prepared' or v_current is distinct from v_before
    or jsonb_array_length(v_target) <> jsonb_array_length(v_before) then raise exception 'App sync expectations changed'; end if;
  for v_change in select value from jsonb_array_elements(v_before) loop
    select elem into strict v_next from jsonb_array_elements(v_target) elem
      where elem->>'kind'=v_change->>'kind' and elem->>'id'=v_change->>'id';
    if v_next = v_change then continue; end if;
    select * into strict v_link from public.crm_sheets_sync_links
      where connection_key=p_connection and kind=v_change->>'kind' and external_id=v_change->>'id';
    v_fields := v_next->'fields';
    if v_link.kind='contacts' then
      if v_fields - array['source','next_action','follow_up_date'] is distinct from
        (v_change->'fields') - array['source','next_action','follow_up_date'] then raise exception 'Unwritable contact field'; end if;
      update public.contacts set
        source=case when v_fields->>'source' is distinct from v_change#>>'{fields,source}' then nullif(v_fields->>'source','') else source end,
        next_action=case when v_fields->>'next_action' is distinct from v_change#>>'{fields,next_action}' then nullif(v_fields->>'next_action','') else next_action end,
        follow_up_date=nullif(v_fields->>'follow_up_date','')::date
      where id=v_link.app_id;
    else
      if v_fields - array['title','due_date'] is distinct from (v_change->'fields') - array['title','due_date']
        then raise exception 'Unwritable follow-up field'; end if;
      if nullif(btrim(v_fields->>'title'),'') is null then raise exception 'Follow-up title cannot be blank'; end if;
      update public.tasks set title=v_fields->>'title', due_date=nullif(v_fields->>'due_date','')::date where id=v_link.app_id;
    end if;
  end loop;
  if public.crm_sheets_sync_snapshot(p_connection)->'app' is distinct from v_target then
    raise exception 'App sync verification failed';
  end if;
  update public.crm_sheets_sync_receipts set app_written=true where connection_key=p_connection and id=v_id;
  return null;
end $$;

revoke all on function public.crm_sheets_sync(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.crm_sheets_sync(text,text,jsonb) to service_role;
commit;
