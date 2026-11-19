-- ============================================================================
-- Step 3 SQL RLS, PostGIS 10 km Discovery, ~100m Rounding & Fallback Self-Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_cust uuid := gen_random_uuid();
  v_art_near uuid := gen_random_uuid();
  v_art_far uuid := gen_random_uuid();
  v_count integer;
  v_blocked boolean;
  v_lat double precision;
  v_lng double precision;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3_cust@example.test', now(), now()),
    (v_art_near, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3_near@example.test', now(), now()),
    (v_art_far, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's3_far@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id = v_cust;
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art_near;
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'pending' where id = v_art_far;

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status)
  values
    (v_art_near, 'Near Approved Plumber', 'plumber', 'Experienced plumber in Ikeja.', 'Ikeja, Lagos', 'RCP_s3_near', 'approved'),
    (v_art_far, 'Pending Plumber', 'plumber', 'Pending plumber waiting for review.', 'Ikeja, Lagos', 'RCP_s3_far', 'pending');

  -- Test 1: Unapproved artisan cannot go Online
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_far::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.set_optional_consent('location', true, '2026-11-v1', 's3-loc-far');
  v_blocked := false;
  begin
    perform * from public.set_artisan_presence(true, 6.602, 3.351);
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Unapproved artisan went Online!';
  end if;

  -- Test 2: Approved artisan goes Online -> rounded to ~100m (3 decimals)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_near::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.set_optional_consent('location', true, '2026-11-v1', 's3-loc-near');
  select approx_lat, approx_lng into v_lat, v_lng
  from public.set_artisan_presence(true, 6.602489, 3.351891);

  if v_lat <> 6.602 or v_lng <> 3.352 then
    raise exception 'FAIL: Coordinates were not rounded to ~100m (got %, %)', v_lat, v_lng;
  end if;

  -- Save a push subscription for v_art_near
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_art_near, 'https://push.example.test/sql-sub', 'p256dh_key_value_123456', 'auth_key_value_123456');

  -- Test 3: Customer finds v_art_near within 10 km and CANNOT read v_art_near push_subscriptions
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.find_nearby_artisans('plumber', 6.605, 3.355, 10000, 20)
  where artisan_id = v_art_near;
  if v_count <> 1 then
    raise exception 'FAIL: Expected near artisan in 10 km discovery, got %', v_count;
  end if;

  select count(*) into v_count from public.push_subscriptions where user_id = v_art_near;
  if v_count <> 0 then
    raise exception 'FAIL: Customer read artisan push_subscriptions!';
  end if;

  -- Test 4: Stale >15 minutes artisan disappears from discovery
  reset role;
  update public.artisan_profiles set last_seen_at = now() - interval '16 minutes' where user_id = v_art_near;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count
  from public.find_nearby_artisans('plumber', 6.605, 3.355, 10000, 20)
  where artisan_id = v_art_near;
  if v_count <> 0 then
    raise exception 'FAIL: Stale >15m artisan still appeared in discovery!';
  end if;

  raise notice 'PASS: All Step 3 SQL RLS, ~100m rounding, 10 km discovery & 15m expiry assertions succeeded!';
end
$$;

rollback;
