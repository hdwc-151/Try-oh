-- Shared fixed-window counters for sensitive and expensive API operations.
-- The backend writes through DATABASE_URL; browser roles receive no table access.

create table if not exists public.api_rate_limits (
  bucket_key text primary key,
  request_count integer not null check (request_count >= 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_api_rate_limits_expires_at
  on public.api_rate_limits(expires_at);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

