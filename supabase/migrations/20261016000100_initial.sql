begin;

-- Account identity stays in auth.users. Study records use an independent UUID.
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Append-only snapshots: changing habits must not overwrite study history.
create table public.profile_versions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  locale text not null default 'zh-CN',
  timezone text not null default 'Asia/Shanghai',
  habits jsonb not null default '{}'::jsonb check (jsonb_typeof(habits) = 'object'),
  created_at timestamptz not null default now()
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  document_version text not null check (length(document_version) between 1 and 100),
  action text not null check (action in ('granted', 'withdrawn')),
  created_at timestamptz not null default now()
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  eaten_at timestamptz not null,
  timezone text not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  created_at timestamptz not null default now(),
  unique (id, participant_id)
);

create table public.meal_photos (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  meal_id uuid not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  foreign key (meal_id, participant_id) references public.meals(id, participant_id),
  check (storage_path like participant_id::text || '/' || meal_id::text || '/%')
);

create table public.guesses (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  meal_id uuid not null,
  protein_g numeric(10,2) not null check (protein_g between 0 and 10000),
  fat_g numeric(10,2) not null check (fat_g between 0 and 10000),
  carbs_g numeric(10,2) not null check (carbs_g between 0 and 10000),
  calories_kcal numeric(10,2) not null check (calories_kcal between 0 and 100000),
  created_at timestamptz not null default now(),
  foreign key (meal_id, participant_id) references public.meals(id, participant_id),
  unique (id, meal_id, participant_id)
);

-- Trusted server writes only. Each revision preserves its provenance.
create table public.nutrition_estimates (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  meal_id uuid not null,
  protein_g numeric(10,2) not null check (protein_g between 0 and 10000),
  fat_g numeric(10,2) not null check (fat_g between 0 and 10000),
  carbs_g numeric(10,2) not null check (carbs_g between 0 and 10000),
  calories_kcal numeric(10,2) not null check (calories_kcal between 0 and 100000),
  source text not null,
  method_version text not null,
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (meal_id, participant_id) references public.meals(id, participant_id),
  unique (id, meal_id, participant_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  meal_id uuid not null,
  guess_id uuid not null,
  estimate_id uuid not null,
  rule_version text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (guess_id, meal_id, participant_id) references public.guesses(id, meal_id, participant_id),
  foreign key (estimate_id, meal_id, participant_id) references public.nutrition_estimates(id, meal_id, participant_id)
);

create index meals_participant_time on public.meals(participant_id, eaten_at desc);
create index profiles_participant_time on public.profile_versions(participant_id, created_at desc, id);
create index consents_participant_time on public.consent_events(participant_id, created_at desc, id);
create index photos_meal on public.meal_photos(meal_id, participant_id);
create index guesses_meal_time on public.guesses(meal_id, participant_id, created_at desc);
create index estimates_meal_time on public.nutrition_estimates(meal_id, participant_id, created_at desc);
create index feedback_meal_time on public.feedback(meal_id, participant_id, created_at desc);

create function public.create_participant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.participants(auth_user_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.create_participant() from public;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_participant();

-- Also supports applying this migration to a project with existing accounts.
insert into public.participants(auth_user_id)
select id from auth.users on conflict (auth_user_id) do nothing;

alter table public.participants enable row level security;
revoke all on public.participants from anon, authenticated;
grant select on public.participants to authenticated;
create policy own_participant on public.participants for select to authenticated
using (auth_user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['profile_versions', 'consent_events', 'meals', 'meal_photos', 'guesses', 'nutrition_estimates', 'feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy own_rows on public.%I for select to authenticated using (participant_id in (select id from public.participants where auth_user_id = (select auth.uid())))', t);
  end loop;
  foreach t in array array['profile_versions', 'consent_events', 'meals', 'meal_photos', 'guesses'] loop
    -- Clients cannot supply created_at: the database owns submission timestamps.
    execute format('create policy append_own_rows on public.%I for insert to authenticated with check (participant_id in (select id from public.participants where auth_user_id = (select auth.uid())))', t);
  end loop;
end;
$$;

grant insert (id, participant_id, locale, timezone, habits) on public.profile_versions to authenticated;
grant insert (id, participant_id, document_version, action) on public.consent_events to authenticated;
grant insert (id, participant_id, eaten_at, timezone, meal_type) on public.meals to authenticated;
grant insert (id, participant_id, meal_id, storage_path) on public.meal_photos to authenticated;
grant insert (id, participant_id, meal_id, protein_g, fat_g, carbs_g, calories_kcal) on public.guesses to authenticated;

grant all on public.participants, public.profile_versions, public.consent_events,
  public.meals, public.meal_photos, public.guesses, public.nutrition_estimates, public.feedback to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

create policy read_own_meal_photos on storage.objects for select to authenticated
using (bucket_id = 'meal-photos' and exists (
  select 1 from public.participants p
  where p.auth_user_id = (select auth.uid()) and p.id::text = (storage.foldername(name))[1]
));
create policy upload_own_meal_photos on storage.objects for insert to authenticated
with check (bucket_id = 'meal-photos' and exists (
  select 1 from public.meals m join public.participants p on p.id = m.participant_id
  where p.auth_user_id = (select auth.uid())
    and p.id::text = (storage.foldername(name))[1]
    and m.id::text = (storage.foldername(name))[2]
));

commit;
