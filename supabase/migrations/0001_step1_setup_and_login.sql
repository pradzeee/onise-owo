-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 1: Setup, Auth Profiles, Consents, Rate Limits & RLS
-- All timestamps stored in UTC (timestamptz). Displayed in Africa/Lagos in UI.
-- Money columns in later migrations use BIGINT kobo (never decimals).
-- ============================================================================

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('customer', 'artisan', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum ('active', 'paused', 'suspended', 'deleted');
  end if;

  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum ('unverified', 'pending', 'approved', 'rejected', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'consent_type') then
    create type public.consent_type as enum (
      'age_18_plus',
      'terms_of_service',
      'privacy_policy',
      'location',
      'notifications',
      'face_matching'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'artisan_trade') then
    create type public.artisan_trade as enum (
      'plumber',
      'electrician',
      'tailor',
      'carpenter',
      'mechanic',
      'painter',
      'makeup_artist'
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Table: public.profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role null,
  display_name text null check (display_name is null or char_length(trim(display_name)) between 2 and 100),
  account_status public.account_status not null default 'active',
  verification_status public.verification_status not null default 'unverified',
  rating_avg numeric(3, 2) not null default 0.00 check (rating_avg >= 0 and rating_avg <= 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  onboarding_completed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Lock down direct privileges: authenticated users can only read their own row
-- and update non-sensitive display_name. Protected columns are double-guarded
-- by column grants AND a BEFORE UPDATE trigger.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Automatically update updated_at and block direct mutation of privileged fields
create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
as $$
declare
  v_allow_privileged boolean := coalesce(current_setting('app.allow_privileged_profile_update', true), '') = 'true';
  v_jwt_role text := coalesce(auth.role(), '');
begin
  new.updated_at := timezone('utc', now());

  -- Allow trusted server functions (setting GUC), service_role, or direct DB admin sessions
  if v_allow_privileged
     or v_jwt_role = 'service_role'
     or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.account_status is distinct from old.account_status
     or new.verification_status is distinct from old.verification_status
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count
     or new.onboarding_completed_at is distinct from old.onboarding_completed_at then
    raise exception 'Direct modification of protected profile fields is forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_protected_columns on public.profiles;
create trigger trg_guard_profile_protected_columns
  before update on public.profiles
  for each row
  execute function public.guard_profile_protected_columns();

-- Auto-create profile when a new auth.users record is created (idempotent)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- Table: public.consents
-- Stores every consent with type, version, UTC time, and optional withdrawal.
-- ----------------------------------------------------------------------------
create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type public.consent_type not null,
  version text not null check (char_length(trim(version)) between 1 and 64),
  granted boolean not null default true,
  consented_at timestamptz not null default timezone('utc', now()),
  withdrawn_at timestamptz null,
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint consents_withdrawal_consistency check (
    (granted = true and withdrawn_at is null)
    or (granted = false and withdrawn_at is not null)
  )
);

-- At most one active (not withdrawn) consent per (user_id, consent_type)
create unique index if not exists consents_one_active_per_type_idx
  on public.consents (user_id, consent_type)
  where granted = true and withdrawn_at is null;

-- Idempotency key deduplication per user & consent type
create unique index if not exists consents_idempotency_idx
  on public.consents (user_id, consent_type, idempotency_key)
  where idempotency_key is not null;

create index if not exists consents_user_id_idx
  on public.consents (user_id, consented_at desc);

alter table public.consents enable row level security;
alter table public.consents force row level security;

revoke all on public.consents from public, anon, authenticated;
grant select on public.consents to authenticated;

drop policy if exists consents_select_own on public.consents;
create policy consents_select_own
  on public.consents
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Table: public.rate_limits
-- Stores ONLY HMAC-hashed keys (never raw phone numbers or raw IPs).
-- Zero direct access for anon/authenticated.
-- ----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 1 check (request_count >= 0),
  last_request_at timestamptz not null default timezone('utc', now())
);

alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

revoke all on public.rate_limits from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Table: public.audit_log
-- Append-only security & admin audit log. Never store PII (phones, NINs, etc.)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid null references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

revoke all on public.audit_log from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.complete_onboarding
-- Allows a newly logged-in user to pick 'customer' or 'artisan' (NEVER 'admin')
-- and atomically records mandatory 18+, Terms, and Privacy consents.
-- Safe to run twice (idempotent).
-- ----------------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_role public.user_role,
  p_terms_version text,
  p_privacy_version text,
  p_accepted_required boolean,
  p_idempotency_key text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('customer', 'artisan') then
    raise exception 'Invalid role. Users can only choose customer or artisan.'
      using errcode = '42501';
  end if;

  if p_accepted_required is not true then
    raise exception 'You must confirm you are 18+ and accept the Terms of Service and Privacy Policy.'
      using errcode = '22023';
  end if;

  if p_terms_version is null or char_length(trim(p_terms_version)) = 0
     or p_privacy_version is null or char_length(trim(p_privacy_version)) = 0 then
    raise exception 'Valid terms and privacy versions are required.'
      using errcode = '22023';
  end if;

  -- Ensure profile exists (defensive & idempotent)
  insert into public.profiles (id)
  values (v_uid)
  on conflict (id) do nothing;

  select * into v_profile
  from public.profiles
  where id = v_uid
  for update;

  if v_profile.account_status <> 'active' then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  if v_profile.role is not null and v_profile.role <> p_role then
    raise exception 'Role is already assigned and cannot be changed.'
      using errcode = '42501';
  end if;

  if v_profile.role is null then
    perform set_config('app.allow_privileged_profile_update', 'true', true);

    update public.profiles
    set
      role = p_role,
      onboarding_completed_at = coalesce(onboarding_completed_at, v_now),
      updated_at = v_now
    where id = v_uid
    returning * into v_profile;
  end if;

  -- Record mandatory consents idempotently
  insert into public.consents (user_id, consent_type, version, granted, consented_at, idempotency_key)
  values (
    v_uid,
    'age_18_plus',
    p_terms_version,
    true,
    v_now,
    case when p_idempotency_key is not null then p_idempotency_key || ':age_18_plus' else null end
  )
  on conflict do nothing;

  insert into public.consents (user_id, consent_type, version, granted, consented_at, idempotency_key)
  values (
    v_uid,
    'terms_of_service',
    p_terms_version,
    true,
    v_now,
    case when p_idempotency_key is not null then p_idempotency_key || ':terms' else null end
  )
  on conflict do nothing;

  insert into public.consents (user_id, consent_type, version, granted, consented_at, idempotency_key)
  values (
    v_uid,
    'privacy_policy',
    p_privacy_version,
    true,
    v_now,
    case when p_idempotency_key is not null then p_idempotency_key || ':privacy' else null end
  )
  on conflict do nothing;

  return v_profile;
end;
$$;

revoke all on function public.complete_onboarding(public.user_role, text, text, boolean, text) from public, anon;
grant execute on function public.complete_onboarding(public.user_role, text, text, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.set_optional_consent
-- Grants or withdraws optional consents: location, notifications, face_matching.
-- face_matching is restricted to artisans. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.set_optional_consent(
  p_consent_type public.consent_type,
  p_granted boolean,
  p_version text,
  p_idempotency_key text default null
)
returns public.consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_existing public.consents;
  v_result public.consents;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_consent_type not in ('location', 'notifications', 'face_matching') then
    raise exception 'Only location, notifications, and face_matching consents can be toggled here.'
      using errcode = '22023';
  end if;

  if p_version is null or char_length(trim(p_version)) = 0 then
    raise exception 'Consent version is required.' using errcode = '22023';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is null then
    raise exception 'Complete onboarding before managing optional consents.'
      using errcode = '42501';
  end if;

  if p_consent_type = 'face_matching' and v_role <> 'artisan' then
    raise exception 'Face matching consent is only applicable to artisans.'
      using errcode = '42501';
  end if;

  -- Check existing active consent
  select * into v_existing
  from public.consents
  where user_id = v_uid
    and consent_type = p_consent_type
    and granted = true
    and withdrawn_at is null
  for update;

  if p_granted then
    -- Idempotent: if already granted with same version, return as-is
    if found and v_existing.version = p_version then
      return v_existing;
    end if;

    -- If granted with older version, supersede cleanly
    if found then
      update public.consents
      set granted = false, withdrawn_at = v_now
      where id = v_existing.id;
    end if;

    insert into public.consents (user_id, consent_type, version, granted, consented_at, idempotency_key)
    values (v_uid, p_consent_type, p_version, true, v_now, p_idempotency_key)
    on conflict do nothing
    returning * into v_result;

    if v_result.id is null then
      select * into v_result
      from public.consents
      where user_id = v_uid
        and consent_type = p_consent_type
        and granted = true
        and withdrawn_at is null
      limit 1;
    end if;

    return v_result;
  else
    -- Withdraw active consent (idempotent if already withdrawn)
    if found then
      update public.consents
      set granted = false, withdrawn_at = v_now
      where id = v_existing.id
      returning * into v_result;
      return v_result;
    end if;

    select * into v_result
    from public.consents
    where user_id = v_uid
      and consent_type = p_consent_type
    order by consented_at desc
    limit 1;

    return v_result;
  end if;
end;
$$;

revoke all on function public.set_optional_consent(public.consent_type, boolean, text, text) from public, anon;
grant execute on function public.set_optional_consent(public.consent_type, boolean, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.consume_rate_limit (service_role only)
-- Atomic sliding/fixed window rate limiter with optional minimum cooldown.
-- ----------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_max_requests integer,
  p_window_seconds integer,
  p_cooldown_seconds integer default 0
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.rate_limits;
  v_elapsed_window numeric;
  v_elapsed_since_last numeric;
begin
  if p_key_hash is null or char_length(p_key_hash) < 16 then
    raise exception 'Invalid rate limit key hash' using errcode = '22023';
  end if;

  select * into v_row
  from public.rate_limits
  where key_hash = p_key_hash
  for update;

  if not found then
    insert into public.rate_limits (key_hash, window_started_at, request_count, last_request_at)
    values (p_key_hash, v_now, 1, v_now);
    return query select true, greatest(p_max_requests - 1, 0), 0;
    return;
  end if;

  v_elapsed_window := extract(epoch from (v_now - v_row.window_started_at));
  v_elapsed_since_last := extract(epoch from (v_now - v_row.last_request_at));

  -- Check minimum cooldown between consecutive requests (e.g. 60s OTP resend)
  if p_cooldown_seconds > 0 and v_elapsed_since_last < p_cooldown_seconds then
    return query select
      false,
      0,
      greatest(ceil(p_cooldown_seconds - v_elapsed_since_last)::integer, 1);
    return;
  end if;

  -- Window expired -> reset counter
  if v_elapsed_window >= p_window_seconds then
    update public.rate_limits
    set
      window_started_at = v_now,
      request_count = 1,
      last_request_at = v_now
    where key_hash = p_key_hash;

    return query select true, greatest(p_max_requests - 1, 0), 0;
    return;
  end if;

  -- Within window -> check limit
  if v_row.request_count >= p_max_requests then
    return query select
      false,
      0,
      greatest(ceil(p_window_seconds - v_elapsed_window)::integer, 1);
    return;
  end if;

  update public.rate_limits
  set
    request_count = request_count + 1,
    last_request_at = v_now
  where key_hash = p_key_hash;

  return query select true, greatest(p_max_requests - (v_row.request_count + 1), 0), 0;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer, integer) to service_role;
