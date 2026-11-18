-- One-time state for the Google sign-in round trip (PKCE verifier, return path) and the
-- mobile hand-off code. Kept in PostgreSQL so the callback can reach any instance when
-- the web service runs more than one. Rows live for minutes; only key hashes are stored.

create table if not exists public.oauth_states (
  key_hash text primary key,
  kind text not null check (kind in ('pending','session')),
  payload jsonb not null,
  expires_at timestamptz not null
);

create index if not exists oauth_states_expires_idx on public.oauth_states(expires_at);

alter table public.oauth_states enable row level security;
revoke all on table public.oauth_states from anon, authenticated;
