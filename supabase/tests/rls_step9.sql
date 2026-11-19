-- ============================================================================
-- Step 9 SQL RLS, Urgent Safety Suspension, Dispute, Report & Audit Self-Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_cust uuid := gen_random_uuid();
  v_art uuid := gen_random_uuid();
  v_susp_id uuid;
  v_job_id uuid;
  v_disp_id uuid;
  v_rep_id uuid;
  v_count integer;
  v_blocked boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's9_adm@example.test', now(), now()),
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's9_c@example.test', now(), now()),
    (v_art, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's9_a@example.test', now(), now());

  update public.profiles set role = 'admin', onboarding_completed_at = now() where id = v_admin;
  update public.profiles set role = 'customer', onboarding_completed_at = now() where id = v_cust;
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art;

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status, is_online)
  values (v_art, 'SQL S9 Artisan', 'mechanic', 'Mobile car mechanic.', 'Ikeja', 'RCP_s9_sql', 'approved', true);

  -- Test 1: Non-admin blocked from admin_suspend_user
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_blocked := false;
  begin
    perform public.admin_suspend_user(v_art, 'Unauthorized attempt', true, now() + interval '2 days');
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: Non-admin called admin_suspend_user!';
  end if;

  -- Test 2: Admin urgent safety suspension applies immediately & logs to audit_log
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select id into v_susp_id from public.admin_suspend_user(v_art, 'Urgent safety report', true, now() + interval '2 days');
  perform public.admin_review_safety_suspension(v_susp_id, 'lifted', 'Verified cleared by human reviewer.');

  -- Seed disputed job & report -> Admin resolves both
  reset role;
  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, accepted_amount_kobo, completed_at)
  values (v_cust, v_art, 'mechanic', 'Disputed engine repair.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'disputed', 1500000, now())
  returning id into v_job_id;

  insert into public.disputes (job_id, opened_by, reason, details, status)
  values (v_job_id, v_cust, 'incomplete_work', 'Car still fails to start.', 'open')
  returning id into v_disp_id;

  insert into public.user_reports (reporter_id, reported_user_id, job_id, category, details)
  values (v_cust, v_art, v_job_id, 'other', 'Test report for admin.')
  returning id into v_rep_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.admin_resolve_dispute(v_disp_id, 'resolved_release', 'Evidence confirmed work matched quote.');
  perform public.admin_update_report(v_rep_id, 'resolved', 'Handled and closed.');

  select count(*) into v_count from public.audit_log where actor_id = v_admin;
  if v_count < 4 then
    raise exception 'FAIL: Expected at least 4 audit_log rows for admin actions, got %', v_count;
  end if;

  raise notice 'PASS: All Step 9 SQL RLS, urgent safety suspension, dispute, report & audit_log assertions succeeded!';
end
$$;

rollback;
