-- ============================================================================
-- Step 1 SQL RLS Self-Test (Safe to run in Supabase SQL Editor: rolls back!)
-- Proves User A cannot read/write User B's data and cannot self-promote.
-- ============================================================================
begin;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_count integer;
  v_blocked boolean;
begin
  -- Seed two synthetic auth.users rows inside the rolled-back transaction
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user_a_rls@example.test', now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user_b_rls@example.test', now(), now());

  -- Impersonate User A (authenticated JWT)
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Test 1: User A cannot select 'admin' via complete_onboarding
  v_blocked := false;
  begin
    perform public.complete_onboarding('admin', '2026-11-v1', '2026-11-v1', true, 'sql-test-1');
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: User A was able to select admin role!';
  end if;

  -- Test 2: User A completes onboarding as customer (idempotently twice)
  perform public.complete_onboarding('customer', '2026-11-v1', '2026-11-v1', true, 'sql-test-a');
  perform public.complete_onboarding('customer', '2026-11-v1', '2026-11-v1', true, 'sql-test-a');

  select count(*) into v_count from public.consents where user_id = v_user_a;
  if v_count <> 3 then
    raise exception 'FAIL: Expected 3 consents for User A, got %', v_count;
  end if;

  -- Test 3: User A cannot directly update their own role to admin
  v_blocked := false;
  begin
    update public.profiles set role = 'admin' where id = v_user_a;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: User A updated their own role directly!';
  end if;

  -- Test 4: User A cannot read User B's profile
  select count(*) into v_count from public.profiles where id = v_user_b;
  if v_count <> 0 then
    raise exception 'FAIL: User A read User B profile!';
  end if;

  -- Test 5: User A cannot read User B's consents
  select count(*) into v_count from public.consents where user_id = v_user_b;
  if v_count <> 0 then
    raise exception 'FAIL: User A read User B consents!';
  end if;

  -- Test 6: Customer cannot grant artisan-only face_matching consent
  v_blocked := false;
  begin
    perform public.set_optional_consent('face_matching', true, '2026-11-v1', 'sql-face-1');
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Customer granted face_matching consent!';
  end if;

  -- Impersonate User B (artisan)
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.complete_onboarding('artisan', '2026-11-v1', '2026-11-v1', true, 'sql-test-b');
  perform public.set_optional_consent('face_matching', true, '2026-11-v1', 'sql-face-b1');
  perform public.set_optional_consent('face_matching', false, '2026-11-v1', 'sql-face-b2');

  -- User B cannot see User A's profile or consents
  select count(*) into v_count from public.profiles where id = v_user_a;
  if v_count <> 0 then
    raise exception 'FAIL: User B read User A profile!';
  end if;

  select count(*) into v_count from public.consents where user_id = v_user_a;
  if v_count <> 0 then
    raise exception 'FAIL: User B read User A consents!';
  end if;

  raise notice 'PASS: All Step 1 SQL RLS assertions succeeded!';
end
$$;

rollback;
