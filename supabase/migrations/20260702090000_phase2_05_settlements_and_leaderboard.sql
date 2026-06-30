-- Settlement tracking: reps record how much of their collected money they have
-- transferred to the organising committee.
create table rep_settlements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  tower_id    uuid not null references towers(id) on delete cascade,
  rep_user_id uuid not null references profiles(id),
  amount      integer not null check (amount > 0),
  note        text,
  created_at  timestamptz not null default now()
);

create index on rep_settlements (event_id, tower_id);

alter table rep_settlements enable row level security;

-- Reps can read settlements for towers they manage.
create policy "Rep reads own tower settlements"
  on rep_settlements for select
  using (
    exists (
      select 1 from towers t
      where t.id = tower_id and t.rep_user_id = auth.uid()
    )
  );

-- Admins can read all settlements.
create policy "Admin reads all settlements"
  on rep_settlements for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Reps can insert settlements for their own towers.
create policy "Rep inserts own settlement"
  on rep_settlements for insert
  with check (
    rep_user_id = auth.uid()
    and exists (
      select 1 from towers t
      where t.id = tower_id and t.rep_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Tower leaderboard: aggregate per-tower stats for the active event.
-- Runs as SECURITY DEFINER so all authenticated users (including reps) can
-- see all towers — needed for the healthy-competition leaderboard on RepHome.
-- ---------------------------------------------------------------------------
create or replace function get_tower_leaderboard(p_event_id uuid)
returns table (
  tower_id     uuid,
  tower_name   text,
  families     bigint,
  sadya_passes bigint,
  total_amount numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with contrib_stats as (
    select
      paid_to_tower_id,
      count(distinct flat_id) filter (
        where status = 'verified'
          and (refund_state is null or refund_state <> 'refunded')
      ) as families,
      coalesce(
        sum(coalesce(amount_paid, amount)) filter (
          where status = 'verified'
            and (refund_state is null or refund_state <> 'refunded')
        ),
        0
      ) as contrib_amount
    from contributions
    where event_id = p_event_id
    group by paid_to_tower_id
  ),
  sadya_stats as (
    select
      paid_to_tower_id,
      coalesce(sum(total_persons) filter (where status = 'verified'), 0)                    as passes_sold,
      coalesce(sum(coalesce(amount_paid, total_amount)) filter (where status = 'verified'), 0) as sadya_amount
    from sadya_bookings
    where event_id = p_event_id
    group by paid_to_tower_id
  ),
  cancel_stats as (
    select
      paid_to_tower_id,
      coalesce(sum(total_persons) filter (where status = 'refunded'), 0) as passes_refunded,
      coalesce(sum(amount)        filter (where status = 'refunded'), 0) as cancel_amount
    from sadya_cancellations
    where event_id = p_event_id
    group by paid_to_tower_id
  )
  select
    t.id   as tower_id,
    t.name as tower_name,
    coalesce(cs.families, 0)                                                     as families,
    greatest(0,
      coalesce(ss.passes_sold, 0) - coalesce(cx.passes_refunded, 0)
    )                                                                            as sadya_passes,
    coalesce(cs.contrib_amount, 0)
      + coalesce(ss.sadya_amount,  0)
      - coalesce(cx.cancel_amount, 0)                                           as total_amount
  from towers t
  left join contrib_stats cs on cs.paid_to_tower_id = t.id
  left join sadya_stats   ss on ss.paid_to_tower_id = t.id
  left join cancel_stats  cx on cx.paid_to_tower_id = t.id
  order by total_amount desc, t.name
$$;

grant execute on function get_tower_leaderboard(uuid) to authenticated;
