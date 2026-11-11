-- Application-level roles and immutable admin audit history.
-- Run after 001_initial_schema.sql.

alter table public.profiles
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'active',
  add column if not exists last_seen_at timestamptz;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user','koc','moderator','admin'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active','suspended'));

create index if not exists idx_profiles_role_status
  on public.profiles(role,status);

create table if not exists public.admin_audit_logs (
  id uuid primary key,
  actor_id uuid not null,
  actor_email text not null,
  action text not null check (action in ('user.role_changed','user.status_changed')),
  target_id uuid not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_created
  on public.admin_audit_logs(created_at desc);

alter table public.admin_audit_logs enable row level security;

