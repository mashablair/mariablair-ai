begin;

-- Uploaded CSV is parsed outside Postgres. Store only reviewed projection with a ten-minute apply window.
-- Expired previews and completed count-only receipts older than 30 days are removed during preview creation.
create table public.crm_sheets_bootstrap_previews (
  connection_key text not null references public.crm_sheets_sync_connection(connection_key),
  id uuid not null,
  owner_id uuid not null,
  expires_at timestamptz not null,
  input jsonb,
  expected_plan jsonb,
  result jsonb,
  completed_at timestamptz,
  primary key (connection_key, id),
  check ((completed_at is null and input is not null and expected_plan is not null and result is null)
    or (completed_at is not null and input is null and expected_plan is null and result is not null)),
  check (octet_length(input::text) <= 256000)
);
alter table public.crm_sheets_bootstrap_previews enable row level security;
revoke all on public.crm_sheets_bootstrap_previews from public, anon, authenticated, service_role;

-- Function owner only; the limited API below is the sole service_role entry point.
create schema crm_sheets_bootstrap_private;
revoke all on schema crm_sheets_bootstrap_private from public, anon, authenticated, service_role;

create function crm_sheets_bootstrap_private.name_key(s text) returns text
language sql immutable security invoker set search_path = '' as $$
  select lower(btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g')))
$$;

create function crm_sheets_bootstrap_private.validate_rows(p_input jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_kind text;
  v_row jsonb;
  v_fields text[];
  v_required text[];
  v_key text;
  v_date text;
begin
  if jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_input->'contacts') is distinct from 'array'
    or jsonb_typeof(p_input->'tasks') is distinct from 'array'
    or p_input - array['id','contacts','tasks'] <> '{}'::jsonb
    or octet_length(p_input::text) > 256000 then
    raise exception 'Invalid bootstrap input';
  end if;
  if jsonb_array_length(p_input->'contacts') + jsonb_array_length(p_input->'tasks') not between 1 and 200 then
    raise exception 'Bootstrap row limit exceeded';
  end if;
  foreach v_kind in array array['contacts','tasks'] loop
    v_fields := case v_kind when 'contacts' then array['id','name','source','next_action','follow_up_date']
      else array['id','contact_id','title','due_date'] end;
    v_required := case v_kind when 'contacts' then array['id','name'] else array['id','contact_id','title'] end;
    for v_row in select value from jsonb_array_elements(p_input->v_kind) loop
      if jsonb_typeof(v_row) is distinct from 'object' or v_row - v_fields <> '{}'::jsonb then
        raise exception 'Invalid bootstrap fields';
      end if;
      foreach v_key in array v_fields loop
        if jsonb_typeof(v_row->v_key) is distinct from 'string' or length(v_row->>v_key) > 1000
          or (v_key = any(v_required) and crm_sheets_bootstrap_private.name_key(v_row->>v_key) = '') then
          raise exception 'Invalid bootstrap field value';
        end if;
        if v_key in ('id','contact_id') and (
          (v_row->>v_key) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        ) then raise exception 'Invalid bootstrap external ID'; end if;
      end loop;
      if v_kind='contacts' and (length(v_row->>'name') > 200 or btrim(v_row->>'name') <> v_row->>'name') then
        raise exception 'Invalid bootstrap name';
      end if;
      v_date := coalesce(v_row->>'follow_up_date', v_row->>'due_date');
      if v_date <> '' then
        begin
          if v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v_date::date,'YYYY-MM-DD') <> v_date then
            raise exception 'Invalid bootstrap date';
          end if;
        exception when invalid_datetime_format or datetime_field_overflow then
          raise exception 'Invalid bootstrap date';
        end;
      end if;
    end loop;
    if exists (select elem->>'id' from jsonb_array_elements(p_input->v_kind) elem group by 1 having count(*)>1) then
      raise exception 'Duplicate bootstrap external ID';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_input->'tasks') t
    where not exists (select 1 from jsonb_array_elements(p_input->'contacts') c where c->>'id'=t->>'contact_id')
  ) then raise exception 'Unresolved bootstrap contact reference'; end if;
end $$;

-- Private plan includes internal IDs only as expected state; never return them to the browser.
create function crm_sheets_bootstrap_private.plan(p_connection text, p_input jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with csv_contact as (
    select row, crm_sheets_bootstrap_private.name_key(row->>'name') normalized,
      count(*) over (partition by crm_sheets_bootstrap_private.name_key(row->>'name')) duplicate_count
    from jsonb_array_elements(p_input->'contacts') row
  ),
  contact_plan as (
    select row, link.app_id, case
      when link.app_id is not null and app.id is not null then 'linked'
      when link.app_id is not null or duplicate_count > 1 or exists (
        select 1 from public.contacts match
        where crm_sheets_bootstrap_private.name_key(match.first_name || ' ' || match.last_name)=normalized
      ) then 'blocked'
      else 'create' end as disposition
    from csv_contact
    left join public.crm_sheets_sync_links link
      on link.connection_key=p_connection and link.kind='contacts' and link.external_id=row->>'id'
    left join public.contacts app on app.id=link.app_id
  ),
  task_plan as (
    select task_item.item as row, link.app_id, case
      when parent.disposition='blocked' then 'blocked'
      when link.app_id is not null and app.id is not null and app.contact_id=parent.app_id then 'linked'
      when link.app_id is not null or exists (
        select 1 from public.tasks existing where existing.contact_id=parent.app_id
        and crm_sheets_bootstrap_private.name_key(existing.title)=crm_sheets_bootstrap_private.name_key(task_item.item->>'title')
      ) then 'blocked'
      else 'create' end as disposition
    from jsonb_array_elements(p_input->'tasks') as task_item(item)
    join contact_plan parent on parent.row->>'id'=task_item.item->>'contact_id'
    left join public.crm_sheets_sync_links link
      on link.connection_key=p_connection and link.kind='tasks' and link.external_id=task_item.item->>'id'
    left join public.tasks app on app.id=link.app_id
  )
  select jsonb_build_object(
    'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',row->>'id','name',row->>'name','appId',app_id,
      'disposition',disposition) order by (row->>'id') collate "C") from contact_plan),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',row->>'id','title',row->>'title','contact_id',row->>'contact_id',
      'appId',app_id,'disposition',disposition) order by (row->>'id') collate "C") from task_plan),'[]'::jsonb),
    'canApply', not exists (select 1 from contact_plan where disposition='blocked')
      and not exists (select 1 from task_plan where disposition='blocked')
      and (select count(*) from public.crm_sheets_sync_links l where l.connection_key=p_connection)
        + (select count(*) from contact_plan where disposition='create')
        + (select count(*) from task_plan where disposition='create') <= 200)
$$;

create function crm_sheets_bootstrap_private.bootstrap(p_connection text,p_action text,p_owner uuid,p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  v_id uuid;
  v_plan jsonb;
  v_safe jsonb;
  v_saved public.crm_sheets_bootstrap_previews%rowtype;
  v_lease timestamptz;
  v_contact jsonb;
  v_task jsonb;
  v_app_id uuid;
  v_parent_id uuid;
  v_contacts_created int := 0;
  v_tasks_created int := 0;
  v_result jsonb;
begin
  -- Execute is explicitly service-role only. Require current app-admin membership
  -- as a second check; owner UUID must be obtained from the authenticated request.
  if p_owner is null or not exists (select 1 from public.admins where user_id=p_owner) then
    raise exception 'Bootstrap administrator required';
  end if;
  if p_connection is null or p_connection !~ '^[0-9a-f]{64}$' or p_action is null
    or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text) > 256000
    or jsonb_typeof(p_args->'id') is distinct from 'string' then
    raise exception 'Invalid bootstrap request';
  end if;
  v_id := (p_args->>'id')::uuid;

  -- Same serialization point as staged sync and immutable link maintenance.
  select lease_until into v_lease from public.crm_sheets_sync_connection where connection_key=p_connection for update;
  if not found then raise exception 'Sync connection not provisioned'; end if;

  if p_action = 'apply' then
    if p_args - 'id' <> '{}'::jsonb then raise exception 'Invalid bootstrap request'; end if;
    select * into v_saved from public.crm_sheets_bootstrap_previews
      where connection_key=p_connection and id=v_id and owner_id=p_owner for update;
    if not found then raise exception 'Bootstrap preview unavailable'; end if;
    if v_saved.completed_at is not null then return v_saved.result; end if;
  elsif p_action <> 'preview' then raise exception 'Invalid bootstrap request';
  end if;

  if v_lease > clock_timestamp() or exists (select 1 from public.crm_sheets_sync_receipts
    where connection_key=p_connection and phase <> 'complete') then
    raise exception 'Bootstrap blocked by active sync or recovery';
  end if;

  if p_action = 'preview' then
    perform crm_sheets_bootstrap_private.validate_rows(p_args);
    v_plan := crm_sheets_bootstrap_private.plan(p_connection,p_args);
    delete from public.crm_sheets_bootstrap_previews where connection_key=p_connection and
      ((completed_at is null and expires_at <= clock_timestamp())
      or completed_at <= clock_timestamp()-interval '30 days');
    if (select count(*) from public.crm_sheets_bootstrap_previews
      where connection_key=p_connection and completed_at is null) >= 16
      or (select count(*) from public.crm_sheets_bootstrap_previews where connection_key=p_connection) >= 256 then
      raise exception 'Bootstrap preview limit reached';
    end if;
    insert into public.crm_sheets_bootstrap_previews(connection_key,id,owner_id,expires_at,input,expected_plan)
      values(p_connection,v_id,p_owner,clock_timestamp()+interval '10 minutes',p_args,v_plan);
    select jsonb_build_object('id',v_id,'canApply',v_plan->'canApply',
      'contacts',coalesce((select jsonb_agg(row - 'appId' order by (row->>'id') collate "C")
        from jsonb_array_elements(v_plan->'contacts') row),'[]'::jsonb),
      'tasks',coalesce((select jsonb_agg(row - 'appId' order by (row->>'id') collate "C")
        from jsonb_array_elements(v_plan->'tasks') row),'[]'::jsonb))
      into v_safe;
    return v_safe;
  end if;

  if v_saved.expires_at <= clock_timestamp() or v_saved.expected_plan->'canApply' <> 'true'::jsonb then
    raise exception 'Bootstrap preview expired or blocked';
  end if;
  -- Prevent phantom duplicate-name matches and preserve task association checks
  -- against ordinary CRM edits for this short transaction. Never lock around Google IO.
  lock table public.contacts, public.tasks in share row exclusive mode;
  if v_saved.expires_at <= clock_timestamp() then raise exception 'Bootstrap preview expired'; end if;
  v_plan := crm_sheets_bootstrap_private.plan(p_connection,v_saved.input);
  if v_plan is distinct from v_saved.expected_plan then raise exception 'Bootstrap preview stale'; end if;

  for v_contact in select row from jsonb_array_elements(v_saved.input->'contacts') row where exists (
    select 1 from jsonb_array_elements(v_plan->'contacts') item where item->>'id'=row->>'id' and item->>'disposition'='create'
  ) loop
    insert into public.contacts(first_name,source,next_action,follow_up_date)
      values(v_contact->>'name',nullif(v_contact->>'source',''),nullif(v_contact->>'next_action',''),
        nullif(v_contact->>'follow_up_date','')::date)
      returning id into v_app_id;
    insert into public.crm_sheets_sync_links(connection_key,kind,external_id,app_id)
      values(p_connection,'contacts',v_contact->>'id',v_app_id);
    v_contacts_created := v_contacts_created+1;
  end loop;

  for v_task in select row from jsonb_array_elements(v_saved.input->'tasks') row where exists (
    select 1 from jsonb_array_elements(v_plan->'tasks') item where item->>'id'=row->>'id' and item->>'disposition'='create'
  ) loop
    select app_id into strict v_parent_id from public.crm_sheets_sync_links
      where connection_key=p_connection and kind='contacts' and external_id=v_task->>'contact_id';
    insert into public.tasks(contact_id,title,due_date)
      values(v_parent_id,v_task->>'title',nullif(v_task->>'due_date','')::date)
      returning id into v_app_id;
    insert into public.crm_sheets_sync_links(connection_key,kind,external_id,app_id)
      values(p_connection,'tasks',v_task->>'id',v_app_id);
    v_tasks_created := v_tasks_created+1;
  end loop;
  v_result := jsonb_build_object('id',v_id,'contactsCreated',v_contacts_created,'tasksCreated',v_tasks_created,
    'contactsSkipped',jsonb_array_length(v_saved.input->'contacts')-v_contacts_created,
    'tasksSkipped',jsonb_array_length(v_saved.input->'tasks')-v_tasks_created);
  update public.crm_sheets_bootstrap_previews set input=null, expected_plan=null, result=v_result,
    completed_at=clock_timestamp() where connection_key=p_connection and id=v_id;
  return v_result;
end $$;

revoke all on function crm_sheets_bootstrap_private.name_key(text),
  crm_sheets_bootstrap_private.validate_rows(jsonb),
  crm_sheets_bootstrap_private.plan(text,jsonb),
  crm_sheets_bootstrap_private.bootstrap(text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema crm_sheets_bootstrap_private to service_role;
grant execute on function crm_sheets_bootstrap_private.bootstrap(text,text,uuid,jsonb) to service_role;

-- PostgREST sees only this explicit invoker wrapper; keep the privileged body
-- in a non-exposed schema with just the bounded bootstrap entry granted.
create function public.crm_sheets_bootstrap(p_connection text,p_action text,p_owner uuid,p_args jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select crm_sheets_bootstrap_private.bootstrap(p_connection,p_action,p_owner,p_args)
$$;
revoke all on function public.crm_sheets_bootstrap(text,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crm_sheets_bootstrap(text,text,uuid,jsonb) to service_role;

commit;
