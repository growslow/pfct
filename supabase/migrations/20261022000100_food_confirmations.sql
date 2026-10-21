begin;

-- PostgREST nested meal reads require a direct relationship to feedback.
alter table public.feedback add constraint feedback_meal_fk
foreign key (meal_id, participant_id) references public.meals(id, participant_id);

-- Persist user selections and the storable provider IDs, NOT provider responses.
create table public.food_confirmations (
  id uuid primary key,
  participant_id uuid not null references public.participants(id),
  meal_id uuid not null,
  guess_id uuid not null,
  source text not null default 'fatsecret' check (source = 'fatsecret'),
  method_version text not null default 'manual-portions-v1',
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 30),
  created_at timestamptz not null default now(),
  foreign key (guess_id, meal_id, participant_id) references public.guesses(id, meal_id, participant_id),
  foreign key (meal_id, participant_id) references public.meals(id, participant_id)
);
create index confirmations_meal_time on public.food_confirmations(meal_id, participant_id, created_at desc);
alter table public.food_confirmations enable row level security;
revoke all on public.food_confirmations from anon, authenticated;
grant select on public.food_confirmations to authenticated;
grant all on public.food_confirmations to service_role;
create policy own_confirmations on public.food_confirmations for select to authenticated
using (participant_id in (select id from public.participants where auth_user_id = (select auth.uid())));

create function public.save_food_confirmation(p_id uuid, p_actor uuid, p_meal uuid, p_guess uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare participant uuid; item jsonb; existing public.food_confirmations;
begin
  select g.participant_id into participant from public.guesses g
  join public.participants p on p.id = g.participant_id
  where g.id = p_guess and g.meal_id = p_meal and p.auth_user_id = p_actor;
  if participant is null then raise exception 'Meal or guess not owned by actor' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items must be an array'; end if;
  if jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Invalid item count'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object'
      or not (item ?& array['food_id','serving_id','quantity','measure'])
      or (item - array['food_id','serving_id','quantity','measure']) <> '{}'::jsonb
      or coalesce(item->>'food_id','') !~ '^[0-9]{1,20}$'
      or coalesce(item->>'serving_id','') !~ '^[0-9]{1,20}$'
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or coalesce(item->>'measure','') not in ('servings','g','ml') then
      raise exception 'Invalid item or non-storable provider fields';
    end if;
    if (item->>'quantity')::numeric <= 0 or (item->>'quantity')::numeric > 10000 then raise exception 'Invalid quantity'; end if;
  end loop;
  insert into public.food_confirmations(id,participant_id,meal_id,guess_id,items)
  values(p_id,participant,p_meal,p_guess,p_items) on conflict(id) do nothing;
  select * into existing from public.food_confirmations where id = p_id;
  if existing.participant_id <> participant or existing.meal_id <> p_meal or existing.guess_id <> p_guess or existing.items <> p_items then
    raise exception 'Idempotency key reused with different data';
  end if;
  return p_id;
end;
$$;
revoke all on function public.save_food_confirmation(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_food_confirmation(uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
