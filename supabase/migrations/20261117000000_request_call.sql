-- Free 20-minute call requests from the marketing page. Only the API (service role) may call this.
-- Creates or finds the contact (matched on lowercased email), keeps the visitor's message as a private
-- note, and creates a follow-up task due today. Like submit_assessment, a public form never overwrites
-- what Maria has entered: only blank fields are filled in, and only a 'new' contact's stage moves.
create or replace function public.request_call(
  p_contact jsonb,  -- first_name, last_name, email, phone, company
  p_message text,
  p_task_title text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email      text := lower(trim(p_contact->>'email'));
  v_company    text := nullif(trim(p_contact->>'company'), '');
  v_phone      text := nullif(trim(p_contact->>'phone'), '');
  v_contact    public.contacts;
  v_company_id uuid;
  v_new        boolean := false;
begin
  if v_email is null or v_email = '' then
    raise exception 'email is required';
  end if;

  select * into v_contact from public.contacts where email = v_email;
  if not found then
    if v_company is not null then
      select id into v_company_id from public.companies where lower(name) = lower(v_company) order by created_at limit 1;
      if v_company_id is null then
        insert into public.companies (name) values (v_company) returning id into v_company_id;
      end if;
    end if;
    insert into public.contacts (first_name, last_name, email, phone, company_id, stage, source, next_action, follow_up_date)
    values (
      trim(p_contact->>'first_name'), coalesce(trim(p_contact->>'last_name'), ''), v_email, v_phone, v_company_id,
      'new', 'Free call request', 'Reply to free call request', current_date
    )
    returning * into v_contact;
    v_new := true;
  else
    update public.contacts set
      phone = coalesce(phone, v_phone),
      next_action = coalesce(next_action, 'Reply to free call request'),
      follow_up_date = least(coalesce(follow_up_date, current_date), current_date)
    where id = v_contact.id;
  end if;

  insert into public.internal_notes (contact_id, body)
  values (v_contact.id, 'Free call request' || coalesce(' from ' || v_company, '') || ':' || E'\n' || coalesce(nullif(trim(p_message), ''), '(no message)'));

  insert into public.tasks (contact_id, title, due_date) values (v_contact.id, p_task_title, current_date);

  return jsonb_build_object('contact_id', v_contact.id, 'is_new_contact', v_new);
end $$;

revoke execute on function public.request_call(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.request_call(jsonb, text, text) to service_role;
