begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end;
$$;
create function pg_temp.assert_denied(statement text, expected_state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate = expected_state then return; end if; raise; end;
  raise exception 'FAIL: operation unexpectedly succeeded';
end;
$$;

insert into auth.users(id,email) values
('60000000-0000-4000-8000-000000000001','confirmation-a@example.invalid'),
('60000000-0000-4000-8000-000000000002','confirmation-b@example.invalid');
insert into public.meals(id,participant_id,eaten_at,timezone,meal_type)
select '61000000-0000-4000-8000-000000000001',id,now(),'Asia/Shanghai','lunch'
from public.participants where auth_user_id='60000000-0000-4000-8000-000000000001';
insert into public.guesses(id,participant_id,meal_id,protein_g,fat_g,carbs_g,calories_kcal)
select '62000000-0000-4000-8000-000000000001',id,'61000000-0000-4000-8000-000000000001',10,4,20,156
from public.participants where auth_user_id='60000000-0000-4000-8000-000000000001';

select public.save_food_confirmation('63000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
'61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
'[{"food_id":"1","serving_id":"2","quantity":150,"measure":"g"}]');
select public.save_food_confirmation('63000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
'61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
'[{"food_id":"1","serving_id":"2","quantity":150,"measure":"g"}]');
select pg_temp.assert_true((select count(*)=1 from public.food_confirmations),'retry creates one record');
select pg_temp.assert_denied($q$select public.save_food_confirmation('63000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
'61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
'[{"food_id":"1","serving_id":"2","quantity":200,"measure":"g"}]')$q$,'P0001');
select pg_temp.assert_denied($q$select public.save_food_confirmation('63000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',
'61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
'[{"food_id":"1","serving_id":"2","quantity":150,"measure":"g"}]')$q$,'42501');
select pg_temp.assert_denied($q$select public.save_food_confirmation('63000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',
'61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
'[{"food_id":"1","serving_id":"2","quantity":150,"measure":"g","protein_g":10}]')$q$,'P0001');

set local role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=1 from public.food_confirmations),'owner sees confirmations');
select pg_temp.assert_denied('insert into public.food_confirmations default values','42501');
select pg_temp.assert_denied('update public.food_confirmations set items=''[]''','42501');
select pg_temp.assert_denied($q$select public.save_food_confirmation(null,null,null,null,null)$q$,'42501');
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*)=0 from public.food_confirmations),'other users cannot see confirmations');
set local role anon;
select pg_temp.assert_denied('select * from public.food_confirmations','42501');
reset role;
select 'Food confirmation access and retry checks passed.' as result;
rollback;
