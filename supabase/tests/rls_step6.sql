-- ============================================================================
-- Step 6 SQL RLS, Duplicate Webhook Idempotency, Amount Check & 24h Auto-Confirm
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
  v_outcome text;
  v_count integer;
  v_hash text := encode(digest('webhook-body', 'sha256'), 'hex');
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's6_c@example.test', now(), now()),
    (v_art, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's6_a@example.test', now(), now()),
    (v_out, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's6_o@example.test', now(), now());

  update public.profiles set role = 'customer', onboarding_completed_at = now() where id in (v_cust, v_out);
  update public.profiles set role = 'artisan', onboarding_completed_at = now(), verification_status = 'approved' where id = v_art;

  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, accepted_amount_kobo, completed_at)
  values
    (v_cust, v_art, 'plumber', 'Job 1 completed over 24h ago.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'completed', 2000000, now() - interval '25 hours')
  returning id into v_job_1;

  insert into public.jobs (customer_id, artisan_id, trade, description, approx_location, approx_area_label, status, accepted_amount_kobo, completed_at)
  values
    (v_cust, v_art, 'plumber', 'Job 2 disputed over 24h ago.', st_setsrid(st_makepoint(3.351, 6.602), 4326)::geography, 'Ikeja', 'completed', 2000000, now() - interval '25 hours')
  returning id into v_job_2;

  insert into public.payments (job_id, customer_id, artisan_id, provider_reference, amount_kobo, commission_kobo, status)
  values
    (v_job_1, v_cust, v_art, 'ref_sql_mismatch', 2000000, 300000, 'pending'),
    (v_job_1, v_cust, v_art, 'ref_sql_good', 2000000, 300000, 'pending');

  -- Test 1: Mismatched paid amount is rejected
  select outcome into v_outcome
  from public.process_paystack_charge_success('evt_sql_mis', 'charge.success', 'ref_sql_mismatch', 100000, v_hash);
  if v_outcome <> 'amount_mismatch' then
    raise exception 'FAIL: Expected amount_mismatch, got %', v_outcome;
  end if;

  -- Test 2: Same webhook sent twice pays ONLY ONCE
  select outcome into v_outcome
  from public.process_paystack_charge_success('evt_sql_good', 'charge.success', 'ref_sql_good', 2000000, v_hash);
  if v_outcome <> 'paid' then
    raise exception 'FAIL: Expected paid on 1st webhook, got %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.process_paystack_charge_success('evt_sql_good', 'charge.success', 'ref_sql_good', 2000000, v_hash);
  if v_outcome <> 'duplicate_ignored' then
    raise exception 'FAIL: Expected duplicate_ignored on 2nd webhook, got %', v_outcome;
  end if;

  -- Test 3: Outsider cannot read payments via RLS
  perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.payments where job_id = v_job_1;
  if v_count <> 0 then
    raise exception 'FAIL: Outsider read payments!';
  end if;

  -- Test 4: Customer opens dispute on Job 2 -> blocks 24h auto-confirm while Job 1 auto-confirms
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.open_job_dispute(v_job_2, 'incomplete_work', 'Still leaking badly.', 'sql-disp-1');

  reset role;
  perform public.auto_confirm_completed_jobs();

  select count(*) into v_count from public.jobs where id = v_job_1 and status = 'confirmed';
  if v_count <> 1 then
    raise exception 'FAIL: Job 1 should have auto-confirmed after 24h!';
  end if;

  select count(*) into v_count from public.jobs where id = v_job_2 and status = 'disputed';
  if v_count <> 1 then
    raise exception 'FAIL: Disputed Job 2 must NOT auto-confirm!';
  end if;

  raise notice 'PASS: All Step 6 SQL RLS, duplicate-webhook, amount-check & 24h auto-confirm assertions succeeded!';
end
$$;

rollback;
