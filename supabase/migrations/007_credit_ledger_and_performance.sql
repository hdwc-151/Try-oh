-- Auditable credit changes and indexes used by hot authentication/plan paths.

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after between 0 and 1000000),
  event_type text not null check (event_type in ('generation_reserved','generation_refunded','subscription_granted','subscription_expired','admin_adjustment')),
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  -- Admin who made a manual adjustment; null for system events.
  actor_id uuid,
  created_at timestamptz not null default now()
);

-- Keep the migration re-runnable on databases that created an earlier draft of the table.
alter table public.credit_ledger add column if not exists actor_id uuid;
alter table public.credit_ledger drop constraint if exists credit_ledger_event_type_check;
alter table public.credit_ledger add constraint credit_ledger_event_type_check
  check (event_type in ('generation_reserved','generation_refunded','subscription_granted','subscription_expired','admin_adjustment'));

create unique index if not exists credit_ledger_payment_grant_unique
  on public.credit_ledger(payment_order_id)
  where event_type = 'subscription_granted' and payment_order_id is not null;

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger(user_id, created_at desc);

create index if not exists profiles_subscription_expiry_idx
  on public.profiles(subscription_expires_at)
  where subscription_expires_at is not null;

alter table public.credit_ledger enable row level security;
revoke all on table public.credit_ledger from anon, authenticated;

