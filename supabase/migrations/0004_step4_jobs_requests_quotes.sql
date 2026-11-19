-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 4: Jobs, Nearest-3 Wave Requests, Quotes, Start Code,
-- Share Job, SOS Trusted Contact & Cancellation Fee Rules
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums (exact statuses from specification)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum (
      'requested',
      'accepted',
      'quoted',
      'quote_accepted',
      'paid',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'confirmed',
      'cancelled',
      'expired',
      'disputed',
      'refunded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'job_request_status') then
    create type public.job_request_status as enum (
      'sent',
      'accepted',
      'declined',
      'expired',
      'taken'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'quote_status') then
    create type public.quote_status as enum (
      'pending',
      'accepted',
      'declined',
      'superseded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'dispatch_mode') then
    create type public.dispatch_mode as enum ('direct', 'nearest_3');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Private Storage Bucket: job-photos (EXIF-stripped & compressed <= ~300 KB)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos',
  'job-photos',
  false, -- Private: served via short-lived signed URLs to job participants only
  524288, -- 512 KB hard cap (server compresses to <= 300 KB)
  array['image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Table: public.jobs
-- Money stored strictly as BIGINT whole kobo. Start code stored ONLY as hash.
-- ----------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  artisan_id uuid null references public.profiles (id) on delete set null,
  trade public.artisan_trade not null,
  description text not null check (char_length(trim(description)) between 10 and 1000),
  photo_paths text[] not null default '{}'::text[] check (cardinality(photo_paths) <= 3),
  dispatch_mode public.dispatch_mode not null default 'nearest_3',
  dispatch_round integer not null default 1 check (dispatch_round between 1 and 3),
  round_expires_at timestamptz null,
  approx_location geography(Point, 4326) not null,
  approx_area_label text not null check (char_length(trim(approx_area_label)) between 2 and 120),
  status public.job_status not null default 'requested',
  accepted_quote_id uuid null,
  accepted_amount_kobo bigint null check (accepted_amount_kobo is null or accepted_amount_kobo >= 0),
  cancel_fee_kobo bigint not null default 0 check (cancel_fee_kobo >= 0),
  cancelled_by uuid null references public.profiles (id) on delete set null,
  cancel_reason text null check (cancel_reason is null or char_length(trim(cancel_reason)) <= 500),
  start_code_nonce text null,
  start_code_hash text null check (start_code_hash is null or start_code_hash ~ '^[0-9a-f]{64}$'),
  start_code_attempts integer not null default 0 check (start_code_attempts >= 0),
  idempotency_key text null,
  accepted_at timestamptz null,
  en_route_at timestamptz null,
  arrived_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  confirmed_at timestamptz null,
  cancelled_at timestamptz null,
  expired_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists jobs_customer_idempotency_idx
  on public.jobs (customer_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists jobs_customer_created_idx
  on public.jobs (customer_id, created_at desc);

create index if not exists jobs_artisan_created_idx
  on public.jobs (artisan_id, created_at desc)
  where artisan_id is not null;

create index if not exists jobs_dispatch_round_due_idx
  on public.jobs (round_expires_at)
  where status = 'requested' and artisan_id is null;

-- ----------------------------------------------------------------------------
-- Table: public.job_private_addresses
-- Exact customer address & exact pin. STRICT RLS: hidden until job is accepted!
-- ----------------------------------------------------------------------------
create table if not exists public.job_private_addresses (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  exact_address text not null check (char_length(trim(exact_address)) between 5 and 300),
  exact_lat double precision not null check (exact_lat between -90 and 90),
  exact_lng double precision not null check (exact_lng between -180 and 180),
  created_at timestamptz not null default timezone('utc', now())
);

-- ----------------------------------------------------------------------------
-- Table: public.job_requests (per-artisan request status in each wave)
-- ----------------------------------------------------------------------------
create table if not exists public.job_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  artisan_id uuid not null references public.profiles (id) on delete cascade,
  round_number integer not null default 1 check (round_number between 1 and 3),
  status public.job_request_status not null default 'sent',
  sent_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  responded_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint job_requests_unique_job_artisan unique (job_id, artisan_id)
);

create index if not exists job_requests_artisan_status_idx
  on public.job_requests (artisan_id, status, sent_at desc);

create index if not exists job_requests_job_idx
  on public.job_requests (job_id, round_number);

-- ----------------------------------------------------------------------------
-- Table: public.quotes (immutable quotes in whole kobo; new price = new quote)
-- ----------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  artisan_id uuid not null references public.profiles (id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo >= 50000 and amount_kobo <= 500000000),
  notes text null check (notes is null or char_length(trim(notes)) <= 500),
  status public.quote_status not null default 'pending',
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz null
);

create unique index if not exists quotes_one_pending_per_job_idx
  on public.quotes (job_id)
  where status = 'pending';

create unique index if not exists quotes_job_idempotency_idx
  on public.quotes (job_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists quotes_job_created_idx
  on public.quotes (job_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Table: public.trusted_contacts (for Share job & SOS safety button)
-- ----------------------------------------------------------------------------
create table if not exists public.trusted_contacts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 120),
  contact_phone_e164 text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ----------------------------------------------------------------------------
-- Table: public.job_shares (hashed share link tokens for trusted contacts)
-- ----------------------------------------------------------------------------
create table if not exists public.job_shares (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  share_token_hash text not null unique check (share_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists job_shares_job_idx on public.job_shares (job_id);

-- ----------------------------------------------------------------------------
-- Non-recursive RLS Helper Functions (SECURITY DEFINER STABLE)
-- ----------------------------------------------------------------------------
create or replace function public.is_job_customer(p_job_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs where id = p_job_id and customer_id = p_uid
  );
$$;

create or replace function public.is_job_assigned_artisan(p_job_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.jobs where id = p_job_id and artisan_id = p_uid
  );
$$;

create or replace function public.is_job_invited_artisan(p_job_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_requests where job_id = p_job_id and artisan_id = p_uid
  );
$$;

create or replace function public.can_view_exact_job_address(p_job_id uuid, p_uid uuid)
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
      and (
        j.customer_id = p_uid
        or (
          j.artisan_id = p_uid
          and j.status in (
            'accepted', 'quoted', 'quote_accepted', 'paid',
            'en_route', 'arrived', 'in_progress',
            'completed', 'confirmed', 'disputed', 'refunded'
          )
        )
      )
  );
$$;

revoke all on function public.is_job_customer(uuid, uuid) from public;
revoke all on function public.is_job_assigned_artisan(uuid, uuid) from public;
revoke all on function public.is_job_invited_artisan(uuid, uuid) from public;
revoke all on function public.can_view_exact_job_address(uuid, uuid) from public;
grant execute on function public.is_job_customer(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_job_assigned_artisan(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_job_invited_artisan(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_exact_job_address(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Row-Level Security & Column Grants on ALL Step 4 Tables
-- ----------------------------------------------------------------------------

-- 1. jobs (NEVER expose start_code_nonce / start_code_hash directly; ZERO direct writes)
alter table public.jobs enable row level security;
alter table public.jobs force row level security;

revoke all on public.jobs from public, anon, authenticated;
grant select (
  id,
  customer_id,
  artisan_id,
  trade,
  description,
  photo_paths,
  dispatch_mode,
  dispatch_round,
  round_expires_at,
  approx_area_label,
  status,
  accepted_quote_id,
  accepted_amount_kobo,
  cancel_fee_kobo,
  cancelled_by,
  cancel_reason,
  accepted_at,
  en_route_at,
  arrived_at,
  started_at,
  completed_at,
  confirmed_at,
  cancelled_at,
  expired_at,
  created_at,
  updated_at
) on public.jobs to authenticated;

drop policy if exists jobs_select_participants on public.jobs;
create policy jobs_select_participants
  on public.jobs
  for select
  to authenticated
  using (
    auth.uid() = customer_id
    or auth.uid() = artisan_id
    or public.is_job_invited_artisan(id, auth.uid())
    or public.is_admin(auth.uid())
  );

-- 2. job_private_addresses (ONLY customer, accepted artisan, or admin!)
alter table public.job_private_addresses enable row level security;
alter table public.job_private_addresses force row level security;

revoke all on public.job_private_addresses from public, anon, authenticated;
grant select on public.job_private_addresses to authenticated;

drop policy if exists job_private_addresses_select on public.job_private_addresses;
create policy job_private_addresses_select
  on public.job_private_addresses
  for select
  to authenticated
  using (
    public.can_view_exact_job_address(job_id, auth.uid())
    or public.is_admin(auth.uid())
  );

-- 3. job_requests
alter table public.job_requests enable row level security;
alter table public.job_requests force row level security;

revoke all on public.job_requests from public, anon, authenticated;
grant select on public.job_requests to authenticated;

drop policy if exists job_requests_select on public.job_requests;
create policy job_requests_select
  on public.job_requests
  for select
  to authenticated
  using (
    auth.uid() = artisan_id
    or public.is_job_customer(job_id, auth.uid())
    or public.is_admin(auth.uid())
  );

-- 4. quotes (ZERO direct writes; mutations strictly via submit_job_quote / respond_to_quote)
alter table public.quotes enable row level security;
alter table public.quotes force row level security;

revoke all on public.quotes from public, anon, authenticated;
grant select on public.quotes to authenticated;

drop policy if exists quotes_select on public.quotes;
create policy quotes_select
  on public.quotes
  for select
  to authenticated
  using (
    auth.uid() = artisan_id
    or public.is_job_customer(job_id, auth.uid())
    or public.is_job_assigned_artisan(job_id, auth.uid())
    or public.is_admin(auth.uid())
  );

-- 5. trusted_contacts (own-only)
alter table public.trusted_contacts enable row level security;
alter table public.trusted_contacts force row level security;

revoke all on public.trusted_contacts from public, anon, authenticated;
grant select, insert, update, delete on public.trusted_contacts to authenticated;

drop policy if exists trusted_contacts_own_all on public.trusted_contacts;
create policy trusted_contacts_own_all
  on public.trusted_contacts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6. job_shares (creator or admin can list; public tracking uses hashed token via server)
alter table public.job_shares enable row level security;
alter table public.job_shares force row level security;

revoke all on public.job_shares from public, anon, authenticated;
grant select (id, job_id, created_by, expires_at, created_at) on public.job_shares to authenticated;

drop policy if exists job_shares_select on public.job_shares;
create policy job_shares_select
  on public.job_shares
  for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.is_admin(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Server Function: public.accept_job_request (ONE ATOMIC UPDATE!)
-- First artisan to accept wins by setting artisan_id ONLY WHERE artisan_id IS NULL.
-- Everyone else immediately sees 'taken'. Safe to run twice (idempotent for winner).
-- ----------------------------------------------------------------------------
create or replace function public.accept_job_request(
  p_job_id uuid,
  p_start_code_nonce text,
  p_start_code_hash text
)
returns table (
  won boolean,
  request_status public.job_request_status,
  job_status public.job_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_req public.job_requests;
  v_job public.jobs;
  v_artisan_approved boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  -- Confirm caller is an active, approved artisan
  select exists (
    select 1
    from public.artisan_profiles ap
    join public.profiles p on p.id = ap.user_id
    where ap.user_id = v_uid
      and ap.verification_status = 'approved'
      and p.account_status = 'active'
  ) into v_artisan_approved;

  if not v_artisan_approved then
    raise exception 'Only approved active artisans can accept jobs.' using errcode = '42501';
  end if;

  -- Confirm this artisan actually received a request for this job
  select * into v_req
  from public.job_requests
  where job_id = p_job_id
    and artisan_id = v_uid
  for update;

  if not found then
    raise exception 'No job request found for your account.' using errcode = '42501';
  end if;

  -- Idempotent replay if this artisan already won
  if v_req.status = 'accepted' then
    select status into v_job.status from public.jobs where id = p_job_id;
    return query select true, 'accepted'::public.job_request_status, v_job.status;
    return;
  end if;

  if v_req.status in ('declined', 'expired', 'taken') then
    select status into v_job.status from public.jobs where id = p_job_id;
    return query select false, v_req.status, v_job.status;
    return;
  end if;

  if v_req.expires_at < v_now then
    update public.job_requests
    set status = 'expired', responded_at = v_now
    where id = v_req.id;
    select status into v_job.status from public.jobs where id = p_job_id;
    return query select false, 'expired'::public.job_request_status, v_job.status;
    return;
  end if;

  -- ONE ATOMIC UPDATE: set artisan_id ONLY where the job still has none!
  update public.jobs
  set
    artisan_id = v_uid,
    status = 'accepted',
    accepted_at = v_now,
    start_code_nonce = p_start_code_nonce,
    start_code_hash = p_start_code_hash,
    updated_at = v_now
  where id = p_job_id
    and artisan_id is null
    and status = 'requested'
  returning * into v_job;

  if not found then
    -- Someone else won or job is no longer open
    select * into v_job from public.jobs where id = p_job_id;

    if v_job.artisan_id = v_uid then
      update public.job_requests
      set status = 'accepted', responded_at = coalesce(responded_at, v_now)
      where id = v_req.id;
      return query select true, 'accepted'::public.job_request_status, v_job.status;
      return;
    end if;

    update public.job_requests
    set
      status = case when v_job.artisan_id is not null then 'taken'::public.job_request_status else 'expired'::public.job_request_status end,
      responded_at = v_now
    where id = v_req.id;

    return query select
      false,
      case when v_job.artisan_id is not null then 'taken'::public.job_request_status else 'expired'::public.job_request_status end,
      v_job.status;
    return;
  end if;

  -- Winner! Mark own request accepted and all other pending requests taken
  update public.job_requests
  set status = 'accepted', responded_at = v_now
  where id = v_req.id;

  update public.job_requests
  set status = 'taken', responded_at = v_now
  where job_id = p_job_id
    and artisan_id <> v_uid
    and status = 'sent';

  return query select true, 'accepted'::public.job_request_status, v_job.status;
end;
$$;

revoke all on function public.accept_job_request(uuid, text, text) from public, anon;
grant execute on function public.accept_job_request(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.decline_job_request (idempotent)
-- ----------------------------------------------------------------------------
create or replace function public.decline_job_request(p_job_id uuid)
returns public.job_request_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_req public.job_requests;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_req
  from public.job_requests
  where job_id = p_job_id and artisan_id = v_uid
  for update;

  if not found then
    raise exception 'Job request not found.' using errcode = 'P0002';
  end if;

  if v_req.status = 'declined' then
    return 'declined'::public.job_request_status;
  end if;

  if v_req.status <> 'sent' then
    return v_req.status;
  end if;

  update public.job_requests
  set status = 'declined', responded_at = v_now
  where id = v_req.id;

  return 'declined'::public.job_request_status;
end;
$$;

revoke all on function public.decline_job_request(uuid) from public, anon;
grant execute on function public.decline_job_request(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.advance_due_job_rounds (service_role only)
-- Advances expired nearest-3 rounds (every 60s up to 3 rounds), or marks job expired.
-- Atomic via FOR UPDATE SKIP LOCKED.
-- ----------------------------------------------------------------------------
create or replace function public.advance_due_job_rounds(p_job_id uuid default null)
returns table (
  job_id uuid,
  action text,
  new_round integer,
  notified_artisan_ids uuid[],
  customer_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_next_artisans uuid[];
  v_next_expires timestamptz;
begin
  for v_job in
    select *
    from public.jobs j
    where j.status = 'requested'
      and j.artisan_id is null
      and j.round_expires_at is not null
      and j.round_expires_at <= v_now
      and (p_job_id is null or j.id = p_job_id)
    order by j.round_expires_at asc
    limit 20
    for update skip locked
  loop
    -- Expire unanswered requests from the finished round
    update public.job_requests
    set status = 'expired', responded_at = v_now
    where job_requests.job_id = v_job.id
      and status = 'sent';

    if v_job.dispatch_mode = 'nearest_3' and v_job.dispatch_round < 3 then
      -- Find next 3 nearest verified, Online (<15m) artisans within 10 km not yet invited
      select array_agg(candidate.user_id order by candidate.dist asc, candidate.rating_avg desc)
      into v_next_artisans
      from (
        select
          ap.user_id,
          st_distance(ap.approx_location, v_job.approx_location) as dist,
          p.rating_avg
        from public.artisan_profiles ap
        join public.profiles p on p.id = ap.user_id
        where ap.trade = v_job.trade
          and ap.verification_status = 'approved'
          and p.account_status = 'active'
          and ap.is_online = true
          and ap.last_seen_at >= v_now - interval '15 minutes'
          and ap.approx_location is not null
          and ap.user_id <> v_job.customer_id
          and st_dwithin(ap.approx_location, v_job.approx_location, 10000)
          and not exists (
            select 1 from public.job_requests jr
            where jr.job_id = v_job.id and jr.artisan_id = ap.user_id
          )
        order by st_distance(ap.approx_location, v_job.approx_location) asc, p.rating_avg desc
        limit 3
      ) candidate;

      if v_next_artisans is not null and cardinality(v_next_artisans) > 0 then
        v_next_expires := v_now + interval '60 seconds';

        update public.jobs
        set
          dispatch_round = v_job.dispatch_round + 1,
          round_expires_at = v_next_expires,
          updated_at = v_now
        where id = v_job.id;

        insert into public.job_requests (job_id, artisan_id, round_number, status, sent_at, expires_at)
        select v_job.id, aid, v_job.dispatch_round + 1, 'sent', v_now, v_next_expires
        from unnest(v_next_artisans) as aid
        on conflict (job_id, artisan_id) do nothing;

        return query select v_job.id, 'next_round'::text, v_job.dispatch_round + 1, v_next_artisans, v_job.customer_id;
        continue;
      end if;
    end if;

    -- Stop after 3 rounds (or no more artisans / direct timeout) -> mark expired
    update public.jobs
    set
      status = 'expired',
      expired_at = v_now,
      updated_at = v_now
    where id = v_job.id;

    return query select v_job.id, 'expired'::text, v_job.dispatch_round, '{}'::uuid[], v_job.customer_id;
  end loop;
end;
$$;

revoke all on function public.advance_due_job_rounds(uuid) from public, anon, authenticated;
grant execute on function public.advance_due_job_rounds(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Server Function: public.submit_job_quote
-- Artisan sends a quote in whole kobo. A changed price supersedes old quotes and
-- creates a new quote requiring customer acceptance. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.submit_job_quote(
  p_job_id uuid,
  p_amount_kobo bigint,
  p_notes text default null,
  p_idempotency_key text default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_existing public.quotes;
  v_quote public.quotes;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_amount_kobo is null or p_amount_kobo < 50000 or p_amount_kobo > 500000000 then
    raise exception 'Quote must be between ₦500 and ₦5,000,000 (stored in whole kobo).'
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.quotes
    where job_id = p_job_id and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or v_job.artisan_id <> v_uid then
    raise exception 'Only the assigned artisan can send a quote for this job.'
      using errcode = '42501';
  end if;

  if v_job.status not in ('accepted', 'quoted', 'quote_accepted') then
    raise exception 'Cannot submit a new quote once the job is %.', v_job.status
      using errcode = '22023';
  end if;

  -- Supersede any prior pending or accepted quote (changed price needs a new quote)
  update public.quotes
  set status = 'superseded', responded_at = coalesce(responded_at, v_now)
  where job_id = p_job_id
    and status in ('pending', 'accepted');

  insert into public.quotes (job_id, artisan_id, amount_kobo, notes, status, idempotency_key, created_at)
  values (
    p_job_id,
    v_uid,
    p_amount_kobo,
    nullif(trim(coalesce(p_notes, '')), ''),
    'pending',
    p_idempotency_key,
    v_now
  )
  returning * into v_quote;

  update public.jobs
  set
    status = 'quoted',
    accepted_quote_id = null,
    accepted_amount_kobo = null,
    updated_at = v_now
  where id = p_job_id;

  return v_quote;
end;
$$;

revoke all on function public.submit_job_quote(uuid, bigint, text, text) from public, anon;
grant execute on function public.submit_job_quote(uuid, bigint, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.respond_to_quote (Customer accepts or declines)
-- Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_quote(
  p_quote_id uuid,
  p_accept boolean
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_quote public.quotes;
  v_job public.jobs;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;

  select * into v_job
  from public.jobs
  where id = v_quote.job_id
  for update;

  if v_job.customer_id <> v_uid then
    raise exception 'Only the customer can respond to this quote.' using errcode = '42501';
  end if;

  -- Idempotent replays
  if p_accept and v_quote.status = 'accepted' then
    return v_quote;
  end if;
  if not p_accept and v_quote.status = 'declined' then
    return v_quote;
  end if;

  if v_quote.status <> 'pending' then
    raise exception 'This quote is no longer pending.' using errcode = '22023';
  end if;

  if p_accept then
    update public.quotes
    set status = 'accepted', responded_at = v_now
    where id = p_quote_id
    returning * into v_quote;

    update public.jobs
    set
      status = 'quote_accepted',
      accepted_quote_id = v_quote.id,
      accepted_amount_kobo = v_quote.amount_kobo,
      updated_at = v_now
    where id = v_job.id;
  else
    update public.quotes
    set status = 'declined', responded_at = v_now
    where id = p_quote_id
    returning * into v_quote;

    update public.jobs
    set
      status = 'accepted',
      accepted_quote_id = null,
      accepted_amount_kobo = null,
      updated_at = v_now
    where id = v_job.id;
  end if;

  return v_quote;
end;
$$;

revoke all on function public.respond_to_quote(uuid, boolean) from public, anon;
grant execute on function public.respond_to_quote(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.transition_job_status (Artisan en_route / arrived / completed)
-- Note: in_progress is strictly via verify_start_code_and_start_job!
-- ----------------------------------------------------------------------------
create or replace function public.transition_job_status(
  p_job_id uuid,
  p_next_status public.job_status
)
returns public.job_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or v_job.artisan_id <> v_uid then
    raise exception 'Only the assigned artisan can update this job status.'
      using errcode = '42501';
  end if;

  -- Idempotent replay
  if v_job.status = p_next_status then
    return v_job.status;
  end if;

  if p_next_status = 'en_route' and v_job.status in ('quote_accepted', 'paid') then
    update public.jobs
    set status = 'en_route', en_route_at = v_now, updated_at = v_now
    where id = p_job_id;
    return 'en_route'::public.job_status;
  elsif p_next_status = 'arrived' and v_job.status = 'en_route' then
    update public.jobs
    set status = 'arrived', arrived_at = v_now, updated_at = v_now
    where id = p_job_id;
    return 'arrived'::public.job_status;
  elsif p_next_status = 'completed' and v_job.status = 'in_progress' then
    update public.jobs
    set status = 'completed', completed_at = v_now, updated_at = v_now
    where id = p_job_id;
    return 'completed'::public.job_status;
  else
    raise exception 'Invalid job status transition from % to %.', v_job.status, p_next_status
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.transition_job_status(uuid, public.job_status) from public, anon;
grant execute on function public.transition_job_status(uuid, public.job_status) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.verify_start_code_and_start_job
-- Artisan enters customer's 4-digit start code on arrival (verified by hash).
-- ----------------------------------------------------------------------------
create or replace function public.verify_start_code_and_start_job(
  p_job_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or v_job.artisan_id <> v_uid then
    raise exception 'Only the assigned artisan can enter the start code.'
      using errcode = '42501';
  end if;

  if v_job.status = 'in_progress' then
    return true;
  end if;

  if v_job.status <> 'arrived' then
    raise exception 'Mark yourself as Arrived before entering the start code.'
      using errcode = '22023';
  end if;

  if v_job.start_code_attempts >= 5 then
    raise exception 'Maximum start code attempts reached. Contact support.'
      using errcode = '42501';
  end if;

  if v_job.start_code_hash is not null and v_job.start_code_hash = p_code_hash then
    update public.jobs
    set
      status = 'in_progress',
      started_at = v_now,
      updated_at = v_now
    where id = p_job_id;
    return true;
  end if;

  update public.jobs
  set
    start_code_attempts = start_code_attempts + 1,
    updated_at = v_now
  where id = p_job_id;

  return false;
end;
$$;

revoke all on function public.verify_start_code_and_start_job(uuid, text) from public, anon;
grant execute on function public.verify_start_code_and_start_job(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.cancel_job
-- Enforces Terms cancel-fee rule: customer cancelling after artisan is en_route
-- incurs 10% of accepted quote (min ₦1,000 = 100,000 kobo, max ₦5,000 = 500,000 kobo).
-- Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_job(
  p_job_id uuid,
  p_reason text default null
)
returns table (
  status public.job_status,
  cancel_fee_kobo bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_fee_kobo bigint := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found or (v_job.customer_id <> v_uid and v_job.artisan_id <> v_uid) then
    raise exception 'Only the customer or assigned artisan can cancel this job.'
      using errcode = '42501';
  end if;

  if v_job.status = 'cancelled' then
    return query select v_job.status, v_job.cancel_fee_kobo;
    return;
  end if;

  if v_job.status not in ('requested', 'accepted', 'quoted', 'quote_accepted', 'en_route', 'arrived') then
    raise exception 'Cannot cancel a job once it is %.', v_job.status
      using errcode = '22023';
  end if;

  -- Cancel fee applies when customer cancels AFTER artisan is en_route (or arrived)
  if v_uid = v_job.customer_id and v_job.status in ('en_route', 'arrived') then
    v_fee_kobo := least(
      greatest(coalesce(v_job.accepted_amount_kobo, 0) / 10, 100000),
      500000
    );
  end if;

  update public.jobs
  set
    status = 'cancelled',
    cancel_fee_kobo = v_fee_kobo,
    cancelled_by = v_uid,
    cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
    cancelled_at = v_now,
    updated_at = v_now
  where id = p_job_id;

  update public.job_requests
  set status = 'expired', responded_at = v_now
  where job_id = p_job_id and status = 'sent';

  update public.quotes
  set status = 'superseded', responded_at = coalesce(responded_at, v_now)
  where job_id = p_job_id and status = 'pending';

  return query select 'cancelled'::public.job_status, v_fee_kobo;
end;
$$;

revoke all on function public.cancel_job(uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, text) to authenticated;
