-- Phase 1 · Migration 03 — Rep payment QR image
-- Storage bucket + policies for rep UPI QR images, and extend the rep
-- self-service setter to also persist the uploaded QR path. A UPI QR is meant
-- to be shown to residents to receive money, so the bucket is public-read;
-- writes are restricted to each rep's own uid-prefixed path.

-- Public bucket for rep QR images.
insert into storage.buckets (id, name, public)
values ('rep-qr', 'rep-qr', true)
on conflict (id) do update set public = true;

-- Object path convention: '<rep_uid>/qr.<ext>' — reps write only their own.
drop policy if exists "rep qr public read" on storage.objects;
drop policy if exists "rep qr insert own"  on storage.objects;
drop policy if exists "rep qr update own"  on storage.objects;

create policy "rep qr public read" on storage.objects
  for select to public
  using (bucket_id = 'rep-qr');

create policy "rep qr insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rep-qr' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "rep qr update own" on storage.objects
  for update to authenticated
  using  (bucket_id = 'rep-qr' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rep-qr' and (storage.foldername(name))[1] = auth.uid()::text);

-- Replace the 1-arg payment setter with one that also stores the QR path.
-- A null/blank p_qr_path leaves the existing QR untouched (so saving the UPI
-- text alone never wipes an uploaded QR).
drop function if exists public.set_my_rep_payment(text);

create or replace function public.set_my_rep_payment(
  p_contact text,
  p_qr_path text default null
) returns public.towers
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_tower public.towers;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.app_role() <> 'tower_rep' then raise exception 'Tower reps only'; end if;

  update public.towers
     set rep_contact     = nullif(btrim(p_contact), ''),
         payment_qr_path = coalesce(nullif(btrim(p_qr_path), ''), payment_qr_path)
   where rep_user_id = v_uid
   returning * into v_tower;

  if v_tower is null then
    raise exception 'You are not assigned as the rep for any tower';
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (v_uid, 'tower.rep_payment_updated', 'tower', v_tower.id, to_jsonb(v_tower));

  return v_tower;
end;
$$;

grant execute on function public.set_my_rep_payment(text, text) to authenticated;
