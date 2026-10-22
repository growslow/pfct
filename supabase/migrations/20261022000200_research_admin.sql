begin;

-- Membership is provisioned by a database owner, never by sign-up metadata.
create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from public, anon, authenticated;
grant all on public.app_admins to service_role;

create table public.admin_access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('overview','participants','participant_detail')),
  participant_id uuid references public.participants(id),
  created_at timestamptz not null default now()
);
alter table public.admin_access_log enable row level security;
revoke all on public.admin_access_log from public, anon, authenticated;
grant all on public.admin_access_log to service_role;
grant usage, select on sequence public.admin_access_log_id_seq to service_role;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'participants',(select count(*) from public.participants),
    'meals',(select count(*) from public.meals),
    'guesses',(select count(*) from public.guesses),
    'confirmations',(select count(*) from public.food_confirmations)
  ) into result;
  insert into public.admin_access_log(actor_id,action) values(auth.uid(),'overview');
  return result;
end;
$$;

create function public.admin_participants(p_query text default '',p_filter text default 'all',p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_query is null or length(p_query)>100 or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100
    or p_filter is null or p_filter not in ('all','with_records','without_records') then raise exception 'Invalid list parameters'; end if;
  with filtered as (
    select p.* from public.participants p
    where p.id::text ilike '%'||p_query||'%'
    and (p_filter='all' or (p_filter='with_records' and exists(select 1 from public.meals m where m.participant_id=p.id))
      or (p_filter='without_records' and not exists(select 1 from public.meals m where m.participant_id=p.id)))
  ), page as (
    select * from filtered order by created_at desc,id limit p_limit offset p_offset
  ), rows as (
    select p.id,p.created_at,(p.auth_user_id is not null) as account_linked,
      (select count(*) from public.meals m where m.participant_id=p.id) as meal_count,
      (select count(*) from public.guesses g where g.participant_id=p.id) as guess_count,
      (select count(*) from public.food_confirmations f where f.participant_id=p.id) as confirmation_count,
      (select max(m.created_at) from public.meals m where m.participant_id=p.id) as latest_submission,
      (select c.action from public.consent_events c where c.participant_id=p.id order by c.created_at desc,c.id desc limit 1) as consent_action
    from page p
  ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from rows r),'[]'::jsonb)) into result;
  insert into public.admin_access_log(actor_id,action) values(auth.uid(),'participants');
  return result;
end;
$$;

create function public.admin_participant_detail(p_participant uuid,p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_participant is null or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid detail parameters'; end if;
  if not exists(select 1 from public.participants where id=p_participant) then raise exception 'Participant not found' using errcode='P0002'; end if;
  with meals as (
    select * from public.meals where participant_id=p_participant order by eaten_at desc,id limit p_limit offset p_offset
  ), rows as (
    select m.id,m.eaten_at,m.created_at,m.timezone,m.meal_type,
      (select count(*) from public.meal_photos p where p.meal_id=m.id and p.participant_id=p_participant) as photo_count,
      coalesce((select jsonb_agg(to_jsonb(g) - 'participant_id' order by g.created_at,g.id) from public.guesses g where g.meal_id=m.id and g.participant_id=p_participant),'[]'::jsonb) as guesses,
      coalesce((select jsonb_agg(to_jsonb(f) - 'participant_id' order by f.created_at,f.id) from public.food_confirmations f where f.meal_id=m.id and f.participant_id=p_participant),'[]'::jsonb) as confirmations,
      coalesce((select jsonb_agg(to_jsonb(n) - 'participant_id' order by n.created_at,n.id) from public.nutrition_estimates n where n.meal_id=m.id and n.participant_id=p_participant),'[]'::jsonb) as estimates,
      coalesce((select jsonb_agg(to_jsonb(f) - 'participant_id' order by f.created_at,f.id) from public.feedback f where f.meal_id=m.id and f.participant_id=p_participant),'[]'::jsonb) as feedback
    from meals m
  ) select jsonb_build_object(
    'participant',(select jsonb_build_object('id',p.id,'created_at',p.created_at,'account_linked',p.auth_user_id is not null) from public.participants p where p.id=p_participant),
    'profiles',coalesce((select jsonb_agg(to_jsonb(v) - 'participant_id' order by v.created_at desc,v.id) from public.profile_versions v where v.participant_id=p_participant),'[]'::jsonb),
    'consents',coalesce((select jsonb_agg(to_jsonb(c) - 'participant_id' order by c.created_at desc,c.id) from public.consent_events c where c.participant_id=p_participant),'[]'::jsonb),
    'meal_total',(select count(*) from public.meals where participant_id=p_participant),
    'meals',coalesce((select jsonb_agg(to_jsonb(r) order by r.eaten_at desc,r.id) from rows r),'[]'::jsonb)
  ) into result;
  insert into public.admin_access_log(actor_id,action,participant_id) values(auth.uid(),'participant_detail',p_participant);
  return result;
end;
$$;

revoke all on function public.admin_overview() from public,anon;
revoke all on function public.admin_participants(text,text,integer,integer) from public,anon;
revoke all on function public.admin_participant_detail(uuid,integer,integer) from public,anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_participants(text,text,integer,integer) to authenticated;
grant execute on function public.admin_participant_detail(uuid,integer,integer) to authenticated;
commit;
