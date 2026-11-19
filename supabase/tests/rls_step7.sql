-- ============================================================================
-- Step 7 SQL RLS, Confirmed-Only Rating, Unique Per-Side & Avg/Count Self-Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_cust uuid := gen_random_uuid();
  v_art uuid := gen_random_uuid();
  v_out uuid := gen_random_uuid();
  v_job_1 uuid;
  v_job_2 uuid;
  v_art_rev_id uuid;
  v_avg numeric(3, 2);
  v_cnt integer;
  v_count integer;
  v_blocked boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's7_c@example.test', now(), now()),
    (v_art, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's7_a@example.test', now(), now()),
    (v_out, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's7_o@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id in (v_cust, v_out);
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art;

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status)
  values (v_art, 'SQL Rated Mechanic', 'mechanic', 'Car engine and AC repairs.', 'Ikeja', 'RCP_s7_sql', 'approved');

  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, completed_at)
  values (v_cust, v_art, 'mechanic', 'Brake pad replacement.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'completed', now())
  returning id into v_job_1;

  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, completed_at, confirmed_at)
  values (v_cust, v_art, 'mechanic', 'Oil service and filter.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'confirmed', now(), now())
  returning id into v_job_2;

  -- Test 1: Cannot rate Job 1 while only 'completed' (not 'confirmed')
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_blocked := false;
  begin
    perform public.submit_job_review(v_job_1, 5, 'Too early', null);
  exception when invalid_parameter_value then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Allowed rating before confirmed!';
  end if;

  -- Confirm Job 1, then Customer rates Job 1 = 5 and Job 2 = 3 -> avg must be 4.00, count = 2
  reset role;
  update public.jobs set status = 'confirmed', confirmed_at = now() where id = v_job_1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.submit_job_review(v_job_1, 5, 'Great work', 'sql-r1');
  perform public.submit_job_review(v_job_2, 3, 'Decent', 'sql-r2');

  -- Test 2: Duplicate different review on Job 1 blocked
  v_blocked := false;
  begin
    perform public.submit_job_review(v_job_1, 1, 'Duplicate attempt', 'sql-r1-dup');
  exception when unique_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Duplicate review by same side was allowed!';
  end if;

  -- Verify average and count on artisan profile
  reset role;
  select rating_avg, rating_count into v_avg, v_cnt from public.profiles where id = v_art;
  if v_avg <> 4.00 or v_cnt <> 2 then
    raise exception 'FAIL: Expected avg 4.00 & count 2, got avg %, count %', v_avg, v_cnt;
  end if;

  -- Test 3: Artisan rates Customer; Outsider CANNOT read that private review
  perform set_config('request.jwt.claims', json_build_object('sub', v_art::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_art_rev_id from public.submit_job_review(v_job_1, 5, 'Nice customer', 'sql-ar1');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.reviews where id = v_art_rev_id;
  if v_count <> 0 then
    raise exception 'FAIL: Outsider read private artisan-to-customer review!';
  end if;

  raise notice 'PASS: All Step 7 SQL RLS, confirmed-only rating, unique per-side & avg/count assertions succeeded!';
end
$$;

rollback;
