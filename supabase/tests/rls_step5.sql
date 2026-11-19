-- ============================================================================
-- Step 5 SQL RLS, Accepted-Only Chat, 7-Day Close, Report & Block Self-Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_cust uuid := gen_random_uuid();
  v_art uuid := gen_random_uuid();
  v_out uuid := gen_random_uuid();
  v_job_id uuid;
  v_count integer;
  v_blocked boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5_c@example.test', now(), now()),
    (v_art, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5_a@example.test', now(), now()),
    (v_out, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5_o@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id in (v_cust, v_out);
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art;

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status)
  values (v_art, 'SQL Chat Artisan', 'painter', 'Interior house painter.', 'Ikeja', 'RCP_s5_sql', 'approved');

  insert into public.jobs (customer_id, trade, description, dispatch_mode, approx_location, approx_area_label, status)
  values (v_cust, 'painter', 'Paint two bedroom walls.', 'direct', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'requested')
  returning id into v_job_id;

  -- Test 1: Cannot chat before acceptance
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_blocked := false;
  begin
    perform public.send_job_message(v_job_id, 'Too early', null);
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Sent chat message before job acceptance!';
  end if;

  -- Accept job as DB owner
  reset role;
  update public.jobs set artisan_id = v_art, status = 'accepted', accepted_at = now() where id = v_job_id;

  -- Test 2: Customer sends message; Outsider sees 0 rows
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.send_job_message(v_job_id, 'Hello artisan!', 'sql-msg-1');
  perform public.create_user_report(v_art, v_job_id, 'other', 'Testing report privacy.', 'sql-rep-1');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.job_messages where job_id = v_job_id;
  if v_count <> 0 then
    raise exception 'FAIL: Outsider read job_messages!';
  end if;

  select count(*) into v_count from public.user_reports where job_id = v_job_id;
  if v_count <> 0 then
    raise exception 'FAIL: Outsider read user_reports!';
  end if;

  -- Test 3: Block stops messaging
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.block_user(v_art, v_job_id, 'Blocked in test');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_art::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_blocked := false;
  begin
    perform public.send_job_message(v_job_id, 'Blocked test', null);
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Blocked user sent message!';
  end if;

  -- Test 4: 7 days after completion -> chat closes
  reset role;
  delete from public.user_blocks where blocker_id = v_cust;
  update public.jobs set status = 'completed', completed_at = now() - interval '8 days' where id = v_job_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_blocked := false;
  begin
    perform public.send_job_message(v_job_id, 'Too late', null);
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Sent chat message more than 7 days after job ended!';
  end if;

  raise notice 'PASS: All Step 5 SQL RLS, accepted-only chat, 7-day close, report & block assertions succeeded!';
end
$$;

rollback;
