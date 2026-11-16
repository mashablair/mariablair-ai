-- One atomic write for a public assessment submission. Only the API (service role) may call it.
-- Creates or updates the contact (matched on lowercased email), stores the submission, seeds
-- editable recommendations, and creates a follow-up task for Maria.
-- An existing contact is never overwritten by a public form: only blanks are filled in, and the
-- stage only moves forward from 'new' or 'contacted'.
create or replace function public.submit_assessment(
  p_contact         jsonb,   -- first_name, last_name, email, company, business_type, ai_needs
  p_version         integer,
  p_definition      jsonb,
  p_track           text,
  p_answers         jsonb,
  p_score           integer,
  p_level           text,
  p_recommendations jsonb,   -- [{title, body}]
  p_offer_key       text,
  p_task_title      text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email      text := lower(trim(p_contact->>'email'));
  v_company    text := nullif(trim(p_contact->>'company'), '');
  v_contact    public.contacts;
  v_company_id uuid;
  v_version_id uuid;
  v_submission uuid;
  v_new        boolean := false;
begin
  if v_email is null or v_email = '' then
    raise exception 'email is required';
  end if;

  insert into public.assessment_versions (version, definition) values (p_version, p_definition)
  on conflict (version) do nothing;
  select id into v_version_id from public.assessment_versions where version = p_version;

  select * into v_contact from public.contacts where email = v_email;
  if not found then
    if v_company is not null then
      select id into v_company_id from public.companies where lower(name) = lower(v_company) order by created_at limit 1;
      if v_company_id is null then
        insert into public.companies (name, business_type) values (v_company, nullif(p_contact->>'business_type', ''))
        returning id into v_company_id;
      end if;
    end if;
    insert into public.contacts (first_name, last_name, email, company_id, business_type, ai_needs, stage, source)
    values (
      trim(p_contact->>'first_name'), coalesce(trim(p_contact->>'last_name'), ''), v_email, v_company_id,
      nullif(p_contact->>'business_type', ''), nullif(p_contact->>'ai_needs', ''), 'assessment_completed', 'Assessment'
    )
    returning * into v_contact;
    v_new := true;
  else
    update public.contacts set
      stage = case when stage in ('new', 'contacted') then 'assessment_completed' else stage end,
      business_type = coalesce(business_type, nullif(p_contact->>'business_type', '')),
      ai_needs = coalesce(ai_needs, nullif(p_contact->>'ai_needs', ''))
    where id = v_contact.id;
  end if;

  insert into public.assessment_submissions (contact_id, version_id, track, answers, score, level, recommendations, offer_key)
  values (v_contact.id, v_version_id, p_track, p_answers, p_score, p_level, p_recommendations, p_offer_key)
  returning id into v_submission;

  insert into public.recommendations (contact_id, submission_id, title, body, sort_order)
  select v_contact.id, v_submission, r.value->>'title', coalesce(r.value->>'body', ''), r.ordinality::integer
  from jsonb_array_elements(p_recommendations) with ordinality as r;

  insert into public.tasks (contact_id, title, due_date) values (v_contact.id, p_task_title, current_date + 1);

  return jsonb_build_object('contact_id', v_contact.id, 'submission_id', v_submission, 'is_new_contact', v_new);
end $$;

revoke execute on function public.submit_assessment(jsonb, integer, jsonb, text, jsonb, integer, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.submit_assessment(jsonb, integer, jsonb, text, jsonb, integer, text, jsonb, text, text) to service_role;
