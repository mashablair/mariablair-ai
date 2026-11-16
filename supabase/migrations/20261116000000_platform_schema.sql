-- mariablairai.com platform: full data model + Row Level Security.
-- Rules: RLS on every table, default deny. Admin = row in `admins` matched by auth uid.
-- Clients only ever read rows tied to their own contact, and only from tables meant to be shared.
-- Money is stored as integer cents.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table public.admins (
  email      text primary key check (email = lower(email)),
  user_id    uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.admins is 'Allow-list of admin emails. user_id is filled in on first verified sign-in.';

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  business_type text,
  website       text,
  phone         text,
  city          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.contacts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies (id) on delete set null,
  first_name     text not null,
  last_name      text not null default '',
  email          text check (email = lower(email)),
  phone          text,
  job_title      text,
  business_type  text,
  ai_needs       text,
  stage          text not null default 'new' check (stage in (
                   'new', 'contacted', 'assessment_completed', 'consultation',
                   'active_client', 'past_client', 'not_a_fit')),
  source         text,
  next_action    text,
  follow_up_date date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index contacts_email_key on public.contacts (email) where email is not null;
create index contacts_company_idx on public.contacts (company_id);
create index contacts_follow_up_idx on public.contacts (follow_up_date) where follow_up_date is not null;

create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  contact_id uuid unique references public.contacts (id) on delete set null,
  email      text not null,
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Auth user <-> CRM contact. contact_id is only ever set by link_my_account() from the verified email.';

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  event_date date,
  location   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contact_events (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, event_id)
);
create index contact_events_event_idx on public.contact_events (event_id);

create table public.sessions (
  id                     uuid primary key default gen_random_uuid(),
  contact_id             uuid not null references public.contacts (id) on delete cascade,
  company_id             uuid references public.companies (id) on delete set null,
  type                   text not null default 'private' check (type in ('consultation', 'private', 'workshop')),
  status                 text not null default 'planned' check (status in ('planned', 'scheduled', 'completed', 'cancelled')),
  title                  text,
  scheduled_at           timestamptz,
  duration_minutes       integer check (duration_minutes is null or duration_minutes >= 0),
  agreed_rate_cents      integer check (agreed_rate_cents is null or agreed_rate_cents >= 0), -- per hour
  location               text,
  plan                   text,
  outcomes               text,
  client_visible_summary text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index sessions_contact_idx on public.sessions (contact_id);

-- Internal notes are their own admin-only table on purpose: never a column on a client-readable table.
create table public.internal_notes (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(contact_id, company_id, session_id) >= 1)
);
create index internal_notes_contact_idx on public.internal_notes (contact_id);
create index internal_notes_company_idx on public.internal_notes (company_id);
create index internal_notes_session_idx on public.internal_notes (session_id);

create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts (id) on delete cascade,
  title      text not null,
  due_date   date,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_contact_idx on public.tasks (contact_id);
create index tasks_open_due_idx on public.tasks (due_date) where done_at is null;

-- ---------------------------------------------------------------------------
-- Assessment
-- ---------------------------------------------------------------------------
create table public.assessment_versions (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique,
  definition jsonb not null,
  created_at timestamptz not null default now()
);

create table public.assessment_submissions (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references public.contacts (id) on delete cascade,
  version_id      uuid references public.assessment_versions (id) on delete set null,
  track           text not null check (track in ('business', 'individual')),
  answers         jsonb not null,
  score           integer not null,
  level           text not null,
  recommendations jsonb not null default '[]'::jsonb,
  offer_key       text,
  created_at      timestamptz not null default now()
);
create index assessment_submissions_contact_idx on public.assessment_submissions (contact_id);

-- ---------------------------------------------------------------------------
-- Intake + recommendations
-- ---------------------------------------------------------------------------
create table public.intake_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  questions   jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.intake_responses (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid references public.intake_templates (id) on delete set null,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  session_id  uuid references public.sessions (id) on delete set null,
  answers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index intake_responses_contact_idx on public.intake_responses (contact_id);

create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts (id) on delete cascade,
  submission_id uuid references public.assessment_submissions (id) on delete set null,
  title         text not null,
  body          text not null default '',
  shared        boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index recommendations_contact_idx on public.recommendations (contact_id);

-- ---------------------------------------------------------------------------
-- Materials
-- ---------------------------------------------------------------------------
create table public.materials (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  kind         text not null default 'file',
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.session_materials (
  session_id  uuid not null references public.sessions (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (session_id, material_id)
);

create table public.material_grants (
  material_id uuid not null references public.materials (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (material_id, contact_id)
);
create index material_grants_contact_idx on public.material_grants (contact_id);

-- ---------------------------------------------------------------------------
-- Offers, billing, Stripe
-- ---------------------------------------------------------------------------
create table public.offers (
  id                      uuid primary key default gen_random_uuid(),
  key                     text not null unique,
  name                    text not null,
  kind                    text not null check (kind in ('session', 'workshop', 'digital', 'course')),
  description             text,
  price_cents             integer check (price_cents is null or price_cents >= 0),
  unit                    text not null default 'flat' check (unit in ('flat', 'hour')),
  stripe_price_id         text,
  stripe_payment_link_id  text,
  stripe_payment_link_url text,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.charges (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  session_id   uuid references public.sessions (id) on delete set null,
  offer_id     uuid references public.offers (id) on delete set null,
  description  text not null,
  amount_cents integer not null check (amount_cents >= 0),
  invoice_ref  text,
  charged_on   date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index charges_contact_idx on public.charges (contact_id);
create index charges_session_idx on public.charges (session_id);

create table public.stripe_events (
  id           text primary key, -- Stripe event id; the primary key is what makes the webhook idempotent
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create table public.payments (
  id                         uuid primary key default gen_random_uuid(),
  contact_id                 uuid references public.contacts (id) on delete set null,
  offer_id                   uuid references public.offers (id) on delete set null,
  amount_cents               integer not null check (amount_cents >= 0),
  method                     text not null default 'other' check (method in ('stripe', 'cash', 'check', 'zelle', 'card', 'other')),
  paid_on                    date not null default current_date,
  reference                  text,
  payer_email                text,
  payer_name                 text,
  stripe_event_id            text references public.stripe_events (id) on delete set null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  match_status               text not null default 'matched' check (match_status in ('matched', 'needs_review', 'unmatched')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (match_status <> 'matched' or contact_id is not null)
);
create index payments_contact_idx on public.payments (contact_id);
create index payments_review_idx on public.payments (match_status) where match_status <> 'matched';

create table public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  offer_id   uuid not null references public.offers (id) on delete cascade,
  source     text not null check (source in ('purchase', 'grant')),
  payment_id uuid unique references public.payments (id) on delete set null,
  created_at timestamptz not null default now()
);
create index entitlements_contact_idx on public.entitlements (contact_id);

-- Balance per contact: what is owed (charges) minus what was paid (matched payments).
-- security_invoker: the caller's RLS applies, so only admins get rows.
create view public.contact_balances with (security_invoker = true) as
select
  c.id as contact_id,
  coalesce(ch.total, 0)::integer as charged_cents,
  coalesce(p.total, 0)::integer as paid_cents,
  (coalesce(ch.total, 0) - coalesce(p.total, 0))::integer as balance_cents
from public.contacts c
left join (select contact_id, sum(amount_cents) as total from public.charges group by contact_id) ch on ch.contact_id = c.id
left join (select contact_id, sum(amount_cents) as total from public.payments
           where contact_id is not null and match_status = 'matched' group by contact_id) p on p.contact_id = c.id;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Security helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.my_contact_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.contact_id from public.profiles p where p.user_id = (select auth.uid());
$$;

-- Called by the app after every sign-in. Links the signed-in user to their CRM contact and to the
-- admin allow-list using ONLY the email that Supabase Auth has verified. The browser supplies no ids.
create or replace function public.link_my_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_contact uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'email not verified';
  end if;

  insert into public.profiles (user_id, email) values (v_uid, v_email)
  on conflict (user_id) do nothing;

  update public.admins set user_id = v_uid where email = v_email and user_id is null;

  select p.contact_id into v_contact from public.profiles p where p.user_id = v_uid;
  if v_contact is null then
    update public.profiles p set contact_id = c.id
    from public.contacts c
    where p.user_id = v_uid
      and c.email = v_email
      and not exists (select 1 from public.profiles p2 where p2.contact_id = c.id)
    returning p.contact_id into v_contact;
  end if;

  return jsonb_build_object(
    'email', v_email,
    'contact_id', v_contact,
    'is_admin', exists (select 1 from public.admins a where a.user_id = v_uid)
  );
end $$;

-- The few contact columns a client may see about themselves (the contacts table itself is admin-only,
-- because it carries CRM fields such as stage, source and next action).
create or replace function public.my_contact()
returns table (id uuid, first_name text, last_name text, email text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.first_name, c.last_name, c.email
  from public.contacts c
  where c.id = public.my_contact_id();
$$;

-- The client-safe slice of a session (never plan, outcomes or rate).
create or replace function public.my_sessions()
returns table (id uuid, type text, status text, title text, scheduled_at timestamptz, duration_minutes integer, client_visible_summary text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.type, s.status, s.title, s.scheduled_at, s.duration_minutes, s.client_visible_summary
  from public.sessions s
  where s.contact_id = public.my_contact_id();
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: on for every table, admin full access, then narrow client reads.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

create policy client_own_profile on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy client_own_submissions on public.assessment_submissions for select to authenticated
  using (contact_id = public.my_contact_id());

create policy client_shared_recommendations on public.recommendations for select to authenticated
  using (shared and contact_id = public.my_contact_id());

create policy client_own_grants on public.material_grants for select to authenticated
  using (contact_id = public.my_contact_id());

create policy client_granted_materials on public.materials for select to authenticated
  using (exists (
    select 1 from public.material_grants g
    where g.material_id = materials.id and g.contact_id = public.my_contact_id()
  ));

create policy client_own_entitlements on public.entitlements for select to authenticated
  using (contact_id = public.my_contact_id());

create policy signed_in_active_offers on public.offers for select to authenticated
  using (active);

-- ---------------------------------------------------------------------------
-- Privileges. Nothing for anonymous visitors: the public assessment goes through the API.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_admin(), public.my_contact_id(), public.link_my_account(),
  public.my_contact(), public.my_sessions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------------
insert into public.admins (email) values ('mashablair@gmail.com');

insert into public.offers (key, name, kind, description, price_cents, unit, stripe_payment_link_url) values
  ('free_call', 'Free 20-minute call', 'session', 'A short call to see whether AI training is a fit.', 0, 'flat', null),
  ('ai_training_session', 'AI Training Session', 'session', 'Private, in-person AI training. 1 to 10 hours.', 9900, 'hour',
   'https://buy.stripe.com/7sY3cn5jKflV2NN8fm6sw04'),
  ('team_workshop', 'Team workshop', 'workshop', 'Hands-on AI workshop for a team, at your office.', null, 'flat', null),
  ('advanced_automation', 'Advanced automation', 'session', 'Custom AI workflows and automation setup.', null, 'flat', null);
