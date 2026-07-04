-- MinMax Tracker complete Supabase setup
-- Safe to run more than once in the Supabase SQL editor.

create table if not exists public.tracker_sessions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  week int not null check (week between 1 and 12),
  day text not null check (day in ('Full Body', 'Upper', 'Lower', 'Arms + Delts')),
  bw numeric,
  notes text,
  exercises jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.tracker_sessions
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.tracker_sessions
  add column if not exists deleted_at timestamptz;

alter table public.tracker_sessions
  add column if not exists updated_at timestamptz not null default now();

create index if not exists tracker_sessions_user_date_idx
  on public.tracker_sessions (user_id, date desc);

create index if not exists tracker_sessions_user_updated_idx
  on public.tracker_sessions (user_id, updated_at desc);

create index if not exists tracker_sessions_user_active_idx
  on public.tracker_sessions (user_id, updated_at desc)
  where deleted_at is null;

create or replace function public.set_tracker_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at is null then
    new.updated_at = now();
  end if;
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists tracker_sessions_set_updated_at on public.tracker_sessions;
create trigger tracker_sessions_set_updated_at
before update on public.tracker_sessions
for each row execute function public.set_tracker_sessions_updated_at();

alter table public.tracker_sessions enable row level security;
alter table public.tracker_sessions force row level security;

drop policy if exists "Users can select own tracker sessions" on public.tracker_sessions;
drop policy if exists "Users can insert own tracker sessions" on public.tracker_sessions;
drop policy if exists "Users can update own tracker sessions" on public.tracker_sessions;
drop policy if exists "Users can delete own tracker sessions" on public.tracker_sessions;

create policy "Users can select own tracker sessions"
on public.tracker_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert own tracker sessions"
on public.tracker_sessions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own tracker sessions"
on public.tracker_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Hard deletes are intentionally not granted through RLS.
-- The app deletes by setting deleted_at through the update policy above.
