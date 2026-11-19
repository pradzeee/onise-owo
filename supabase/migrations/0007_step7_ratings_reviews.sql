-- ============================================================================
-- Oníṣẹ́ ọwọ́ — Step 7: Verified Ratings & Reviews
-- Rules enforced at DB layer:
--   - Only after a 'confirmed' job can customer or artisan leave a review
--   - 1-5 stars integer rating + optional comment
--   - Strictly one review per side per job: UNIQUE (job_id, reviewer_role)
--   - Automatically updates profiles.rating_avg and profiles.rating_count server-side
--   - Supports Step 8 anonymisation cleanly (nullable reviewer_id + is_anonymized)
-- ============================================================================

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  reviewer_id uuid null references public.profiles (id) on delete set null,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  reviewer_role text not null check (reviewer_role in ('customer', 'artisan')),
  reviewer_display_name text not null default 'Verified user' check (char_length(trim(reviewer_display_name)) between 1 and 120),
  rating integer not null check (rating between 1 and 5),
  comment text null check (comment is null or char_length(trim(comment)) <= 500),
  is_anonymized boolean not null default false,
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now()),
  -- Strictly ONE review per side (customer or artisan) per job!
  constraint reviews_one_per_side_per_job unique (job_id, reviewer_role),
  constraint reviews_not_self check (reviewer_id is null or reviewer_id <> reviewee_id)
);

create unique index if not exists reviews_reviewer_idempotency_idx
  on public.reviews (job_id, reviewer_id, idempotency_key)
  where idempotency_key is not null and reviewer_id is not null;

create index if not exists reviews_reviewee_created_idx
  on public.reviews (reviewee_id, created_at desc);

alter table public.reviews enable row level security;
alter table public.reviews force row level security;

-- Zero direct writes for authenticated/anon; all inserts strictly via submit_job_review RPC
revoke all on public.reviews from public, anon, authenticated;
grant select (
  id,
  job_id,
  reviewer_id,
  reviewee_id,
  reviewer_role,
  reviewer_display_name,
  rating,
  comment,
  is_anonymized,
  created_at
) on public.reviews to authenticated;

-- Helper: true when reviewee is an approved, active artisan (so public artisan reviews can be viewed)
create or replace function public.is_approved_active_artisan(p_artisan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.artisan_profiles ap
    join public.profiles p on p.id = ap.user_id
    where ap.user_id = p_artisan_id
      and ap.verification_status = 'approved'
      and p.account_status = 'active'
  );
$$;

revoke all on function public.is_approved_active_artisan(uuid) from public;
grant execute on function public.is_approved_active_artisan(uuid) to authenticated, service_role;

-- RLS Policy:
-- 1) Participants on that job can read both sides' reviews for that job.
-- 2) Authenticated users can read customer-written reviews about approved active artisans (for artisan profiles).
-- 3) Artisan-written reviews about a customer remain PRIVATE to that job's participants and admins!
drop policy if exists reviews_select_policy on public.reviews;
create policy reviews_select_policy
  on public.reviews
  for select
  to authenticated
  using (
    auth.uid() = reviewer_id
    or auth.uid() = reviewee_id
    or public.is_job_customer(job_id, auth.uid())
    or public.is_job_assigned_artisan(job_id, auth.uid())
    or public.is_admin(auth.uid())
    or (
      reviewer_role = 'customer'
      and public.is_approved_active_artisan(reviewee_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Server Function: public.submit_job_review
-- Enforces: confirmed job only, 1-5 stars, one review per side per job,
-- idempotent replay, and atomic recalculation of reviewee rating_avg & rating_count.
-- ----------------------------------------------------------------------------
create or replace function public.submit_job_review(
  p_job_id uuid,
  p_rating integer,
  p_comment text default null,
  p_idempotency_key text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_job public.jobs;
  v_reviewer_role text;
  v_reviewee_id uuid;
  v_display_name text;
  v_existing public.reviews;
  v_review public.reviews;
  v_clean_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_avg numeric(3, 2);
  v_cnt integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be a whole number between 1 and 5 stars.'
      using errcode = '22023';
  end if;

  if v_clean_comment is not null and char_length(v_clean_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  if v_job.status <> 'confirmed' then
    raise exception 'Reviews can only be submitted after a job is confirmed.'
      using errcode = '22023';
  end if;

  if v_job.artisan_id is null then
    raise exception 'Job has no assigned artisan.' using errcode = '22023';
  end if;

  if v_uid = v_job.customer_id then
    v_reviewer_role := 'customer';
    v_reviewee_id := v_job.artisan_id;
  elsif v_uid = v_job.artisan_id then
    v_reviewer_role := 'artisan';
    v_reviewee_id := v_job.customer_id;
  else
    raise exception 'Only the customer or assigned artisan for this job can leave a review.'
      using errcode = '42501';
  end if;

  -- Check if this side already reviewed this job
  select * into v_existing
  from public.reviews
  where job_id = p_job_id
    and reviewer_role = v_reviewer_role;

  if found then
    if (p_idempotency_key is not null and v_existing.idempotency_key = p_idempotency_key)
       or (v_existing.rating = p_rating and coalesce(v_existing.comment, '') = coalesce(v_clean_comment, '')) then
      return v_existing;
    end if;
    raise exception 'You have already submitted a review for this job.'
      using errcode = '23505';
  end if;

  select coalesce(nullif(trim(display_name), ''), case when v_reviewer_role = 'customer' then 'Verified Customer' else 'Verified Artisan' end)
  into v_display_name
  from public.profiles
  where id = v_uid;

  insert into public.reviews (
    job_id,
    reviewer_id,
    reviewee_id,
    reviewer_role,
    reviewer_display_name,
    rating,
    comment,
    is_anonymized,
    idempotency_key,
    created_at
  )
  values (
    p_job_id,
    v_uid,
    v_reviewee_id,
    v_reviewer_role,
    coalesce(v_display_name, 'Verified user'),
    p_rating,
    v_clean_comment,
    false,
    p_idempotency_key,
    v_now
  )
  returning * into v_review;

  -- Atomically recalculate reviewee's rating_avg & rating_count on public.profiles
  select
    coalesce(round(avg(rating)::numeric, 2), 0.00),
    count(*)::integer
  into v_avg, v_cnt
  from public.reviews
  where reviewee_id = v_reviewee_id;

  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update public.profiles
  set
    rating_avg = v_avg,
    rating_count = v_cnt,
    updated_at = v_now
  where id = v_reviewee_id;

  return v_review;
end;
$$;

revoke all on function public.submit_job_review(uuid, integer, text, text) from public, anon;
grant execute on function public.submit_job_review(uuid, integer, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server Function: public.get_artisan_public_profile
-- Returns safe public artisan profile with average rating, review count, and bio.
-- NEVER exposes phone numbers, payout codes, guarantor info, or NIN hashes.
-- ----------------------------------------------------------------------------
create or replace function public.get_artisan_public_profile(p_artisan_id uuid)
returns table (
  artisan_id uuid,
  full_name text,
  photo_path text,
  trade public.artisan_trade,
  bio text,
  work_area text,
  rating_avg numeric(3, 2),
  rating_count integer,
  is_online boolean,
  verified_since timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  select
    ap.user_id as artisan_id,
    ap.full_name,
    ap.photo_path,
    ap.trade,
    ap.bio,
    ap.work_area,
    p.rating_avg,
    p.rating_count,
    (ap.is_online and ap.last_seen_at >= timezone('utc', now()) - interval '15 minutes') as is_online,
    ap.reviewed_at as verified_since
  from public.artisan_profiles ap
  join public.profiles p on p.id = ap.user_id
  where ap.user_id = p_artisan_id
    and (
      (ap.verification_status = 'approved' and p.account_status = 'active')
      or ap.user_id = auth.uid()
      or public.is_admin(auth.uid())
    );
end;
$$;

revoke all on function public.get_artisan_public_profile(uuid) from public, anon;
grant execute on function public.get_artisan_public_profile(uuid) to authenticated;
