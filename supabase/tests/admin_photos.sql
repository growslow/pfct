begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end;
$$;
create function pg_temp.assert_denied(statement text,expected_state text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if sqlstate=expected_state then return; end if; raise; end;
raise exception 'FAIL: operation unexpectedly succeeded'; end;
$$;
insert into auth.users(id,email) values
('80000000-0000-4000-8000-000000000001','photo-admin@example.invalid'),
('80000000-0000-4000-8000-000000000002','photo-owner@example.invalid'),
('80000000-0000-4000-8000-000000000003','photo-other@example.invalid');
insert into public.app_admins(user_id) values('80000000-0000-4000-8000-000000000001');
select set_config('photo_test.owner',(select id::text from public.participants where auth_user_id='80000000-0000-4000-8000-000000000002'),true);
select set_config('photo_test.path',current_setting('photo_test.owner')||'/81000000-0000-4000-8000-000000000001/registered.png',true);
insert into public.meals(id,participant_id,eaten_at,timezone,meal_type)
values('81000000-0000-4000-8000-000000000001',current_setting('photo_test.owner')::uuid,now(),'Asia/Shanghai','lunch');
insert into public.meal_photos(participant_id,meal_id,storage_path)
values(current_setting('photo_test.owner')::uuid,'81000000-0000-4000-8000-000000000001',current_setting('photo_test.path'));
insert into storage.objects(bucket_id,name) values('meal-photos',current_setting('photo_test.path')),
('meal-photos',current_setting('photo_test.owner')||'/81000000-0000-4000-8000-000000000001/orphan.png');

set local role anon;
select pg_temp.assert_denied('select public.admin_meal_photos(''81000000-0000-4000-8000-000000000001'')','42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"80000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert_denied('select public.admin_meal_photos(''81000000-0000-4000-8000-000000000001'')','42501');
select pg_temp.assert_true(not public.admin_can_read_photo(current_setting('photo_test.path')),'ordinary user cannot acquire admin photo access');
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='meal-photos'),'other user cannot read photos');

select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true((public.admin_meal_photos('81000000-0000-4000-8000-000000000001')->>'total')::integer=1,'admin can list registered metadata');
select pg_temp.assert_true(jsonb_array_length(public.admin_meal_photos('81000000-0000-4000-8000-000000000001',1,12)->'photos')=0,'pagination works');
select pg_temp.assert_true(public.admin_can_read_photo(current_setting('photo_test.path')),'admin can read registered photo');
select pg_temp.assert_true((select count(*)=1 from storage.objects where bucket_id='meal-photos'),'unregistered files are not exposed to admin');
select pg_temp.assert_true((select count(*)=0 from public.meal_photos),'ordinary metadata table RLS is not broadened');
reset role;
select pg_temp.assert_true((select count(*)=2 from public.admin_access_log where action='meal_photos'),'metadata reads are audited');
delete from public.app_admins where user_id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(not public.admin_can_read_photo(current_setting('photo_test.path')),'revocation applies before further downloads');
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='meal-photos'),'revoked admin cannot read cross-user photos');
select pg_temp.assert_denied('select public.admin_meal_photos(''81000000-0000-4000-8000-000000000001'')','42501');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=2 from storage.objects where bucket_id='meal-photos'),'owner retains original photo access');
reset role;
select 'Administrator private photo preview checks passed.' as result;
rollback;
