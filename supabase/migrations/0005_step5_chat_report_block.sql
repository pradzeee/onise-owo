-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 5: In-App Job Chat (opens after acceptance, closes 7 days
-- after job ends), Report & Block, Zero Phone Number Exposure
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables: job_messages, user_blocks, user_reports
-- ----------------------------------------------------------------------------
create table if not exists public.job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists job_messages_sender_idempotency_idx
  on public.job_messages (job_id, sender_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists job_messages_job_created_idx
  on public.job_messages (job_id, created_at asc);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid null references public.jobs (id) on delete set null,
  reason text null check (reason is null or char_length(trim(reason)) <= 300),
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_blocks_not_self check (blocker_id <> blocked_id),
  constraint user_blocks_unique_pair unique (blocker_id, blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid null references public.jobs (id) on delete set null,
  category text not null check (
    category in (
      'harassment',
      'fraud_scam',
      'off_platform_solicitation',
      'unsafe_behavior',
      'no_show',
      'other'
    )
  ),
  details text not null check (char_length(trim(details)) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  reviewed_by uuid null references public.profiles (id) on delete set null,
  reviewed_at timestamptz null,
  resolution_notes text null,
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_reports_not_self check (reporter_id <> reported_user_id)
);

create unique index if not exists user_reports_reporter_idempotency_idx
  on public.user_reports (reporter_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists user_reports_status_created_idx
  on public.user_reports (status, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Non-recursive Helper Functions
-- ----------------------------------------------------------------------------
create or replace function public.is_job_accepted_participant(p_job_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and j.artisan_id is not null
      and j.status not in ('requested', 'expired')
      and (j.customer_id = p_uid or j.artisan_id = p_uid)
  );
$$;

create or replace function public.is_pair_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = p_user_a and ub.blocked_id = p_user_b)
       or (ub.blocker_id = p_user_b and ub.blocked_id = p_user_a)
  );
$$;

revoke all on function public.is_job_accepted_participant(uuid, uuid) from public;
revoke all on function public.is_pair_blocked(uuid, uuid) from public;
grant execute on function public.is_job_accepted_participant(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_pair_blocked(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security on ALL Step 5 Tables
-- ----------------------------------------------------------------------------
alter table public.job_messages enable row level security;
alter table public.job_messages force row level security;

revoke all on public.job_messages from public, anon, authenticated;
grant select on public.job_messages to authenticated;

drop policy if exists job_messages_select_participants on public.job_messages;
create policy job_messages_select_participants
  on public.job_messages
  for select
  to authenticated
  using (
    public.is_job_accepted_participant(job_id, auth.uid())
    or public.is_admin(auth.uid())
  );

alter table public.user_blocks enable row level security;
alter table public.user_blocks force row level security;

revoke all on public.user_blocks from public, anon, authenticated;
grant select on public.user_blocks to authenticated;

drop policy if exists user_blocks_select_own_or_admin on public.user_blocks;
create policy user_blocks_select_own_or_admin
  on public.user_blocks
  for select
  to authenticated
  using (
    auth.uid() = blocker_id
    or public.is_admin(auth.uid())
  );

alter table public.user_reports enable row level security;
alter table public.user_reports force row level security;

revoke all on public.user_reports from public, anon, authenticated;
grant select (
  id,
  reporter_id,
  reported_user_id,
  job_id,
  category,
  details,
  status,
  created_at
) on public.user_reports to authenticated;

drop policy if exists user_reports_select_own_or_admin on public.user_reports;
create policy user_reports_select_own_or_admin
  on public.user_reports
  for select
  to authenticated
  using (
    auth.uid() = reporter_id
    or public.is_admin(auth.uid())
  );

-- Enable Supabase Realtime on job_messages safely
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.job_messages;
    exception when duplicate_object then
      null;
    end;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Server Function: public.get_job_chat_status
-- Determines whether chat is open (accepted, not blocked, within 7 days of end).
-- ----------------------------------------------------------------------------
create or replace function public.get_job_chat_status(p_job_id uuid)
returns table (
  can_read boolean,
  can_send boolean,
  is_blocked boolean,
  closes_at timestamptz,
  closed_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_other_id uuid;
  v_blocked boolean;
  v_ended_at timestamptz;
  v_closes_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return query select false, false, false, null::timestamptz, 'Job not found.';
    return;
  end if;

  if v_job.artisan_id is null or v_job.status in ('requested', 'expired') then
    return query select false, false, false, null::timestamptz, 'Chat opens only after a job is accepted.';
    return;
  end if;

  if v_uid <> v_job.customer_id and v_uid <> v_job.artisan_id and not public.is_admin(v_uid) then
    return query select false, false, false, null::timestamptz, 'Only the customer and assigned artisan can access this chat.';
    return;
  end if;

  v_other_id := case when v_uid = v_job.customer_id then v_job.artisan_id else v_job.customer_id end;
  v_blocked := public.is_pair_blocked(v_uid, v_other_id);

  if v_job.status in ('completed', 'confirmed', 'cancelled', 'refunded') then
    v_ended_at := coalesce(v_job.confirmed_at, v_job.completed_at, v_job.cancelled_at, v_job.updated_at);
    v_closes_at := v_ended_at + interval '7 days';

    if v_now > v_closes_at then
      return query select true, false, v_blocked, v_closes_at, 'Chat closed 7 days after the job ended.';
      return;
    end if;
  else
    v_closes_at := null;
  end if;

  if v_blocked then
    return query select true, false, true, v_closes_at, 'Messaging is disabled because one participant blocked the other.';
    return;
  end if;

  return query select true, true, false, v_closes_at, null::text;
end;
$$;

revoke all on function public.get_job_chat_status(uuid) from public, anon;
grant execute on function public.get_job_chat_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Server Function: public.send_job_message (idempotent)
-- Enforces: accepted job only, customer/artisan only, not blocked, <= 7 days after end.
-- ----------------------------------------------------------------------------
create or replace function public.send_job_message(
  p_job_id uuid,
  p_body text,
  p_idempotency_key text default null
)
returns public.job_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_clean_body text := trim(coalesce(p_body, ''));
  v_existing public.job_messages;
  v_status record;
  v_msg public.job_messages;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if char_length(v_clean_body) < 1 or char_length(v_clean_body) > 1000 then
    raise exception 'Message must be between 1 and 1000 characters.' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.job_messages
    where job_id = p_job_id
      and sender_id = v_uid
      and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_status from public.get_job_chat_status(p_job_id);
  if not coalesce(v_status.can_send, false) then
    raise exception '%', coalesce(v_status.closed_reason, 'You cannot send messages in this chat.')
      using errcode = '42501';
  end if;

  insert into public.job_messages (job_id, sender_id, body, idempotency_key, created_at)
  values (p_job_id, v_uid, v_clean_body, p_idempotency_key, v_now)
  returning * into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.send_job_message(uuid, text, text) from public, anon;
grant execute on function public.send_job_message(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server Functions: block_user, unblock_user & create_user_report (idempotent)
-- ----------------------------------------------------------------------------
create or replace function public.block_user(
  p_blocked_id uuid,
  p_job_id uuid default null,
  p_reason text default null
)
returns public.user_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.user_blocks;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_blocked_id is null or p_blocked_id = v_uid then
    raise exception 'Invalid user to block.' using errcode = '22023';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id, job_id, reason)
  values (v_uid, p_blocked_id, p_job_id, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (blocker_id, blocked_id) do update
    set reason = coalesce(excluded.reason, public.user_blocks.reason)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.unblock_user(p_blocked_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  delete from public.user_blocks
  where blocker_id = v_uid
    and blocked_id = p_blocked_id;

  return true;
end;
$$;

create or replace function public.create_user_report(
  p_reported_user_id uuid,
  p_job_id uuid,
  p_category text,
  p_details text,
  p_idempotency_key text default null
)
returns public.user_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.user_reports;
  v_report public.user_reports;
  v_clean_details text := trim(coalesce(p_details, ''));
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_reported_user_id is null or p_reported_user_id = v_uid then
    raise exception 'Invalid reported user.' using errcode = '22023';
  end if;

  if char_length(v_clean_details) < 5 or char_length(v_clean_details) > 1000 then
    raise exception 'Please provide at least 5 characters explaining the report.'
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.user_reports
    where reporter_id = v_uid
      and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  insert into public.user_reports (
    reporter_id,
    reported_user_id,
    job_id,
    category,
    details,
    status,
    idempotency_key
  )
  values (
    v_uid,
    p_reported_user_id,
    p_job_id,
    p_category,
    v_clean_details,
    'open',
    p_idempotency_key
  )
  returning * into v_report;

  return v_report;
end;
$$;

revoke all on function public.block_user(uuid, uuid, text) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.create_user_report(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.block_user(uuid, uuid, text) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.create_user_report(uuid, uuid, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Respect user_blocks in find_nearby_artisans so blocked users don't match
-- ----------------------------------------------------------------------------
create or replace function public.find_nearby_artisans(
  p_trade public.artisan_trade,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters integer default 10000,
  p_limit integer default 30
)
returns table (
  artisan_id uuid,
  full_name text,
  photo_path text,
  trade public.artisan_trade,
  work_area text,
  rating_avg numeric(3, 2),
  rating_count integer,
  distance_meters integer,
  approx_lat double precision,
  approx_lng double precision,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_status public.account_status;
  v_rlat double precision;
  v_rlng double precision;
  v_origin geography(Point, 4326);
  v_radius integer := least(greatest(coalesce(p_radius_meters, 10000), 500), 10000);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select account_status into v_account_status
  from public.profiles
  where id = v_uid;

  if v_account_status is distinct from 'active' then
    raise exception 'Account is not active.' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Valid search coordinates are required.' using errcode = '22023';
  end if;

  v_rlat := round(p_lat::numeric, 3)::double precision;
  v_rlng := round(p_lng::numeric, 3)::double precision;
  v_origin := st_setsrid(st_makepoint(v_rlng, v_rlat), 4326)::geography;

  return query
  select
    ap.user_id as artisan_id,
    ap.full_name,
    ap.photo_path,
    ap.trade,
    ap.work_area,
    p.rating_avg,
    p.rating_count,
    round(st_distance(ap.approx_location, v_origin))::integer as distance_meters,
    st_y(ap.approx_location::geometry) as approx_lat,
    st_x(ap.approx_location::geometry) as approx_lng,
    ap.last_seen_at
  from public.artisan_profiles ap
  join public.profiles p on p.id = ap.user_id
  where ap.trade = p_trade
    and ap.verification_status = 'approved'
    and p.account_status = 'active'
    and ap.is_online = true
    and ap.last_seen_at >= timezone('utc', now()) - interval '15 minutes'
    and ap.approx_location is not null
    and st_dwithin(ap.approx_location, v_origin, v_radius)
    and not public.is_pair_blocked(v_uid, ap.user_id)
  order by
    st_distance(ap.approx_location, v_origin) asc,
    p.rating_avg desc,
    p.rating_count desc
  limit v_limit;
end;
$$;
