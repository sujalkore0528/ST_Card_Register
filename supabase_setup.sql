-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste this → Run)

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text not null,
  card_number text not null unique,
  village text not null,
  category text not null check (category in ('female', 'student', 'handicapped', 'senior', 'amrut')),
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table customers enable row level security;

-- Allow the app (using the public "anon" key) to read and write records.
-- This is fine for a single-shop internal tool with no login system.
-- If you later want a login/password before anyone can view or edit data,
-- let Claude know and this can be tightened.
create policy "Allow all access" on customers
  for all
  using (true)
  with check (true);

-- Enable realtime updates so edits made on one device show up on others
alter publication supabase_realtime add table customers;
