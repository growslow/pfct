begin;

alter table public.admin_access_log drop constraint admin_access_log_action_check;
alter table public.admin_access_log add constraint admin_access_log_action_check
check(action in ('overview','participants','participant_detail','meal_photos'));

-- SECURITY DEFINER allows checking registered photos without relaxing meal_photos RLS.
create function public.admin_can_read_photo(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_admin() and exists (
    select 1 from public.meal_photos p
    join public.meals m on m.id=p.meal_id and m.participant_id=p.participant_id
    where p.storage_path=p_path
      and p_path like p.participant_id::text||'/'||p.meal_id::text||'/%'
  );
$$;
revoke all on function public.admin_can_read_photo(text) from public,anon;
grant execute on function public.admin_can_read_photo(text) to authenticated;

create policy admin_read_registered_meal_photos on storage.objects for select to authenticated
using(bucket_id='meal-photos' and public.admin_can_read_photo(name));

create function public.admin_meal_photos(p_meal uuid,p_offset integer default 0,p_limit integer default 12)
returns jsonb language plpgsql security definer set search_path='' as $$
declare participant uuid; result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_meal is null or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 24 then raise exception 'Invalid photo query'; end if;
  select participant_id into participant from public.meals where id=p_meal;
  if participant is null then raise exception 'Meal not found' using errcode='P0002'; end if;
  with photos as (
    select id,participant_id,meal_id,storage_path,created_at from public.meal_photos
    where meal_id=p_meal and participant_id=participant order by created_at,id limit p_limit offset p_offset
  ) select jsonb_build_object('total',(select count(*) from public.meal_photos where meal_id=p_meal and participant_id=participant),
    'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from photos p),'[]'::jsonb)) into result;
  insert into public.admin_access_log(actor_id,action,participant_id) values(auth.uid(),'meal_photos',participant);
  return result;
end;
$$;
revoke all on function public.admin_meal_photos(uuid,integer,integer) from public,anon;
grant execute on function public.admin_meal_photos(uuid,integer,integer) to authenticated;
commit;
