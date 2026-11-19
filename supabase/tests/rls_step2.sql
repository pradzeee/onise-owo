-- ============================================================================
-- Step 2 SQL RLS & Approval Gate Self-Test (Rolls back cleanly!)
-- Run directly in Supabase SQL Editor after applying migrations 0001 and 0002.
-- ============================================================================
begin;

do $$
declare
  v_art_a uuid := gen_random_uuid();
  v_art_b uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_consent_a uuid;
  v_count integer;
  v_blocked boolean;
  v_shared_nin_hash text := encode(digest('test-nin-12345678901', 'sha256'), 'hex');
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_art_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2_a@example.test', now(), now()),
    (v_art_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2_b@example.test', now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's2_admin@example.test', now(), now());

  -- Designate admin manually in DB
  update public.profiles set role = 'admin', onboarding_completed_at = now() where id = v_admin;
  update public.profiles set role = 'artisan', onboarding_completed_at = now() where id in (v_art_a, v_art_b);

  insert into public.consents (user_id, consent_type, version, granted)
  values (v_art_a, 'face_matching', '2026-11-v1', true)
  returning id into v_consent_a;

  -- Seed identity hash for Artisan A
  insert into public.identity_hashes (user_id, hash_type, hash_value)
  values (v_art_a, 'nin', v_shared_nin_hash);

  -- Test 1: Same NIN hash on Artisan B must be blocked
  v_blocked := false;
  begin
    insert into public.identity_hashes (user_id, hash_type, hash_value)
    values (v_art_b, 'nin', v_shared_nin_hash);
  exception when unique_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Duplicate NIN hash was allowed on second account!';
  end if;

  -- Seed Artisan A & B profiles, verification & guarantor
  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status)
  values
    (v_art_a, 'Artisan A', 'plumber', 'Ten years fixing residential plumbing.', 'Ikeja, Lagos', 'RCP_test_a', 'pending'),
    (v_art_b, 'Artisan B', 'tailor', 'Bespoke native and English tailoring.', 'Surulere, Lagos', 'RCP_test_b', 'pending');

  insert into public.artisan_verifications (user_id, provider_name, provider_reference, provider_status, liveness_passed, face_match_passed, selfie_storage_path, face_matching_consent_id)
  values (v_art_a, 'dev_mock', 'ref_sql_a', 'passed', true, true, v_art_a::text || '/selfie.jpg', v_consent_a);

  insert into public.guarantor_verifications (artisan_id, guarantor_name, guarantor_phone_hash, guarantor_phone_e164, token_hash, status)
  values (v_art_a, 'Guarantor A', encode(digest('g1', 'sha256'), 'hex'), '+2348030000001', encode(digest('t1', 'sha256'), 'hex'), 'pending');

  -- Test 2: Unapproved artisan cannot go Online
  v_blocked := false;
  begin
    update public.artisan_profiles set is_online = true where user_id = v_art_a;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Unapproved artisan was allowed to go Online!';
  end if;

  -- Impersonate Artisan A
  perform set_config('request.jwt.claims', json_build_object('sub', v_art_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Test 3: Artisan A cannot see Artisan B
  select count(*) into v_count from public.artisan_profiles where user_id = v_art_b;
  if v_count <> 0 then
    raise exception 'FAIL: Artisan A read Artisan B profile!';
  end if;

  -- Test 4: Artisan A cannot self-approve via admin_review_artisan
  v_blocked := false;
  begin
    perform public.admin_review_artisan(v_art_a, 'approved', null, null);
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Artisan A called admin_review_artisan!';
  end if;

  -- Impersonate Admin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Test 5: Admin CANNOT approve before guarantor confirms
  v_blocked := false;
  begin
    perform public.admin_review_artisan(v_art_a, 'approved', null, null);
  exception when invalid_parameter_value then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Admin approved artisan before guarantor confirmation!';
  end if;

  -- Confirm guarantor as DB owner, then approve as Admin
  reset role;
  update public.guarantor_verifications set status = 'confirmed', confirmed_at = now() where artisan_id = v_art_a;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.log_admin_file_access(v_art_a, v_art_a::text || '/selfie.jpg', 60);
  perform public.admin_review_artisan(v_art_a, 'approved', null, 'sql-approve-1');
  -- Idempotent second call
  perform public.admin_review_artisan(v_art_a, 'approved', null, 'sql-approve-1');

  select count(*) into v_count from public.audit_log where target_id = v_art_a::text;
  if v_count < 2 then
    raise exception 'FAIL: Expected audit_log entries for file open + approval, got %', v_count;
  end if;

  raise notice 'PASS: All Step 2 SQL RLS, duplicate-NIN, dual-approval, and audit assertions succeeded!';
end
$$;

rollback;
