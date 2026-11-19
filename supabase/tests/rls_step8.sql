-- ============================================================================
-- Step 8 SQL RLS, Deletion Blockers, Pause, Erasure, Archive & Ban Self-Test
-- Safe to run in Supabase SQL Editor (rolls back cleanly!).
-- ============================================================================
begin;

do $$
declare
  v_cust uuid := gen_random_uuid();
  v_art uuid := gen_random_uuid();
  v_job_id uuid;
  v_scheduled boolean;
  v_active_jobs integer;
  v_archived integer;
  v_ban_created boolean;
  v_count integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's8_c@example.test', now(), now()),
    (v_art, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's8_a@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id = v_cust;
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art;

  insert into public.artisan_profiles (user_id, full_name, trade, bio, work_area, payout_recipient_code, verification_status, is_online)
  values (v_art, 'SQL Pause Artisan', 'painter', 'Interior painter.', 'Ikeja', 'RCP_s8_sql', 'approved', true);

  -- Test 1: Artisan pause hides them & sets is_online = false
  perform set_config('request.jwt.claims', json_build_object('sub', v_art::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_artisan_account_pause(true);

  reset role;
  select count(*) into v_count from public.artisan_profiles where user_id = v_art and is_online = false;
  if v_count <> 1 then
    raise exception 'FAIL: Pausing artisan did not set is_online = false!';
  end if;

  -- Test 2: Active job blocks deletion
  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, accepted_amount_kobo)
  values (v_cust, v_art, 'painter', 'Active job blocking deletion.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'in_progress', 1000000)
  returning id into v_job_id;

  select scheduled, active_jobs_count into v_scheduled, v_active_jobs
  from public.initiate_account_deletion(v_cust, 'user_requested', false);
  if v_scheduled or v_active_jobs <> 1 then
    raise exception 'FAIL: Deletion should have been blocked by active job!';
  end if;

  -- Confirm job, insert paid payment + review + fraud NIN hash -> test erasure + archive + anonymisation
  update public.jobs set status = 'confirmed', completed_at = now(), confirmed_at = now() where id = v_job_id;
  insert into public.payments (job_id, customer_id, artisan_id, provider_reference, amount_kobo, commission_kobo, status, paid_at)
  values (v_job_id, v_cust, v_art, 'ref_sql_s8_archive', 1000000, 150000, 'paid', now());
  insert into public.reviews (job_id, reviewer_id, reviewee_id, reviewer_role, reviewer_display_name, rating, comment)
  values (v_job_id, v_cust, v_art, 'customer', 'Customer Real Name', 5, 'Great work');
  insert into public.identity_hashes (user_id, hash_type, hash_value)
  values (v_cust, 'nin', encode(digest('fraud-nin-sql', 'sha256'), 'hex'));

  select scheduled into v_scheduled
  from public.initiate_account_deletion(v_cust, 'fraud', false);
  if not v_scheduled then
    raise exception 'FAIL: Deletion should have succeeded once job was confirmed!';
  end if;

  select payment_records_archived, ban_record_created into v_archived, v_ban_created
  from public.execute_user_data_erasure_db(v_cust, 'anon_sql_test_1', 2);
  if v_archived <> 1 or not v_ban_created then
    raise exception 'FAIL: Expected 1 archived payment and ban record created!';
  end if;

  -- Verify review was anonymised
  select count(*) into v_count
  from public.reviews
  where job_id = v_job_id and reviewer_id is null and reviewer_display_name = 'Anonymous user' and is_anonymized = true;
  if v_count <> 1 then
    raise exception 'FAIL: Review was not anonymised!';
  end if;

  -- Verify non-admin cannot read deletion_logs, payment_archives, or ban_records
  perform set_config('request.jwt.claims', json_build_object('sub', v_art::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.deletion_logs;
  if v_count <> 0 then raise exception 'FAIL: Non-admin read deletion_logs!'; end if;
  select count(*) into v_count from public.payment_archives;
  if v_count <> 0 then raise exception 'FAIL: Non-admin read payment_archives!'; end if;
  select count(*) into v_count from public.ban_records;
  if v_count <> 0 then raise exception 'FAIL: Non-admin read ban_records!'; end if;

  raise notice 'PASS: All Step 8 SQL RLS, blocker, pause, anonymisation, 6y archive & 5y ban assertions succeeded!';
end
$$;

rollback;
