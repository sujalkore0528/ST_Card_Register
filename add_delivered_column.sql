-- Run this ONLY if you already created the customers table before the
-- "delivered" feature was added. It safely adds the missing column
-- without touching your existing data.
--
-- In Supabase: SQL Editor → New query → paste this → Run.

alter table customers
  add column if not exists delivered boolean not null default false;
