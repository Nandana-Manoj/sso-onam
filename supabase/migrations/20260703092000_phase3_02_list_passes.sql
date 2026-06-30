-- Phase 3 · Migration 02 — bulk pass list for the offline scanner cache.
-- The scanner snapshots every flat's pass for the active event into the device's
-- IndexedDB at serving start, so a rep can preview "X of Y remaining" even with no
-- connectivity. A sadya rep who is only a resident can't read other flats' passes
-- via RLS, so this security-definer function (gated to is_sadya_rep) is the source.
create or replace function public.list_sadya_passes()
returns table (
  nonce          text,
  tower_name     text,
  flat_number    text,
  allowed_scans  int,
  redeemed_count int,
  remaining      int,
  status         text
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sadya_rep() then raise exception 'Not authorized to scan sadya passes'; end if;

  return query
    select p.nonce, t.name, f.flat_number,
           p.allowed_scans, p.redeemed_count,
           p.allowed_scans - p.redeemed_count, p.status::text
      from public.qr_passes p
      join public.flats f  on f.id = p.flat_id
      join public.towers t on t.id = f.tower_id
      join public.events e on e.id = p.event_id
     where e.is_active;
end;
$$;
grant execute on function public.list_sadya_passes() to authenticated;
