-- ============================================================================
-- Step 4 SQL RLS, Exact Address Gate, Atomic Accept, Quotes & Cancel Fee Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_cust_a uuid := gen_random_uuid();
  v_cust_b uuid := gen_random_uuid();
  v_art_1 uuid := gen_random_uuid();
  v_art_2 uuid := gen_random_uuid();
  v_job_id uuid;
  v_quote_id uuid;
  v_count integer;
  v_won boolean;
  v_req_status public.job_request_status;
  v_fee bigint;
  v_code_hash text := encode(digest('1234', 'sha256'), 'hex');
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's4_ca@example.test', now(), now()),
    (v_cust_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's4_cb@example.test', now(), now()),
    (v_art_1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's4_a1@example.test', now(), now()),
    (v_art_2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's4_a2@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id in (v_cust_a, v_cust_b);
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id in (v_art_1, v_art_2);

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status, is_online, last_seen_at, approx_location)
  values
    (v_art_1, 'SQL Plumber 1', 'plumber', 'Lagos plumber one.', 'Ikeja', 'RCP_s4_1', 'approved', true, now(), st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography),
    (v_art_2, 'SQL Plumber 2', 'plumber', 'Lagos plumber two.', 'Ikeja', 'RCP_s4_2', 'approved', true, now(), st_setsrid(st_makepoint(3.352, 6.603), 4326)::geography);

  insert into public.jobs (customer_id, trade, description, dispatch_mode, dispatch_round, round_expires_at, approx_location, approx_area_label)
  values (v_cust_a, 'plumber', 'Fixing leaking kitchen sink trap.', 'nearest_3', 1, now() + interval '60 seconds', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja, Lagos')
  returning id into v_job_id;

  insert into public.job_private_addresses (job_id, exact_address, exact_lat, exact_lng)
  values (v_job_id, 'No 10 Allen Avenue, Ikeja', 6.6021, 3.3512);

  insert into public.job_requests (job_id, artisan_id, round_number, status, expires_at)
  values
    (v_job_id, v_art_1, 1, 'sent', now() + interval '60 seconds'),
    (v_job_id, v_art_2, 1, 'sent', now() + interval '60 seconds');

  -- Test 1: Invited Artisan 1 CANNOT see exact address before acceptance
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.job_private_addresses where job_id = v_job_id;
  if v_count <> 0 then
    raise exception 'FAIL: Invited artisan read exact address BEFORE acceptance!';
  end if;

  -- Test 2: Artisan 1 accepts atomically -> wins and unlocks exact address
  select won, request_status into v_won, v_req_status
  from public.accept_job_request(v_job_id, 'nonce123', v_code_hash);
  if not v_won or v_req_status <> 'accepted' then
    raise exception 'FAIL: Artisan 1 should have won accept!';
  end if;

  select count(*) into v_count from public.job_private_addresses where job_id = v_job_id;
  if v_count <> 1 then
    raise exception 'FAIL: Winning artisan could not read exact address after acceptance!';
  end if;

  -- Test 3: Artisan 2 tries to accept -> sees 'taken' and STILL cannot read exact address
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select won, request_status into v_won, v_req_status
  from public.accept_job_request(v_job_id, 'nonce456', v_code_hash);
  if v_won or v_req_status <> 'taken' then
    raise exception 'FAIL: Second artisan must see taken (got won=%, status=%)', v_won, v_req_status;
  end if;

  select count(*) into v_count from public.job_private_addresses where job_id = v_job_id;
  if v_count <> 0 then
    raise exception 'FAIL: Non-winning artisan read exact address!';
  end if;

  -- Test 4: Customer B cannot read Customer A's job
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.jobs where id = v_job_id;
  if v_count <> 0 then
    raise exception 'FAIL: Customer B read Customer A job!';
  end if;

  -- Test 5: Quote (₦20,000) -> Accept -> En Route -> Customer Cancel incurs ₦2,000 (200,000 kobo) fee
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_quote_id from public.submit_job_quote(v_job_id, 2000000, 'Labour + pipe', 'sql-q1');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.respond_to_quote(v_quote_id, true);

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.transition_job_status(v_job_id, 'en_route');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select cancel_fee_kobo into v_fee from public.cancel_job(v_job_id, 'Changed mind');
  if v_fee <> 200000 then
    raise exception 'FAIL: Expected 200000 kobo cancel fee after en_route, got %', v_fee;
  end if;

  raise notice 'PASS: All Step 4 SQL RLS, exact-address gating, atomic accept, quotes & cancel fee assertions succeeded!';
end
$$;

rollback;
