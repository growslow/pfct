begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end;
$$;
create function pg_temp.assert_denied(statement text,expected_state text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if sqlstate=expected_state then return; end if; raise; end;
raise exception 'FAIL: operation unexpectedly succeeded'; end;
$$;

insert into auth.users(id,email,raw_user_meta_data) values
('70000000-0000-4000-8000-000000000001','admin-test@example.invalid','{}'),
('70000000-0000-4000-8000-000000000002','user-test@example.invalid','{"role":"admin","is_admin":true}'),
('70000000-0000-4000-8000-000000000003','other-test@example.invalid','{}');
insert into public.app_admins(user_id) values('70000000-0000-4000-8000-000000000001');
select set_config('admin_test.participant',(select id::text from public.participants where auth_user_id='70000000-0000-4000-8000-000000000002'),true);
insert into public.meals(id,participant_id,eaten_at,timezone,meal_type)
values('71000000-0000-4000-8000-000000000001',current_setting('admin_test.participant')::uuid,now(),'Asia/Shanghai','lunch');
insert into public.guesses(participant_id,meal_id,protein_g,fat_g,carbs_g,calories_kcal) values
(current_setting('admin_test.participant')::uuid,'71000000-0000-4000-8000-000000000001',10,5,20,200),
(current_setting('admin_test.participant')::uuid,'71000000-0000-4000-8000-000000000001',12,5,20,210);

set local role anon;
select pg_temp.assert_denied('select public.admin_overview()','42501');
select pg_temp.assert_denied('select public.is_admin()','42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"admin","is_admin":true}}',true);
select pg_temp.assert_true(not public.is_admin(),'signup metadata cannot grant admin');
select pg_temp.assert_denied('select public.admin_overview()','42501');
select pg_temp.assert_denied('select public.admin_participants()','42501');
select pg_temp.assert_denied('select public.admin_participant_detail(current_setting(''admin_test.participant'')::uuid)','42501');
select pg_temp.assert_denied('select * from public.app_admins','42501');
select pg_temp.assert_denied('insert into public.app_admins(user_id) values(''70000000-0000-4000-8000-000000000002'')','42501');
select pg_temp.assert_denied('select * from public.admin_access_log','42501');

select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true(public.is_admin(),'database member is admin');
select pg_temp.assert_true((public.admin_overview()->>'participants')::integer=3,'overview counts participant records');
select pg_temp.assert_true((public.admin_overview()->>'guesses')::integer=2,'all guess attempts counted');
select pg_temp.assert_true((public.admin_participants(current_setting('admin_test.participant'),'with_records',0,20)->>'total')::integer=1,'ID and record filtering');
select pg_temp.assert_true(jsonb_array_length(public.admin_participants('','all',0,1)->'rows')=1,'participant pagination');
select pg_temp.assert_true(jsonb_array_length(public.admin_participant_detail(current_setting('admin_test.participant')::uuid)->'meals'->0->'guesses')=2,'detail preserves both guesses');
select pg_temp.assert_true((public.admin_participant_detail(current_setting('admin_test.participant')::uuid)->>'meal_total')::integer=1,'meal count returned');
select pg_temp.assert_true((select count(*)=1 from public.participants),'direct table access still obeys own-user RLS');
select pg_temp.assert_denied('update public.guesses set protein_g=99','42501');
reset role;
select pg_temp.assert_true((select count(*)>=6 from public.admin_access_log),'admin reads audited');
delete from public.app_admins where user_id='70000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(not public.is_admin(),'revocation applies to existing session');
select pg_temp.assert_denied('select public.admin_overview()','42501');
reset role;
select 'Administrator access boundaries passed.' as result;
rollback;
