-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 9: Admin Two-Step Login (TOTP MFA), Urgent Safety Suspensions
-- (2-Business-Day Human Review), Dispute Resolution, Report Management & Removal
-- Every admin action is logged in public.audit_log.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.admin_totp_secrets (server-only, zero direct user access)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_totp_secrets (
  admin_id uuid primary key references public.profiles (id) on delete cascade,
  secret_base32 text not null check (char_length(secret_base32) >= 16),
  verified_at timestamptz null,
  last_used_step bigint null, -- Prevents TOTP code replay within the same 30s window
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.admin_totp_secrets enable row level security;
alter table public.admin_totp_secrets force row level security;
revoke all on public.admin_totp_secrets from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Table: public.admin_mfa_sessions (tracks active two-step verified admin sessions)
-- Token is stored ONLY as HMAC-SHA256 hash. Zero direct user access.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_mfa_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  session_token_hash text not null unique check (session_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_mfa_sessions_admin_idx
  on public.admin_mfa_sessions (admin_id, expires_at desc);

alter table public.admin_mfa_sessions enable row level security;
alter table public.admin_mfa_sessions force row level security;
revoke all on public.admin_mfa_sessions from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Table: public.safety_suspensions
-- Urgent safety suspensions apply immediately and require human review within 2 business days.
-- ----------------------------------------------------------------------------
create table if not exists public.safety_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  suspended_by uuid null references public.profiles (id) on delete set null,
  is_urgent boolean not null default true,
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  applied_at timestamptz not null default timezone('utc', now()),
  human_review_due_at timestamptz not null,
  review_outcome text not null default 'pending' check (review_outcome in ('pending', 'upheld', 'lifted')),
  human_reviewed_by uuid null references public.profiles (id) on delete set null,
  human_reviewed_at timestamptz null,
  review_notes text null check (review_notes is null or char_length(trim(review_notes)) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists safety_suspensions_pending_idx
  on public.safety_suspensions (human_review_due_at asc)
  where review_outcome = 'pending';

create index if not exists safety_suspensions_user_idx
  on public.safety_suspensions (user_id, applied_at desc);

alter table public.safety_suspensions enable row level security;
alter table public.safety_suspensions force row level security;

revoke all on public.safety_suspensions from public, anon, authenticated;
grant select on public.safety_suspensions to authenticated;

drop policy if exists safety_suspensions_select_admin on public.safety_suspensions;
create policy safety_suspensions_select_admin
  on public.safety_suspensions
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. Server Function: public.admin_suspend_user
-- Applies suspension immediately (sets account_status='suspended', takes artisan Offline),
-- creates safety_suspensions row with 2-business-day review SLA, and writes audit_log.
-- ----------------------------------------------------------------------------
create or replace function public.admin_suspend_user(
  p_target_user_id uuid,
  p_reason text,
  p_is_urgent boolean default true,
  p_human_review_due_at timestamptz default null
)
returns public.safety_suspensions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_clean_reason text := trim(coalesce(p_reason, ''));
  v_target_role public.user_role;
  v_due timestamptz := coalesce(p_human_review_due_at, v_now + interval '2 days');
  v_susp public.safety_suspensions;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  if p_target_user_id = v_admin_id then
    raise exception 'Admins cannot suspend their own account.' using errcode = '22023';
  end if;

  if char_length(v_clean_reason) < 5 then
    raise exception 'A suspension reason of at least 5 characters is required.'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_target_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  if v_target_role = 'admin' then
    raise exception 'Cannot suspend another admin account from the web dashboard.'
      using errcode = '42501';
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);
  perform set_config('app.allow_privileged_artisan_update', 'true', true);

  update public.profiles
  set
    account_status = 'suspended',
    verification_status = case when role = 'artisan' then 'suspended'::public.verification_status else verification_status end,
    updated_at = v_now
  where id = p_target_user_id;

  update public.artisan_profiles
  set
    verification_status = 'suspended',
    is_online = false,
    rejection_reason = v_clean_reason,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  where user_id = p_target_user_id;

  insert into public.safety_suspensions (
    user_id,
    suspended_by,
    is_urgent,
    reason,
    applied_at,
    human_review_due_at,
    review_outcome,
    created_at,
    updated_at
  )
  values (
    p_target_user_id,
    v_admin_id,
    coalesce(p_is_urgent, true),
    v_clean_reason,
    v_now,
    v_due,
    'pending',
    v_now,
    v_now
  )
  returning * into v_susp;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
  values (
    v_admin_id,
    case when p_is_urgent then 'admin_urgent_safety_suspension' else 'admin_suspend_user' end,
    'profile',
    p_target_user_id::text,
    jsonb_build_object(
      'suspension_id', v_susp.id,
      'is_urgent', coalesce(p_is_urgent, true),
      'reason', v_clean_reason,
      'human_review_due_at', v_due
    ),
    v_now
  );

  return v_susp;
end;
$$;

revoke all on function public.admin_suspend_user(uuid, text, boolean, timestamptz) from public, anon;
grant execute on function public.admin_suspend_user(uuid, text, boolean, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Server Function: public.admin_review_safety_suspension
-- Human reviewer upholds or lifts an urgent safety suspension within 2 business days.
-- Idempotent & logged to audit_log.
-- ----------------------------------------------------------------------------
create or replace function public.admin_review_safety_suspension(
  p_suspension_id uuid,
  p_outcome text,
  p_notes text
)
returns public.safety_suspensions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_clean_notes text := trim(coalesce(p_notes, ''));
  v_susp public.safety_suspensions;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  if p_outcome not in ('upheld', 'lifted') then
    raise exception 'Review outcome must be upheld or lifted.' using errcode = '22023';
  end if;

  if char_length(v_clean_notes) < 5 then
    raise exception 'Review notes (at least 5 characters) are required.' using errcode = '22023';
  end if;

  select * into v_susp
  from public.safety_suspensions
  where id = p_suspension_id
  for update;

  if not found then
    raise exception 'Safety suspension record not found.' using errcode = 'P0002';
  end if;

  if v_susp.review_outcome = p_outcome then
    return v_susp;
  end if;

  update public.safety_suspensions
  set
    review_outcome = p_outcome,
    human_reviewed_by = v_admin_id,
    human_reviewed_at = v_now,
    review_notes = v_clean_notes,
    updated_at = v_now
  where id = p_suspension_id
  returning * into v_susp;

  if p_outcome = 'lifted' then
    perform set_config('app.allow_privileged_profile_update', 'true', true);
    perform set_config('app.allow_privileged_artisan_update', 'true', true);

    update public.profiles
    set
      account_status = 'active',
      verification_status = case when role = 'artisan' then 'approved'::public.verification_status else verification_status end,
      updated_at = v_now
    where id = v_susp.user_id
      and account_status = 'suspended';

    update public.artisan_profiles
    set
      verification_status = 'approved',
      rejection_reason = null,
      updated_at = v_now
    where user_id = v_susp.user_id
      and verification_status = 'suspended';
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
  values (
    v_admin_id,
    'admin_review_safety_suspension_' || p_outcome,
    'safety_suspension',
    p_suspension_id::text,
    jsonb_build_object(
      'user_id', v_susp.user_id,
      'outcome', p_outcome,
      'notes', v_clean_notes
    ),
    v_now
  );

  return v_susp;
end;
$$;

revoke all on function public.admin_review_safety_suspension(uuid, text, text) from public, anon;
grant execute on function public.admin_review_safety_suspension(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server Function: public.admin_resolve_dispute
-- Resolves an open dispute (resolved_release | resolved_refund | dismissed),
-- updates job & payment state atomically, and logs to audit_log. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.admin_resolve_dispute(
  p_dispute_id uuid,
  p_resolution text,
  p_notes text
)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_clean_notes text := trim(coalesce(p_notes, ''));
  v_dispute public.disputes;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  if p_resolution not in ('resolved_release', 'resolved_refund', 'dismissed') then
    raise exception 'Resolution must be resolved_release, resolved_refund, or dismissed.'
      using errcode = '22023';
  end if;

  if char_length(v_clean_notes) < 5 then
    raise exception 'Resolution notes (at least 5 characters) are required.' using errcode = '22023';
  end if;

  select * into v_dispute
  from public.disputes
  where id = p_dispute_id
  for update;

  if not found then
    raise exception 'Dispute not found.' using errcode = 'P0002';
  end if;

  if v_dispute.status = p_resolution then
    return v_dispute;
  end if;

  update public.disputes
  set
    status = p_resolution,
    resolved_by = v_admin_id,
    resolved_at = v_now,
    resolution_notes = v_clean_notes,
    updated_at = v_now
  where id = p_dispute_id
  returning * into v_dispute;

  if p_resolution = 'resolved_refund' then
    update public.jobs
    set status = 'refunded', updated_at = v_now
    where id = v_dispute.job_id;

    update public.payments
    set
      refund_status = case when status = 'paid' then 'pending' else refund_status end,
      release_paused = true,
      updated_at = v_now
    where job_id = v_dispute.job_id;
  else
    -- resolved_release or dismissed -> release payment & confirm job
    update public.jobs
    set
      status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, v_now),
      updated_at = v_now
    where id = v_dispute.job_id;

    update public.payments
    set
      release_paused = false,
      updated_at = v_now
    where job_id = v_dispute.job_id;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
  values (
    v_admin_id,
    'admin_resolve_dispute_' || p_resolution,
    'dispute',
    p_dispute_id::text,
    jsonb_build_object(
      'job_id', v_dispute.job_id,
      'resolution', p_resolution,
      'notes', v_clean_notes
    ),
    v_now
  );

  return v_dispute;
end;
$$;

revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server Function: public.admin_update_report
-- Updates user_reports status ('reviewing' | 'resolved' | 'dismissed') & logs to audit_log.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_report(
  p_report_id uuid,
  p_status text,
  p_notes text default null
)
returns public.user_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_clean_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_report public.user_reports;
begin
  if v_admin_id is null or not public.is_admin(v_admin_id) then
    raise exception 'Admin privileges required.' using errcode = '42501';
  end if;

  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'Report status must be reviewing, resolved, or dismissed.'
      using errcode = '22023';
  end if;

  select * into v_report
  from public.user_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;

  if v_report.status = p_status and coalesce(v_report.resolution_notes, '') = coalesce(v_clean_notes, '') then
    return v_report;
  end if;

  update public.user_reports
  set
    status = p_status,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    resolution_notes = coalesce(v_clean_notes, resolution_notes)
  where id = p_report_id
  returning * into v_report;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
  values (
    v_admin_id,
    'admin_update_report_' || p_status,
    'user_report',
    p_report_id::text,
    jsonb_build_object(
      'reported_user_id', v_report.reported_user_id,
      'status', p_status,
      'notes', coalesce(v_clean_notes, '')
    ),
    v_now
  );

  return v_report;
end;
$$;

revoke all on function public.admin_update_report(uuid, text, text) from public, anon;
grant execute on function public.admin_update_report(uuid, text, text) to authenticated;
