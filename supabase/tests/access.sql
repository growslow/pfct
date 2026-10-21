-- Execute as the local database owner. All fixtures are rolled back.
begin;

create function pg_temp.assert_true(ok boolean, message text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end;
$$;

create function pg_temp.assert_denied(statement text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'FAIL: operation unexpectedly succeeded: %', statement;
end;
$$;

insert into auth.users(id, email) values
  ('10000000-0000-0000-0000-000000000001', 'pfct-test-a@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'pfct-test-b@example.invalid');

select set_config('pfct_test.a', (select id::text from public.participants where auth_user_id = '10000000-0000-0000-0000-000000000001'), true);
select set_config('pfct_test.b', (select id::text from public.participants where auth_user_id = '10000000-0000-0000-0000-000000000002'), true);

insert into public.meals(id, participant_id, eaten_at, timezone, meal_type)
values ('20000000-0000-0000-0000-000000000002', current_setting('pfct_test.b')::uuid, now(), 'Asia/Shanghai', 'lunch');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select pg_temp.assert_true((select count(*) = 1 from public.participants), 'only own participant visible');
select pg_temp.assert_true((select count(*) = 0 from public.meals), 'other meals hidden');

insert into public.meals(id, participant_id, eaten_at, timezone, meal_type)
values ('20000000-0000-0000-0000-000000000001', current_setting('pfct_test.a')::uuid, now(), 'Asia/Shanghai', 'lunch');

insert into public.guesses(id, participant_id, meal_id, protein_g, fat_g, carbs_g, calories_kcal)
values ('30000000-0000-0000-0000-000000000001', current_setting('pfct_test.a')::uuid,
  '20000000-0000-0000-0000-000000000001', 30, 20, 60, 550);
select pg_temp.assert_true((select count(*) = 1 from public.guesses), 'own guess readable');

select pg_temp.assert_denied(format(
  'insert into public.meals(participant_id,eaten_at,timezone,meal_type) values (%L,now(),''UTC'',''lunch'')',
  current_setting('pfct_test.b')), '42501');
select pg_temp.assert_denied(format(
  'insert into public.guesses(participant_id,meal_id,protein_g,fat_g,carbs_g,calories_kcal) values (%L,''20000000-0000-0000-0000-000000000002'',1,1,1,1)',
  current_setting('pfct_test.a')), '23503');
select pg_temp.assert_denied(format(
  'insert into public.guesses(participant_id,meal_id,protein_g,fat_g,carbs_g,calories_kcal) values (%L,''20000000-0000-0000-0000-000000000001'',-1,1,1,1)',
  current_setting('pfct_test.a')), '23514');
select pg_temp.assert_denied(format(
  'insert into public.guesses(participant_id,meal_id,protein_g,fat_g,carbs_g,calories_kcal,created_at) values (%L,''20000000-0000-0000-0000-000000000001'',1,1,1,1,now())',
  current_setting('pfct_test.a')), '42501');
select pg_temp.assert_denied('update public.guesses set protein_g = 99', '42501');
select pg_temp.assert_denied('delete from public.guesses', '42501');
select pg_temp.assert_denied('insert into public.nutrition_estimates default values', '42501');
select pg_temp.assert_denied('insert into public.feedback default values', '42501');

-- Exercise Storage RLS at the database layer; actual uploads need an API smoke test.
insert into storage.objects(bucket_id, name) values ('meal-photos',
  current_setting('pfct_test.a') || '/20000000-0000-0000-0000-000000000001/test.jpg');
select pg_temp.assert_denied(format(
  'insert into storage.objects(bucket_id,name) values (''meal-photos'',%L)',
  current_setting('pfct_test.b') || '/20000000-0000-0000-0000-000000000002/test.jpg'), '42501');
select pg_temp.assert_denied(format(
  'insert into storage.objects(bucket_id,name) values (''meal-photos'',%L)',
  current_setting('pfct_test.a') || '/20000000-0000-0000-0000-000000000099/test.jpg'), '42501');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select pg_temp.assert_true((select count(*) = 0 from public.guesses), 'other guesses hidden');
select pg_temp.assert_true((select count(*) = 0 from storage.objects where bucket_id = 'meal-photos'), 'other photos hidden');

set local role anon;
select pg_temp.assert_denied('select * from public.meals', '42501');
reset role;
select 'PFCT access checks passed; rolling back fixtures.' as result;
rollback;
