-- Cortex study app (/study) — Supabase setup
-- Safe to run more than once in the Supabase SQL editor.
-- One synced state blob per user: local-first, last-write-wins by data->>'updatedAt'.

create table if not exists public.cortex_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cortex_state enable row level security;
alter table public.cortex_state force row level security;

drop policy if exists "Users can select own cortex state" on public.cortex_state;
drop policy if exists "Users can insert own cortex state" on public.cortex_state;
drop policy if exists "Users can update own cortex state" on public.cortex_state;

create policy "Users can select own cortex state"
on public.cortex_state for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert own cortex state"
on public.cortex_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own cortex state"
on public.cortex_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
