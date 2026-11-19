-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 8: Privacy, Data Download, Pause Account & Full 30-Day
-- Account Deletion (with 6-Year Anonymised Payment Retention & 5-Year Ban Hash)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Preserve anonymised reviews & non-PII financial archives when auth.users is purged
-- ----------------------------------------------------------------------------
alter table public.jobs
  alter column customer_id drop not null;

alter table public.jobs
  drop constraint if exists jobs_customer_id_fkey;
alter table public.jobs
  add constraint jobs_customer_id_fkey
  foreign key (customer_id) references public.profiles (id) on delete set null;

alter table public.reviews
  alter column job_id drop not null;

alter table public.reviews
  drop constraint if exists reviews_job_id_fkey;
alter table public.reviews
  add constraint reviews_job_id_fkey
  foreign key (job_id) references public.jobs (id) on delete set null;

alter table public.payments
  alter column customer_id drop not null,
  alter column artisan_id drop not null;

alter table public.payments
  drop constraint if exists payments_customer_id_fkey,
  drop constraint if exists payments_artisan_id_fkey;
alter table public.payments
  add constraint payments_customer_id_fkey
  foreign key (customer_id) references public.profiles (id) on delete set null;
alter table public.payments
  add constraint payments_artisan_id_fkey
  foreign key (artisan_id) references public.profiles (id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. Table: public.deletion_requests
-- Tracks OTP-verified deletion requests & 30-day scheduled erasure window.
-- ----------------------------------------------------------------------------
create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  status text not null default 'otp_pending' check (status in ('otp_pending', 'scheduled', 'purging', 'completed', 'cancelled')),
  removal_reason text not null default 'user_requested' check (removal_reason in ('user_requested', 'fraud', 'violence', 'admin_removed')),
  otp_hash text null check (otp_hash is null or otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at timestamptz null,
  otp_attempts integer not null default 0 check (otp_attempts >= 0),
  confirmed_at timestamptz null,
  scheduled_purge_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists deletion_requests_scheduled_idx
  on public.deletion_requests (scheduled_purge_at)
  where status = 'scheduled';

alter table public.deletion_requests enable row level security;
alter table public.deletion_requests force row level security;

revoke all on public.deletion_requests from public, anon, authenticated;
grant select (id, user_id, status, removal_reason, confirmed_at, scheduled_purge_at, created_at)
  on public.deletion_requests to authenticated;

drop policy if exists deletion_requests_select_own_or_admin on public.deletion_requests;
create policy deletion_requests_select_own_or_admin
  on public.deletion_requests
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Table: public.payment_archives (6-year statutory retention, NO names/user_ids)
-- ----------------------------------------------------------------------------
create table if not exists public.payment_archives (
  id uuid primary key default gen_random_uuid(),
  provider_reference text not null unique,
  anonymous_customer_ref text not null,
  anonymous_artisan_ref text not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  commission_kobo bigint not null check (commission_kobo >= 0),
  status text not null,
  refund_status text not null,
  paid_at timestamptz null,
  retain_until timestamptz not null,
  archived_at timestamptz not null default timezone('utc', now())
);

create index if not exists payment_archives_retain_idx
  on public.payment_archives (retain_until);

alter table public.payment_archives enable row level security;
alter table public.payment_archives force row level security;

revoke all on public.payment_archives from public, anon, authenticated;
grant select on public.payment_archives to authenticated;

drop policy if exists payment_archives_select_admin on public.payment_archives;
create policy payment_archives_select_admin
  on public.payment_archives
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. Table: public.ban_records (Fraud/Violence ONLY: NIN hash + phone hash up to 5 years)
-- ----------------------------------------------------------------------------
create table if not exists public.ban_records (
  id uuid primary key default gen_random_uuid(),
  nin_hash text null check (nin_hash is null or nin_hash ~ '^[0-9a-f]{64}$'),
  phone_hash text null check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('fraud', 'violence')),
  banned_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '5 years'),
  constraint ban_records_requires_hash check (nin_hash is not null or phone_hash is not null)
);

create index if not exists ban_records_nin_hash_idx on public.ban_records (nin_hash) where nin_hash is not null;
create index if not exists ban_records_phone_hash_idx on public.ban_records (phone_hash) where phone_hash is not null;

alter table public.ban_records enable row level security;
alter table public.ban_records force row level security;

revoke all on public.ban_records from public, anon, authenticated;
grant select on public.ban_records to authenticated;

drop policy if exists ban_records_select_admin on public.ban_records;
create policy ban_records_select_admin
  on public.ban_records
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. Table: public.deletion_logs (NO personal details whatsoever!)
-- ----------------------------------------------------------------------------
create table if not exists public.deletion_logs (
  id uuid primary key default gen_random_uuid(),
  anonymous_ref_id text not null unique,
  role_snapshot text null,
  reason text not null,
  scheduled_at timestamptz null,
  completed_at timestamptz not null default timezone('utc', now()),
  payment_records_archived integer not null default 0,
  storage_files_deleted integer not null default 0,
  ban_record_created boolean not null default false
);

alter table public.deletion_logs enable row level security;
alter table public.deletion_logs force row level security;

revoke all on public.deletion_logs from public, anon, authenticated;
grant select on public.deletion_logs to authenticated;

drop policy if exists deletion_logs_select_admin on public.deletion_logs;
create policy deletion_logs_select_admin
  on public.deletion_logs
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 6. Server Function: public.set_artisan_account_pause (Artisans pause/resume)
-- Hides artisan from search & sets Offline immediately when paused. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.set_artisan_account_pause(p_paused boolean)
returns public.account_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_profile public.profiles;
  v_next public.account_status;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid
  for update;

  if not found or v_profile.role <> 'artisan' then
    raise exception 'Only artisan accounts can be paused.' using errcode = '42501';
  end if;

  if v_profile.account_status in ('suspended', 'deleted') then
    raise exception 'Cannot pause or resume a % account.', v_profile.account_status
      using errcode = '42501';
  end if;

  v_next := case when p_paused then 'paused'::public.account_status else 'active'::public.account_status end;

  perform set_config('app.allow_privileged_profile_update', 'true', true);
  update public.profiles
  set account_status = v_next, updated_at = v_now
  where id = v_uid;

  if p_paused then
    perform set_config('app.allow_privileged_artisan_update', 'true', true);
    update public.artisan_profiles
    set is_online = false, updated_at = v_now
    where user_id = v_uid;
  end if;

  return v_next;
end;
$$;

revoke all on function public.set_artisan_account_pause(boolean) from public, anon;
grant execute on function public.set_artisan_account_pause(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server Function: public.check_account_deletion_blockers
-- Blocks deletion while: job in progress, payout/refund pending, or dispute open.
-- Returns exact counts so UI explains precisely what is blocking and offers Pause.
-- ----------------------------------------------------------------------------
create or replace function public.check_account_deletion_blockers(p_user_id uuid)
returns table (
  can_delete boolean,
  active_jobs_count integer,
  pending_payments_or_refunds_count integer,
  open_disputes_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jobs integer;
  v_payments integer;
  v_disputes integer;
begin
  -- Security guard: only self, admin, or service_role can inspect blockers
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
     and auth.uid() is distinct from p_user_id
     and not public.is_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select count(*)::integer into v_jobs
  from public.jobs j
  where (j.customer_id = p_user_id or j.artisan_id = p_user_id)
    and j.status in ('accepted', 'quoted', 'quote_accepted', 'en_route', 'arrived', 'in_progress', 'completed');

  select count(*)::integer into v_payments
  from public.payments pay
  where (pay.customer_id = p_user_id or pay.artisan_id = p_user_id)
    and (
      pay.status = 'pending'
      or pay.refund_status = 'pending'
      or pay.release_paused = true
    );

  select count(*)::integer into v_disputes
  from public.disputes d
  join public.jobs j on j.id = d.job_id
  where d.status = 'open'
    and (j.customer_id = p_user_id or j.artisan_id = p_user_id or d.opened_by = p_user_id);

  return query
  select
    (v_jobs = 0 and v_payments = 0 and v_disputes = 0),
    v_jobs,
    v_payments,
    v_disputes;
end;
$$;

revoke all on function public.check_account_deletion_blockers(uuid) from public, anon;
grant execute on function public.check_account_deletion_blockers(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Server Function: public.initiate_account_deletion (service_role only)
-- Executed immediately after OTP confirmation (or admin removal):
-- - Checks blockers (unless admin fraud/violence override)
-- - Marks account 'deleted' at once, hides from search (is_online = false)
-- - Deletes push_subscriptions & trusted_contacts immediately
-- - Schedules full personal data erasure within 30 days
-- Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.initiate_account_deletion(
  p_user_id uuid,
  p_removal_reason text default 'user_requested',
  p_force_admin_override boolean default false
)
returns table (
  scheduled boolean,
  scheduled_purge_at timestamptz,
  active_jobs_count integer,
  pending_payments_or_refunds_count integer,
  open_disputes_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_purge_at timestamptz := v_now + interval '30 days';
  v_blockers record;
begin
  select * into v_blockers
  from public.check_account_deletion_blockers(p_user_id);

  if not p_force_admin_override and not v_blockers.can_delete then
    return query select
      false,
      null::timestamptz,
      v_blockers.active_jobs_count,
      v_blockers.pending_payments_or_refunds_count,
      v_blockers.open_disputes_count;
    return;
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);
  perform set_config('app.allow_privileged_artisan_update', 'true', true);

  -- Mark account deleted at once & hide from search
  update public.profiles
  set
    account_status = 'deleted',
    updated_at = v_now
  where id = p_user_id;

  update public.artisan_profiles
  set
    is_online = false,
    approx_location = null,
    updated_at = v_now
  where user_id = p_user_id;

  -- Delete push subscriptions and trusted contacts immediately
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.trusted_contacts where user_id = p_user_id;

  -- Record scheduled 30-day erasure
  insert into public.deletion_requests (
    user_id,
    status,
    removal_reason,
    otp_hash,
    otp_expires_at,
    confirmed_at,
    scheduled_purge_at,
    updated_at
  )
  values (
    p_user_id,
    'scheduled',
    p_removal_reason,
    null,
    null,
    v_now,
    v_purge_at,
    v_now
  )
  on conflict (user_id) do update
    set
      status = 'scheduled',
      removal_reason = excluded.removal_reason,
      otp_hash = null,
      otp_expires_at = null,
      confirmed_at = coalesce(public.deletion_requests.confirmed_at, v_now),
      scheduled_purge_at = coalesce(public.deletion_requests.scheduled_purge_at, v_purge_at),
      updated_at = v_now;

  return query select true, v_purge_at, 0, 0, 0;
end;
$$;

revoke all on function public.initiate_account_deletion(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.initiate_account_deletion(uuid, text, boolean) to service_role;

-- ----------------------------------------------------------------------------
-- 9. Server Function: public.execute_user_data_erasure_db (service_role only)
-- Performs the full DB portion of the 30-day erasure atomically:
-- - Archives payments for 6 years with name/ID replaced by anonymous ref
-- - Preserves NIN & phone hash in ban_records (up to 5 years) ONLY for fraud/violence
-- - Anonymises reviews
-- - Erases profile, artisan_profile, verification, guarantor, identity_hashes,
--   chat messages, private addresses, job photos metadata, push subs, trusted contacts
-- - Writes non-PII deletion_logs record
-- Returns storage file paths so the caller deletes storage objects + auth.users!
-- ----------------------------------------------------------------------------
create or replace function public.execute_user_data_erasure_db(
  p_user_id uuid,
  p_anonymous_ref_id text,
  p_storage_files_deleted integer default 0
)
returns table (
  payment_records_archived integer,
  ban_record_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_req public.deletion_requests;
  v_role text;
  v_nin_hash text;
  v_phone_hash text;
  v_archived_count integer := 0;
  v_ban_created boolean := false;
begin
  select * into v_req
  from public.deletion_requests
  where user_id = p_user_id
  for update;

  select role::text into v_role
  from public.profiles
  where id = p_user_id;

  -- 1. Archive payment records for 6 years with user replaced by anonymous ID
  with archived as (
    insert into public.payment_archives (
      provider_reference,
      anonymous_customer_ref,
      anonymous_artisan_ref,
      amount_kobo,
      commission_kobo,
      status,
      refund_status,
      paid_at,
      retain_until,
      archived_at
    )
    select
      pay.provider_reference,
      case when pay.customer_id = p_user_id then p_anonymous_ref_id else 'user_' || encode(digest(coalesce(pay.customer_id::text, 'none'), 'sha256'), 'hex') end,
      case when pay.artisan_id = p_user_id then p_anonymous_ref_id else 'user_' || encode(digest(coalesce(pay.artisan_id::text, 'none'), 'sha256'), 'hex') end,
      pay.amount_kobo,
      pay.commission_kobo,
      pay.status,
      pay.refund_status,
      pay.paid_at,
      coalesce(pay.paid_at, pay.created_at) + interval '6 years',
      v_now
    from public.payments pay
    where pay.customer_id = p_user_id or pay.artisan_id = p_user_id
    on conflict (provider_reference) do nothing
    returning id
  )
  select count(*)::integer into v_archived_count from archived;

  -- 2. If removed for fraud or violence, keep ONLY NIN hash, phone hash, reason & date (up to 5 years)
  if v_req.removal_reason in ('fraud', 'violence') then
    select hash_value into v_nin_hash
    from public.identity_hashes
    where user_id = p_user_id and hash_type = 'nin';

    select hash_value into v_phone_hash
    from public.identity_hashes
    where user_id = p_user_id and hash_type = 'phone';

    if v_nin_hash is not null or v_phone_hash is not null then
      insert into public.ban_records (nin_hash, phone_hash, reason, banned_at, expires_at)
      values (v_nin_hash, v_phone_hash, v_req.removal_reason, v_now, v_now + interval '5 years');
      v_ban_created := true;
    end if;
  end if;

  -- 3. Anonymise reviews authored by this user (keep rating stats intact without personal identity)
  update public.reviews
  set
    reviewer_id = null,
    reviewer_display_name = 'Anonymous user',
    is_anonymized = true
  where reviewer_id = p_user_id;

  -- 4. Erase personal data: chat, private addresses, job photos metadata, guarantor, verification, hashes
  delete from public.job_messages
  where sender_id = p_user_id
     or job_id in (select id from public.jobs where customer_id = p_user_id or artisan_id = p_user_id);

  delete from public.job_private_addresses
  where job_id in (select id from public.jobs where customer_id = p_user_id);

  update public.jobs
  set
    photo_paths = '{}'::text[],
    description = '[Erased on account deletion]',
    approx_area_label = '[Erased]',
    cancel_reason = null
  where customer_id = p_user_id;

  delete from public.job_shares where created_by = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.trusted_contacts where user_id = p_user_id;
  delete from public.guarantor_verifications where artisan_id = p_user_id;
  delete from public.artisan_verifications where user_id = p_user_id;
  delete from public.identity_hashes where user_id = p_user_id;
  delete from public.artisan_profiles where user_id = p_user_id;
  delete from public.consents where user_id = p_user_id;
  delete from public.alert_deliveries where user_id = p_user_id;
  delete from public.user_blocks where blocker_id = p_user_id or blocked_id = p_user_id;

  -- Disconnect user_id from payments rows (archived safely above for 6 years)
  update public.payments set customer_id = null where customer_id = p_user_id;
  update public.payments set artisan_id = null where artisan_id = p_user_id;

  -- 5. Write deletion log with NO personal details
  insert into public.deletion_logs (
    anonymous_ref_id,
    role_snapshot,
    reason,
    scheduled_at,
    completed_at,
    payment_records_archived,
    storage_files_deleted,
    ban_record_created
  )
  values (
    p_anonymous_ref_id,
    v_role,
    coalesce(v_req.removal_reason, 'user_requested'),
    v_req.scheduled_purge_at,
    v_now,
    v_archived_count,
    p_storage_files_deleted,
    v_ban_created
  )
  on conflict (anonymous_ref_id) do nothing;

  return query select v_archived_count, v_ban_created;
end;
$$;

revoke all on function public.execute_user_data_erasure_db(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.execute_user_data_erasure_db(uuid, text, integer) to service_role;
