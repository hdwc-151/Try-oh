-- Live camera try-on (Decart Lucy VTON realtime). Each row is one paid preview
-- session; the per-plan quota counts rows created in a rolling window, so no
-- balance column or billing change is needed. Rows are kept for cost auditing.

create table if not exists public.live_preview_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('free','plus','pro','max','admin')),
  source text not null check (source in ('wardrobe','upload')),
  -- No foreign key: deleting a garment must not erase the usage history.
  garment_id uuid,
  category text not null check (category in ('tops','outerwear','bottoms','shoes','accessories')),
  -- Decart tier picked by the user; fast costs twice as much per second.
  speed text not null default 'standard' check (speed in ('standard','fast')),
  -- Quota sessions this row uses (a fast session can be priced above 1).
  cost smallint not null default 1 check (cost between 1 and 10),
  seconds smallint not null check (seconds between 1 and 120),
  -- Decart client tokens minted for this session (first connect + reconnects).
  tokens_issued smallint not null default 0 check (tokens_issued between 0 and 10),
  created_at timestamptz not null default now()
);

-- Re-runnable on a database that applied an earlier draft of this migration.
alter table public.live_preview_sessions add column if not exists speed text not null default 'standard';
alter table public.live_preview_sessions add column if not exists cost smallint not null default 1;

create index if not exists live_preview_sessions_user_created_idx
  on public.live_preview_sessions(user_id, created_at desc);

alter table public.live_preview_sessions enable row level security;
revoke all on table public.live_preview_sessions from anon, authenticated;
