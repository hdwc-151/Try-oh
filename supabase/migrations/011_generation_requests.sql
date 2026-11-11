-- Keep retry receipts private. No image bytes, credentials or prompts are stored.
create table if not exists public.generation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check (length(request_key) between 8 and 128),
  fingerprint text not null,
  status integer check (status between 100 and 599),
  response_json jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, request_key)
);
create index if not exists generation_requests_expiry
  on public.generation_requests(expires_at);
alter table public.generation_requests enable row level security;
revoke all on public.generation_requests from anon, authenticated;
-- Only the trusted backend database role accesses these rows.
