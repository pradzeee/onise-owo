-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 6: Payments (Pay After Job, Paystack Subaccount + 15% Fee),
-- Webhook Idempotency, First-Time Cap, 24h Auto-Confirm, Disputes & Reconciliation
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: public.payments
-- Stores ONLY provider_reference, amount_kobo, commission_kobo, status, refund_status.
-- NEVER stores card details or bank account details.
-- All money is BIGINT whole kobo.
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  artisan_id uuid not null references public.profiles (id) on delete cascade,
  provider_reference text not null unique check (char_length(trim(provider_reference)) between 6 and 160),
  amount_kobo bigint not null check (amount_kobo > 0),
  commission_kobo bigint not null check (commission_kobo >= 0 and commission_kobo <= amount_kobo),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'amount_mismatch')),
  refund_status text not null default 'none' check (refund_status in ('none', 'pending', 'refunded', 'failed')),
  release_paused boolean not null default false,
  paid_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- At most one paid record per job (prevents double-paying a job)
create unique index if not exists payments_one_paid_per_job_idx
  on public.payments (job_id)
  where status = 'paid';

create index if not exists payments_job_created_idx
  on public.payments (job_id, created_at desc);

create index if not exists payments_paid_at_idx
  on public.payments (paid_at desc)
  where status = 'paid';

alter table public.payments enable row level security;
alter table public.payments force row level security;

revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to authenticated;

drop policy if exists payments_select_participants on public.payments;
create policy payments_select_participants
  on public.payments
  for select
  to authenticated
  using (
    auth.uid() = customer_id
    or auth.uid() = artisan_id
    or public.is_admin(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 2. Table: public.webhook_events (unique provider_event_id prevents double-processing)
-- Zero access for anon/authenticated (admins can inspect).
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack' check (char_length(trim(provider)) between 2 and 40),
  provider_event_id text not null unique check (char_length(trim(provider_event_id)) between 4 and 200),
  event_type text not null,
  provider_reference text null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processed' check (status in ('processed', 'ignored', 'mismatch', 'failed')),
  received_at timestamptz not null default timezone('utc', now())
);

create index if not exists webhook_events_received_idx
  on public.webhook_events (received_at desc);

alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;

revoke all on public.webhook_events from public, anon, authenticated;
grant select on public.webhook_events to authenticated;

drop policy if exists webhook_events_select_admin on public.webhook_events;
create policy webhook_events_select_admin
  on public.webhook_events
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Table: public.disputes (pauses release & blocks 24h auto-confirmation)
-- ----------------------------------------------------------------------------
create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  opened_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (
    reason in (
      'incomplete_work',
      'poor_quality',
      'property_damage',
      'overcharge_dispute',
      'no_show',
      'other'
    )
  ),
  details text not null check (char_length(trim(details)) between 10 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved_release', 'resolved_refund', 'dismissed')),
  resolved_by uuid null references public.profiles (id) on delete set null,
  resolved_at timestamptz null,
  resolution_notes text null,
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists disputes_one_open_per_job_idx
  on public.disputes (job_id)
  where status = 'open';

create unique index if not exists disputes_idempotency_idx
  on public.disputes (opened_by, idempotency_key)
  where idempotency_key is not null;

alter table public.disputes enable row level security;
alter table public.disputes force row level security;

revoke all on public.disputes from public, anon, authenticated;
grant select on public.disputes to authenticated;

drop policy if exists disputes_select_participants on public.disputes;
create policy disputes_select_participants
  on public.disputes
  for select
  to authenticated
  using (
    public.is_job_customer(job_id, auth.uid())
    or public.is_job_assigned_artisan(job_id, auth.uid())
    or public.is_admin(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4. Table: public.reconciliation_reports (daily Paystack vs DB comparison)
-- Admin-only read; service_role writes.
-- ----------------------------------------------------------------------------
create table if not exists public.reconciliation_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  our_paid_count integer not null default 0,
  our_paid_total_kobo bigint not null default 0,
  our_commission_total_kobo bigint not null default 0,
  paystack_paid_count integer not null default 0,
  paystack_paid_total_kobo bigint not null default 0,
  missing_in_our_db_refs text[] not null default '{}'::text[],
  missing_in_paystack_refs text[] not null default '{}'::text[],
  amount_mismatch_refs text[] not null default '{}'::text[],
  status text not null check (status in ('matched', 'discrepancy', 'skipped_mock')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.reconciliation_reports enable row level security;
alter table public.reconciliation_reports force row level security;

revoke all on public.reconciliation_reports from public, anon, authenticated;
grant select on public.reconciliation_reports to authenticated;

drop policy if exists reconciliation_reports_select_admin on public.reconciliation_reports;
create policy reconciliation_reports_select_admin
  on public.reconciliation_reports
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. Server Function: public.process_paystack_charge_success (service_role only)
-- Atomically records unique provider_event_id in webhook_events, verifies paid
-- amount equals job quote & payment amount_kobo, and marks payment & job paid ONCE.
-- Sending the same webhook twice pays ONLY ONCE (idempotent!).
-- ----------------------------------------------------------------------------
create or replace function public.process_paystack_charge_success(
  p_provider_event_id text,
  p_event_type text,
  p_provider_reference text,
  p_paid_amount_kobo bigint,
  p_payload_hash text
)
returns table (
  outcome text,
  job_id uuid,
  payment_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_inserted_event_id uuid;
  v_payment public.payments;
  v_job public.jobs;
begin
  -- 1. Save provider_event_id uniquely; ignore repeats immediately!
  insert into public.webhook_events (
    provider,
    provider_event_id,
    event_type,
    provider_reference,
    payload_hash,
    status,
    received_at
  )
  values (
    'paystack',
    p_provider_event_id,
    p_event_type,
    p_provider_reference,
    p_payload_hash,
    'processed',
    v_now
  )
  on conflict (provider_event_id) do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return query select 'duplicate_ignored'::text, null::uuid, null::uuid;
    return;
  end if;

  -- 2. Lock payment row & matching job row
  select * into v_payment
  from public.payments
  where provider_reference = p_provider_reference
  for update;

  if not found then
    update public.webhook_events
    set status = 'ignored'
    where id = v_inserted_event_id;
    return query select 'unknown_reference'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_payment.status = 'paid' then
    return query select 'already_paid'::text, v_payment.job_id, v_payment.id;
    return;
  end if;

  select * into v_job
  from public.jobs
  where id = v_payment.job_id
  for update;

  -- 3. Verify paid amount strictly equals the accepted quote AND payment amount_kobo
  if p_paid_amount_kobo is distinct from v_payment.amount_kobo
     or p_paid_amount_kobo is distinct from v_job.accepted_amount_kobo then
    update public.payments
    set status = 'amount_mismatch', updated_at = v_now
    where id = v_payment.id;

    update public.webhook_events
    set status = 'mismatch'
    where id = v_inserted_event_id;

    insert into public.audit_log (actor_id, action, target_type, target_id, metadata, created_at)
    values (
      null,
      'payment_amount_mismatch',
      'payment',
      v_payment.id::text,
      jsonb_build_object(
        'provider_reference', p_provider_reference,
        'expected_kobo', v_payment.amount_kobo,
        'received_kobo', p_paid_amount_kobo
      ),
      v_now
    );

    return query select 'amount_mismatch'::text, v_payment.job_id, v_payment.id;
    return;
  end if;

  -- 4. Mark payment paid & update job status atomically
  update public.payments
  set
    status = 'paid',
    paid_at = v_now,
    updated_at = v_now
  where id = v_payment.id;

  -- Under pay-after-job: if job was completed (and not disputed), payment marks it 'paid'
  -- (customer can confirm immediately or auto-confirm runs 24h after completed_at)
  update public.jobs
  set
    status = case
      when status in ('completed', 'quote_accepted') then 'paid'::public.job_status
      else status
    end,
    updated_at = v_now
  where id = v_job.id;

  return query select 'paid'::text, v_payment.job_id, v_payment.id;
end;
$$;

revoke all on function public.process_paystack_charge_success(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.process_paystack_charge_success(text, text, text, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Server Function: public.confirm_completed_job (Customer confirms job)
-- Allowed when job is 'paid' (or 'completed' if already paid) and no open dispute.
-- ----------------------------------------------------------------------------
create or replace function public.confirm_completed_job(p_job_id uuid)
returns public.job_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_has_open_dispute boolean;
  v_has_paid boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or v_job.customer_id <> v_uid then
    raise exception 'Only the customer can confirm completion of this job.'
      using errcode = '42501';
  end if;

  if v_job.status = 'confirmed' then
    return 'confirmed'::public.job_status;
  end if;

  if v_job.status not in ('paid', 'completed') or v_job.completed_at is null then
    raise exception 'Job must be completed before it can be confirmed.'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.disputes where job_id = p_job_id and status = 'open'
  ) into v_has_open_dispute;

  if v_has_open_dispute then
    raise exception 'Cannot confirm a job while a dispute is open.'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.payments where job_id = p_job_id and status = 'paid'
  ) into v_has_paid;

  if not v_has_paid then
    raise exception 'Complete payment via Paystack before confirming this job.'
      using errcode = '22023';
  end if;

  update public.jobs
  set
    status = 'confirmed',
    confirmed_at = v_now,
    updated_at = v_now
  where id = p_job_id;

  return 'confirmed'::public.job_status;
end;
$$;

revoke all on function public.confirm_completed_job(uuid) from public, anon;
grant execute on function public.confirm_completed_job(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server Function: public.open_job_dispute (Customer or Artisan)
-- Transitions job to 'disputed' and pauses payout release. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.open_job_dispute(
  p_job_id uuid,
  p_reason text,
  p_details text,
  p_idempotency_key text default null
)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_existing public.disputes;
  v_dispute public.disputes;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.disputes
    where opened_by = v_uid and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or (v_job.customer_id <> v_uid and v_job.artisan_id <> v_uid) then
    raise exception 'Only the customer or assigned artisan can open a dispute.'
      using errcode = '42501';
  end if;

  if v_job.status not in ('in_progress', 'completed', 'paid', 'disputed') then
    raise exception 'A dispute can only be opened on an in-progress, completed, or paid job.'
      using errcode = '22023';
  end if;

  -- Idempotent if already open
  select * into v_existing
  from public.disputes
  where job_id = p_job_id and status = 'open';
  if found then
    return v_existing;
  end if;

  insert into public.disputes (job_id, opened_by, reason, details, status, idempotency_key, created_at, updated_at)
  values (p_job_id, v_uid, p_reason, trim(p_details), 'open', p_idempotency_key, v_now, v_now)
  returning * into v_dispute;

  update public.jobs
  set status = 'disputed', updated_at = v_now
  where id = p_job_id;

  -- Pause payment release where a payment exists
  update public.payments
  set release_paused = true, updated_at = v_now
  where job_id = p_job_id;

  return v_dispute;
end;
$$;

revoke all on function public.open_job_dispute(uuid, text, text, text) from public, anon;
grant execute on function public.open_job_dispute(uuid, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Server Function: public.auto_confirm_completed_jobs (service_role only)
-- Auto-confirms completed/paid jobs 24 hours after completion if there is NO open dispute.
-- Atomic & idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.auto_confirm_completed_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_count integer;
begin
  with eligible as (
    select j.id
    from public.jobs j
    where j.status in ('completed', 'paid')
      and j.completed_at is not null
      and j.completed_at <= v_now - interval '24 hours'
      and not exists (
        select 1 from public.disputes d
        where d.job_id = j.id and d.status = 'open'
      )
    for update skip locked
  ),
  confirmed as (
    update public.jobs j
    set
      status = 'confirmed',
      confirmed_at = v_now,
      updated_at = v_now
    from eligible e
    where j.id = e.id
    returning j.id
  )
  select count(*)::integer into v_count from confirmed;

  return v_count;
end;
$$;

revoke all on function public.auto_confirm_completed_jobs() from public, anon, authenticated;
grant execute on function public.auto_confirm_completed_jobs() to service_role;

-- ----------------------------------------------------------------------------
-- 9. Helper: public.customer_confirmed_job_count (for first-time customer cap)
-- ----------------------------------------------------------------------------
create or replace function public.customer_confirmed_job_count(p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.jobs
  where customer_id = p_customer_id
    and status = 'confirmed';
$$;

revoke all on function public.customer_confirmed_job_count(uuid) from public;
grant execute on function public.customer_confirmed_job_count(uuid) to authenticated, service_role;
