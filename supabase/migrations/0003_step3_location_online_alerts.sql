-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 3: Location (~100m rounded, no history), Online Presence,
-- Nearby Discovery (10 km PostGIS), Web Push & 30s SMS Fallback Alerts
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend public.artisan_profiles with single rounded location + last_seen_at
-- NO location history table is created. Coordinates are rounded to 0.001 deg (~100m).
-- ----------------------------------------------------------------------------
alter table public.artisan_profiles
  add column if not exists approx_location geography(Point, 4326) null,
  add column if not exists last_seen_at timestamptz null;

create index if not exists artisan_profiles_approx_location_gix
  on public.artisan_profiles
  using gist (approx_location)
  where is_online = true and verification_status = 'approved';

create index if not exists artisan_profiles_online_last_seen_idx
  on public.artisan_profiles (last_seen_at)
  where is_online = true;

-- Extend protected column guard to also cover approx_location & last_seen_at
create or replace function public.guard_artisan_profile_protected_columns()
returns trigger
language plpgsql
as $$
declare
  v_allow boolean := coalesce(current_setting('app.allow_privileged_artisan_update', true), '') = 'true';
  v_jwt_role text := coalesce(auth.role(), '');
begin
  new.updated_at := timezone('utc', now());

  if v_allow
     or v_jwt_role = 'service_role'
     or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.verification_status is distinct from old.verification_status
     or new.rejection_reason is distinct from old.rejection_reason
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.payout_recipient_code is distinct from old.payout_recipient_code
     or new.payout_subaccount_code is distinct from old.payout_subaccount_code
     or new.is_online is distinct from old.is_online
     or new.approx_location is distinct from old.approx_location
     or new.last_seen_at is distinct from old.last_seen_at then
    raise exception 'Direct modification of protected artisan verification or presence fields is forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Server Function: public.set_artisan_presence
-- Only APPROVED, active artisans with active 'location' consent can go Online.
-- Rounds lat/lng to 3 decimal places (~100m) and overwrites single point in place.
-- Safe to run twice (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.set_artisan_presence(
  p_is_online boolean,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (
  is_online boolean,
  last_seen_at timestamptz,
  approx_lat double precision,
  approx_lng double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_artisan public.artisan_profiles;
  v_account_status public.account_status;
  v_has_loc_consent boolean;
  v_now timestamptz := timezone('utc', now());
  v_rlat double precision;
  v_rlng double precision;
  v_point geography(Point, 4326);
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

  select * into v_artisan
  from public.artisan_profiles
  where user_id = v_uid
  for update;

  if not found then
    raise exception 'Artisan profile not found. Complete artisan verification first.'
      using errcode = 'P0002';
  end if;

  perform set_config('app.allow_privileged_artisan_update', 'true', true);

  if p_is_online is not true then
    update public.artisan_profiles
    set
      is_online = false,
      updated_at = v_now
    where user_id = v_uid
    returning * into v_artisan;

    return query
    select
      v_artisan.is_online,
      v_artisan.last_seen_at,
      case when v_artisan.approx_location is not null then st_y(v_artisan.approx_location::geometry) else null end,
      case when v_artisan.approx_location is not null then st_x(v_artisan.approx_location::geometry) else null end;
    return;
  end if;

  -- Going Online / sending 60s heartbeat
  if v_artisan.verification_status <> 'approved' then
    raise exception 'Only approved artisans can go Online.' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.consents
    where user_id = v_uid
      and consent_type = 'location'
      and granted = true
      and withdrawn_at is null
  ) into v_has_loc_consent;

  if not v_has_loc_consent then
    raise exception 'Location consent is required before going Online.'
      using errcode = '42501';
  end if;

  if p_lat is not null and p_lng is not null then
    if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
      raise exception 'Invalid coordinates.' using errcode = '22023';
    end if;

    -- Round to 3 decimal places (~111m latitude, ~109m longitude in Nigeria)
    v_rlat := round(p_lat::numeric, 3)::double precision;
    v_rlng := round(p_lng::numeric, 3)::double precision;
    v_point := st_setsrid(st_makepoint(v_rlng, v_rlat), 4326)::geography;
  else
    if v_artisan.approx_location is null then
      raise exception 'Location coordinates are required to go Online.'
        using errcode = '22023';
    end if;
    v_point := v_artisan.approx_location;
  end if;

  update public.artisan_profiles
  set
    is_online = true,
    approx_location = v_point,
    last_seen_at = v_now,
    updated_at = v_now
  where user_id = v_uid
  returning * into v_artisan;

  return query
  select
    v_artisan.is_online,
    v_artisan.last_seen_at,
    st_y(v_artisan.approx_location::geometry),
    st_x(v_artisan.approx_location::geometry);
end;
$$;

revoke all on function public.set_artisan_presence(boolean, double precision, double precision) from public, anon;
grant execute on function public.set_artisan_presence(boolean, double precision, double precision) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Server Function: public.expire_stale_online_artisans (service_role only)
-- Sets artisans Offline after 15 minutes without a heartbeat signal. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.expire_stale_online_artisans()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform set_config('app.allow_privileged_artisan_update', 'true', true);

  with updated as (
    update public.artisan_profiles
    set
      is_online = false,
      updated_at = timezone('utc', now())
    where is_online = true
      and (
        last_seen_at is null
        or last_seen_at < timezone('utc', now()) - interval '15 minutes'
      )
    returning user_id
  )
  select count(*)::integer into v_count from updated;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_online_artisans() from public, anon, authenticated;
grant execute on function public.expire_stale_online_artisans() to service_role;

-- ----------------------------------------------------------------------------
-- 4. Server Function: public.find_nearby_artisans
-- Returns verified ('approved'), Online (active within 15 min) artisans within 10 km,
-- sorted by distance ASC then rating DESC.
-- NEVER returns phone numbers, payout codes, guarantor details, or exact addresses.
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

  -- Round search coordinate to ~100m
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
  order by
    st_distance(ap.approx_location, v_origin) asc,
    p.rating_avg desc,
    p.rating_count desc
  limit v_limit;
end;
$$;

revoke all on function public.find_nearby_artisans(public.artisan_trade, double precision, double precision, integer, integer) from public, anon;
grant execute on function public.find_nearby_artisans(public.artisan_trade, double precision, double precision, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Table: public.push_subscriptions
-- Stores browser Web Push subscriptions per user (idempotent by endpoint).
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 10 and 2048),
  p256dh text not null check (char_length(p256dh) between 10 and 512),
  auth text not null check (char_length(auth) between 10 and 512),
  user_agent text null check (user_agent is null or char_length(user_agent) <= 255),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint push_subscriptions_unique_user_endpoint unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists push_subscriptions_own_all on public.push_subscriptions;
create policy push_subscriptions_own_all
  on public.push_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 6. Table: public.alert_deliveries
-- Tracks Web Push delivery + 30-second SMS backup alert (idempotent, no PII text).
-- ----------------------------------------------------------------------------
create table if not exists public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  alert_type text not null check (alert_type in ('job_request', 'quote_update', 'job_status', 'test_alert')),
  reference_id text null,
  idempotency_key text not null unique,
  ack_token_hash text not null check (ack_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'push_sent', 'push_delivered', 'sms_sent', 'failed')),
  push_attempted_at timestamptz null,
  push_delivered_at timestamptz null,
  sms_fallback_due_at timestamptz not null default (timezone('utc', now()) + interval '30 seconds'),
  sms_fallback_claimed_at timestamptz null,
  sms_fallback_sent_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists alert_deliveries_fallback_due_idx
  on public.alert_deliveries (sms_fallback_due_at)
  where push_delivered_at is null
    and sms_fallback_sent_at is null
    and sms_fallback_claimed_at is null
    and status in ('pending', 'push_sent');

create index if not exists alert_deliveries_user_idx
  on public.alert_deliveries (user_id, created_at desc);

alter table public.alert_deliveries enable row level security;
alter table public.alert_deliveries force row level security;

revoke all on public.alert_deliveries from public, anon, authenticated;
grant select (
  id,
  user_id,
  alert_type,
  reference_id,
  status,
  push_attempted_at,
  push_delivered_at,
  sms_fallback_due_at,
  sms_fallback_sent_at,
  created_at
) on public.alert_deliveries to authenticated;

drop policy if exists alert_deliveries_select_own on public.alert_deliveries;
create policy alert_deliveries_select_own
  on public.alert_deliveries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists alert_deliveries_select_admin on public.alert_deliveries;
create policy alert_deliveries_select_admin
  on public.alert_deliveries
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 7. Atomic claim function for 30s SMS backup alerts (service_role only)
-- Uses FOR UPDATE SKIP LOCKED so backup SMS is sent at most once.
-- ----------------------------------------------------------------------------
create or replace function public.claim_due_sms_fallback_alerts(p_limit integer default 25)
returns table (
  alert_id uuid,
  user_id uuid,
  alert_type text,
  reference_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  return query
  with due as (
    select ad.id
    from public.alert_deliveries ad
    where ad.status in ('pending', 'push_sent')
      and ad.push_delivered_at is null
      and ad.sms_fallback_sent_at is null
      and ad.sms_fallback_claimed_at is null
      and ad.sms_fallback_due_at <= v_now
    order by ad.sms_fallback_due_at asc
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.alert_deliveries ad
    set
      sms_fallback_claimed_at = v_now,
      updated_at = v_now
    from due
    where ad.id = due.id
    returning ad.id, ad.user_id, ad.alert_type, ad.reference_id
  )
  select c.id, c.user_id, c.alert_type, c.reference_id from claimed c;
end;
$$;

revoke all on function public.claim_due_sms_fallback_alerts(integer) from public, anon, authenticated;
grant execute on function public.claim_due_sms_fallback_alerts(integer) to service_role;
