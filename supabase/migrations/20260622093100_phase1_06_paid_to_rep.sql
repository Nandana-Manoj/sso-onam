-- Phase 1 · Migration 06 — Attribute collections by who RECEIVED the money.
-- Snapshot the tower's rep at payment-submit time onto the contribution, so a
-- payment stays credited to the rep who actually received it even if the tower
-- rep changes later (decentralized: residents pay the rep's personal UPI/QR).

alter table public.contributions
  add column if not exists paid_to_rep_user_id uuid references public.profiles(id);

create index if not exists contributions_paid_rep_idx
  on public.contributions (paid_to_rep_user_id);

-- Backfill existing rows: the verifier is the receiver in this model (a rep
-- verifies money landing in their own account); fall back to the tower's
-- current rep where there's no verifier yet.
update public.contributions c
   set paid_to_rep_user_id = coalesce(c.verified_by_user_id, t.rep_user_id)
  from public.towers t
 where c.paid_to_tower_id = t.id
   and c.paid_to_rep_user_id is null;

-- Capture the receiving rep when payment is submitted.
create or replace function public.submit_contribution_payment(
  p_contribution_id uuid,
  p_amount_paid     numeric,
  p_utr             text default null,
  p_screenshot_path text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_flat    uuid;
  v_contrib public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select flat_id into v_flat from public.profiles where id = v_uid;

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;
  if not public.is_admin() and v_contrib.flat_id is distinct from v_flat then
    raise exception 'Not your flat''s contribution';
  end if;
  if v_contrib.status <> 'payment_pending' then
    raise exception 'Payment has already been submitted or processed';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'Amount paid must be greater than zero';
  end if;

  update public.contributions
     set amount_paid          = p_amount_paid,
         utr                  = nullif(btrim(p_utr), ''),
         screenshot_path      = nullif(btrim(p_screenshot_path), ''),
         payment_submitted_at = now(),
         paid_to_rep_user_id  = (select rep_user_id from public.towers where id = v_contrib.paid_to_tower_id),
         status               = 'submitted'
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_contrib.event_id, v_uid, 'contribution.payment_submitted', 'contribution', v_contrib.id, to_jsonb(v_contrib));

  return v_contrib;
end;
$$;
