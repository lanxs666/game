create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null default '玩家' check (char_length(nickname) between 1 and 24),
  avatar text not null default '🟢',
  created_at timestamptz not null default now()
);

create table if not exists public.game_scores (
  id bigint generated always as identity primary key,
  game_slug text not null,
  user_id uuid not null constraint game_scores_user_id_fkey references public.profiles (user_id) on delete cascade,
  score integer not null check (score between 0 and 5720),
  created_at timestamptz not null default now()
);

create index if not exists game_scores_leaderboard_idx
  on public.game_scores (game_slug, score desc, created_at asc);
create index if not exists game_scores_player_idx
  on public.game_scores (game_slug, user_id, score desc, created_at asc);

alter table public.profiles enable row level security;
alter table public.game_scores enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "Players create their own profile" on public.profiles;
create policy "Players create their own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Players update their own profile" on public.profiles;
create policy "Players update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Scores are publicly readable" on public.game_scores;
create policy "Scores are publicly readable"
  on public.game_scores for select
  using (true);

drop policy if exists "Players submit their own scores" on public.game_scores;
create policy "Players submit their own scores"
  on public.game_scores for insert to authenticated
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.game_scores to anon, authenticated;
grant insert on public.game_scores to authenticated;

create or replace function public.create_player_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, nickname, avatar)
  values (
    new.id,
    coalesce(nullif(left(new.raw_user_meta_data ->> 'nickname', 24), ''), '玩家'),
    coalesce(nullif(new.raw_user_meta_data ->> 'avatar', ''), '🟢')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_player_profile();
