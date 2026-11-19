-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 2: Artisan Onboarding, Identity Hashes, Guarantor & Admin
-- Rules enforced at DB layer:
--   - NEVER store raw NIN or bank account details
--   - Same NIN hash cannot be used on two accounts (UNIQUE in identity_hashes)
--   - Selfie stored in private bucket (artisan-verifications, public = false)
--   - Artisan cannot be approved until provider result passed AND guarantor confirmed
--   - Only approved artisans can go Online
--   - Every table has ENABLE + FORCE ROW LEVEL SECURITY
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: public.is_admin(uid)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_uid
      and role = 'admin'
      and account_status = 'active'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- Allow admins to read profiles & audit_log (RLS still blocks non-admins completely)
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin
  on public.audit_log
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- Storage buckets: artisan-photos (public display) & artisan-verifications (PRIVATE)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artisan-photos',
  'artisan-photos',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artisan-verifications',
  'artisan-verifications',
  false, -- STRICTLY PRIVATE: admins access ONLY via 60s signed URLs logged to audit_log
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage RLS policies for artisan-photos
drop policy if exists artisan_photos_public_read on storage.objects;
create policy artisan_photos_public_read
  on storage.objects
  for select
  to public
  using (bucket_id = 'artisan-photos');

drop policy if exists artisan_photos_own_upload on storage.objects;
create policy artisan_photos_own_upload
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'artisan-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists artisan_photos_own_update on storage.objects;
create policy artisan_photos_own_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'artisan-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS policies for PRIVATE artisan-verifications bucket:
-- No direct SELECT/UPDATE/DELETE for anon or authenticated; uploads handled via
-- authenticated server route using service_role after face_matching consent check.
drop policy if exists artisan_verifications_no_direct_read on storage.objects;

-- ----------------------------------------------------------------------------
-- Table: public.artisan_profiles
-- Stores ONLY payment provider recipient/subaccount code (NEVER bank details).
-- ----------------------------------------------------------------------------
create table if not exists public.artisan_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  photo_path text null,
  trade public.artisan_trade not null,
  bio text not null check (char_length(trim(bio)) between 10 and 500),
  work_area text not null check (char_length(trim(work_area)) between 2 and 120),
  payout_recipient_code text null check (payout_recipient_code is null or char_length(trim(payout_recipient_code)) between 4 and 120),
  payout_subaccount_code text null check (payout_subaccount_code is null or char_length(trim(payout_subaccount_code)) between 4 and 120),
  verification_status public.verification_status not null default 'pending',
  rejection_reason text null,
  is_online boolean not null default false,
  reviewed_by uuid null references public.profiles (id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint artisan_online_requires_approved check (
    not is_online or verification_status = 'approved'
  )
);

create index if not exists artisan_profiles_status_idx
  on public.artisan_profiles (verification_status, updated_at desc);

alter table public.artisan_profiles enable row level security;
alter table public.artisan_profiles force row level security;

revoke all on public.artisan_profiles from public, anon, authenticated;
grant select on public.artisan_profiles to authenticated;

drop policy if exists artisan_profiles_select_own on public.artisan_profiles;
create policy artisan_profiles_select_own
  on public.artisan_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists artisan_profiles_select_admin on public.artisan_profiles;
create policy artisan_profiles_select_admin
  on public.artisan_profiles
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Guard trigger so verification_status / payout codes / is_online cannot be mutated directly
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
     or new.is_online is distinct from old.is_online then
    raise exception 'Direct modification of protected artisan verification fields is forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_artisan_profile_protected_columns on public.artisan_profiles;
create trigger trg_guard_artisan_profile_protected_columns
  before update on public.artisan_profiles
  for each row
  execute function public.guard_artisan_profile_protected_columns();

-- ----------------------------------------------------------------------------
-- Table: public.identity_hashes
-- Stores ONLY HMAC-SHA256 keyed hashes of NIN and phone. NEVER raw NIN.
-- Enforces one account per NIN globally via UNIQUE (hash_type, hash_value).
-- Zero direct access for anon/authenticated.
-- ----------------------------------------------------------------------------
create table if not exists public.identity_hashes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hash_type text not null check (hash_type in ('nin', 'phone')),
  hash_value text not null check (hash_value ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint identity_hashes_unique_value unique (hash_type, hash_value),
  constraint identity_hashes_unique_user_type unique (user_id, hash_type)
);

alter table public.identity_hashes enable row level security;
alter table public.identity_hashes force row level security;

revoke all on public.identity_hashes from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Table: public.artisan_verifications
-- Stores ONLY provider reference, liveness/face match result, and private selfie path.
-- NEVER stores NIN.
-- ----------------------------------------------------------------------------
create table if not exists public.artisan_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  provider_name text not null check (char_length(trim(provider_name)) between 2 and 64),
  provider_reference text not null check (char_length(trim(provider_reference)) between 4 and 160),
  provider_status text not null check (provider_status in ('pending', 'passed', 'failed')),
  liveness_passed boolean not null default false,
  face_match_passed boolean not null default false,
  selfie_storage_path text not null check (char_length(trim(selfie_storage_path)) between 4 and 255),
  face_matching_consent_id uuid not null references public.consents (id),
  idempotency_key text null,
  checked_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.artisan_verifications enable row level security;
alter table public.artisan_verifications force row level security;

revoke all on public.artisan_verifications from public, anon, authenticated;
grant select (
  id,
  user_id,
  provider_name,
  provider_reference,
  provider_status,
  liveness_passed,
  face_match_passed,
  checked_at,
  created_at,
  updated_at
) on public.artisan_verifications to authenticated;

drop policy if exists artisan_verifications_select_own on public.artisan_verifications;
create policy artisan_verifications_select_own
  on public.artisan_verifications
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists artisan_verifications_select_admin on public.artisan_verifications;
create policy artisan_verifications_select_admin
  on public.artisan_verifications
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- Table: public.guarantor_verifications
-- Guarantor receives SMS link -> sees privacy notice -> confirms via 6-digit OTP.
-- Raw token and raw OTP are NEVER stored (HMAC-SHA256 hashes only).
-- ----------------------------------------------------------------------------
create table if not exists public.guarantor_verifications (
  id uuid primary key default gen_random_uuid(),
  artisan_id uuid not null unique references public.profiles (id) on delete cascade,
  guarantor_name text not null check (char_length(trim(guarantor_name)) between 2 and 120),
  guarantor_phone_hash text not null check (guarantor_phone_hash ~ '^[0-9a-f]{64}$'),
  guarantor_phone_e164 text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  otp_hash text null check (otp_hash is null or otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at timestamptz null,
  otp_attempts integer not null default 0 check (otp_attempts >= 0),
  privacy_notice_accepted_at timestamptz null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'revoked')),
  confirmed_at timestamptz null,
  sms_sent_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.guarantor_verifications enable row level security;
alter table public.guarantor_verifications force row level security;

revoke all on public.guarantor_verifications from public, anon, authenticated;
grant select (
  id,
  artisan_id,
  guarantor_name,
  status,
  confirmed_at,
  sms_sent_at,
  created_at,
  updated_at
) on public.guarantor_verifications to authenticated;

drop policy if exists guarantor_verifications_select_own on public.guarantor_verifications;
create policy guarantor_verifications_select_own
  on public.guarantor_verifications
  for select
  to authenticated
  using (auth.uid() = artisan_id);

drop policy if exists guarantor_verifications_select_admin on public.guarantor_verifications;
create policy guarantor_verifications_select_admin
  on public.guarantor_verifications
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- Server Function: public.admin_review_artisan
-- Admin approves, rejects (with reason), or suspends (with reason) an artisan.
-- Enforces: CANNOT approve until provider_status='passed' (liveness+face_match)
--           AND guarantor_verifications.status='confirmed'
--           AND payout_recipient_code IS NOT NULL.
-- Idempotent & writes every decision to audit_log.
-- ----------------------------------------------------------------------------
create or replace function public.admin_review_artisan(
  p_artisan_id uuid,
  p_decision public.verification_status,
  p_reason text default null,
  p_idempotency_key text default null
)
returns public.artisan_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_artisan public.artisan_profiles;
  v_verif public.artisan_verifications;
  v_guarantor public.guarantor_verifications;
  v_now timestamptz := timezone('utc', now());
  v_clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected', 'suspended') then
    raise exception 'Decision must be approved, rejected, or suspended.'
      using errcode = '22023';
  end if;

  if p_decision in ('rejected', 'suspended') and (v_clean_reason is null or char_length(v_clean_reason) < 5) then
    raise exception 'A clear reason (at least 5 characters) is required when rejecting or suspending an artisan.'
      using errcode = '22023';
  end if;

  select * into v_artisan
  from public.artisan_profiles
  where user_id = p_artisan_id
  for update;

  if not found then
    raise exception 'Artisan application not found.' using errcode = 'P0002';
  end if;

  -- Idempotency: if already in this exact state with same reason, return safely
  if v_artisan.verification_status = p_decision
     and coalesce(v_artisan.rejection_reason, '') = coalesce(v_clean_reason, '') then
    return v_artisan;
  end if;

  if p_decision = 'approved' then
    select * into v_verif
    from public.artisan_verifications
    where user_id = p_artisan_id;

    if not found
       or v_verif.provider_status <> 'passed'
       or v_verif.liveness_passed is not true
       or v_verif.face_match_passed is not true then
      raise exception 'Cannot approve artisan: NIN face match and liveness verification has not passed.'
        using errcode = '22023';
    end if;

    select * into v_guarantor
    from public.guarantor_verifications
    where artisan_id = p_artisan_id;

    if not found or v_guarantor.status <> 'confirmed' or v_guarantor.confirmed_at is null then
      raise exception 'Cannot approve artisan: guarantor has not confirmed yet.'
        using errcode = '22023';
    end if;

    if v_artisan.payout_recipient_code is null then
      raise exception 'Cannot approve artisan: payout recipient is not configured.'
        using errcode = '22023';
    end if;
  end if;

  perform set_config('app.allow_privileged_artisan_update', 'true', true);
  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update public.artisan_profiles
  set
    verification_status = p_decision,
    rejection_reason = case when p_decision = 'approved' then null else v_clean_reason end,
    is_online = case when p_decision = 'approved' then is_online else false end,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  where user_id = p_artisan_id
  returning * into v_artisan;

  update public.profiles
  set
    verification_status = p_decision,
    account_status = case when p_decision = 'suspended' then 'suspended' else account_status end,
    updated_at = v_now
  where id = p_artisan_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
  values (
    v_admin_id,
    'admin_review_artisan_' || p_decision::text,
    'artisan_profile',
    p_artisan_id::text,
    jsonb_build_object(
      'decision', p_decision::text,
      'reason', coalesce(v_clean_reason, ''),
      'idempotency_key', coalesce(p_idempotency_key, '')
    ),
    v_now
  );

  return v_artisan;
end;
$$;

revoke all on function public.admin_review_artisan(uuid, public.verification_status, text, text) from public, anon;
grant execute on function public.admin_review_artisan(uuid, public.verification_status, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.log_admin_file_access
-- Records every admin open of a private verification file to audit_log.
-- ----------------------------------------------------------------------------
create or replace function public.log_admin_file_access(
  p_artisan_id uuid,
  p_storage_path text,
  p_expires_in_seconds integer default 60
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_log_id uuid;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (
    v_admin_id,
    'admin_open_verification_file',
    'artisan_verification',
    p_artisan_id::text,
    jsonb_build_object(
      'bucket', 'artisan-verifications',
      'storage_path', p_storage_path,
      'expires_in_seconds', p_expires_in_seconds
    )
  )
  returning id into v_log_id;

  return v_log_id;
end;
$$;

revoke all on function public.log_admin_file_access(uuid, text, integer) from public, anon;
grant execute on function public.log_admin_file_access(uuid, text, integer) to authenticated;
