-- Stripe webhook storage and matching, in one atomic call. Only the API (service role) may call it.
--
-- Every event is stored raw. The event id is the primary key, so a redelivered event is a no-op.
-- For a paid checkout (p_payment is not null) a payment row is created and matched conservatively:
--   payment link that is not one of the offers here        -> ignored (the Stripe account also sells
--                                                             unrelated products; the raw event is still kept)
--   contact found by email AND offer found by payment link -> 'matched' (+ entitlement, client stage)
--   contact found by email, no payment link on the checkout -> 'needs_review' (contact suggested)
--   no contact with that email                             -> 'unmatched'
-- Only 'matched' payments count toward balances. Maria resolves the rest in the review queue.
create or replace function public.record_stripe_event(
  p_event_id text,
  p_type     text,
  p_payload  jsonb,
  p_payment  jsonb default null -- checkout_session_id, payment_intent_id, amount_cents, email, name, payment_link_id, paid_on
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email      text := nullif(lower(trim(p_payment->>'email')), '');
  v_contact_id uuid;
  v_offer_id   uuid;
  v_status     text;
  v_payment_id uuid;
begin
  insert into public.stripe_events (id, type, payload) values (p_event_id, p_type, p_payload)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if p_payment is null then
    update public.stripe_events set processed_at = now() where id = p_event_id;
    return jsonb_build_object('status', 'stored');
  end if;

  -- The same checkout can arrive under two event types (completed, async_payment_succeeded).
  if exists (select 1 from public.payments where stripe_checkout_session_id = p_payment->>'checkout_session_id') then
    update public.stripe_events set processed_at = now() where id = p_event_id;
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_email is not null then
    select id into v_contact_id from public.contacts where email = v_email;
  end if;
  if nullif(p_payment->>'payment_link_id', '') is not null then
    select id into v_offer_id from public.offers where stripe_payment_link_id = p_payment->>'payment_link_id';
    if v_offer_id is null then
      update public.stripe_events set processed_at = now() where id = p_event_id;
      return jsonb_build_object('status', 'ignored');
    end if;
  end if;
  v_status := case
    when v_contact_id is not null and v_offer_id is not null then 'matched'
    when v_contact_id is not null then 'needs_review'
    else 'unmatched'
  end;

  insert into public.payments (
    contact_id, offer_id, amount_cents, method, paid_on, payer_email, payer_name,
    stripe_event_id, stripe_checkout_session_id, stripe_payment_intent_id, match_status
  ) values (
    v_contact_id, v_offer_id, (p_payment->>'amount_cents')::integer, 'stripe',
    coalesce((p_payment->>'paid_on')::date, current_date), v_email, nullif(p_payment->>'name', ''),
    p_event_id, p_payment->>'checkout_session_id', nullif(p_payment->>'payment_intent_id', ''), v_status
  )
  returning id into v_payment_id;

  if v_status = 'matched' then
    insert into public.entitlements (contact_id, offer_id, source, payment_id)
    values (v_contact_id, v_offer_id, 'purchase', v_payment_id);
    update public.contacts set stage = 'active_client'
    where id = v_contact_id and stage in ('new', 'contacted', 'assessment_completed', 'consultation');
  end if;

  update public.stripe_events set processed_at = now() where id = p_event_id;
  return jsonb_build_object('status', v_status, 'payment_id', v_payment_id, 'contact_id', v_contact_id, 'offer_id', v_offer_id);
end $$;

revoke execute on function public.record_stripe_event(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_event(text, text, jsonb, jsonb) to service_role;

-- The live payment link behind the "Book a session" buttons (an id, not a secret).
update public.offers set stripe_payment_link_id = 'plink_1UTlgZ1PqsZvBWX7RCGqOpQT' where key = 'ai_training_session';
