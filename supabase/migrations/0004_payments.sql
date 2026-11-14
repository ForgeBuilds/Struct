-- Author: Lumorix Studios
-- Check the LICENSE in the GitHub repo (https://github.com/Lumorix-studios/Struct) for more information on permissions to use this code.
-- ═══════════════════════════════════════════════════════════════════════════
--!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- NOT USED INSIDE THE APP RN AND I REPEAT THI IS NOT USED AND IT WAS A TEST FUNCTION
--!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- Struct — Supabase schema 0004_payments
--
-- Subscription billing for the BYOK paywall:
--
--   free  →  pro   (pro unlocks profiles.byok_enabled = true)
--
-- Creates the `payment_orders` table that records every checkout attempt.
-- The client may CREATE its own order rows (RLS) but can NEVER change their
-- status — only the `billing` edge function (service role) marks an order
-- paid and promotes the buyer's profile to plan = 'pro' with
-- byok_enabled = true. This keeps 0002_harden_profiles intact: a signed-in
-- user still cannot upgrade itself, even with a stolen anon key.
--
-- Run in the Supabase dashboard → SQL Editor (or `supabase db push`).
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── payment_orders ──────────────────────────────────────────────────────────
-- One row per checkout attempt. `id` is a server-generated uuid string.
-- `provider` names the payment processor (null until a real provider such as
-- stripe / razorpay is wired into the `billing` edge function).
-- `provider_ref` is the provider's own payment/session id for reconciliation.
create table if not exists public.payment_orders (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null default 'pro',
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  provider text,
  provider_ref text,
  status text not null default 'pending',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_orders_status_check
    check (status in ('pending', 'paid', 'failed', 'cancelled')),
  constraint payment_orders_plan_check
    check (plan in ('pro', 'team', 'enterprise'))
);

create index if not exists payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

-- Keep updated_at honest (same helper as chats / user_settings).
drop trigger if exists payment_orders_touch_updated_at on public.payment_orders;
create trigger payment_orders_touch_updated_at
  before update on public.payment_orders
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.payment_orders enable row level security;

drop policy if exists "payment_orders_select_own" on public.payment_orders;
create policy "payment_orders_select_own" on public.payment_orders
  for select using (auth.uid() = user_id);

drop policy if exists "payment_orders_insert_own" on public.payment_orders;
create policy "payment_orders_insert_own" on public.payment_orders
  for insert with check (auth.uid() = user_id);

-- No UPDATE / DELETE policies on purpose: status transitions (pending → paid)
-- and plan promotion happen ONLY through the `billing` edge function using the
-- service role. A user editing their own row would be able to fake a payment,
-- so the client stays read/insert-only here.

-- ── Grants (PostgREST checks these before RLS) ──────────────────────────────
-- Column-restricted like profiles in 0002: the client inserts only descriptive
-- fields; id / status / provider_ref always come from the server defaults or
-- the edge function, so a crafted insert can never pre-mark itself as paid.
grant select, insert (user_id, plan, amount_cents, currency, metadata)
  on table public.payment_orders to authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect only select + insert on the four granted columns for authenticated:
--
--   select privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'payment_orders'
--     and grantee = 'authenticated'
--   order by privilege_type, column_name;
