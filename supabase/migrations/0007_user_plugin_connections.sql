-- Per-account plugin credentials/configuration. Payloads are AES-GCM encrypted
-- by the plugin-data Edge Function; clients have no direct table access.
create table if not exists public.user_plugin_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin text not null,
  encrypted text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, plugin)
);

alter table public.user_plugin_connections enable row level security;
revoke all on public.user_plugin_connections from anon, authenticated;
