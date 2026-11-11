-- Trusted backend billing state for payOS/VietQR and MoMo.
alter table public.profiles
  add column if not exists subscription_expires_at timestamptz;

create table if not exists public.payment_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_email text not null,
  customer_name text not null,
  plan_id text not null check (plan_id in ('plus', 'pro', 'max')),
  provider text not null check (provider in ('payos', 'momo')),
  provider_order_id text not null,
  provider_transaction_id text,
  amount_vnd integer not null check (amount_vnd > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  access_expires_at timestamptz,
  unique (provider, provider_order_id)
);

alter table public.payment_orders
  add column if not exists customer_email text not null default '',
  add column if not exists customer_name text not null default '';

create unique index if not exists payment_orders_provider_transaction_unique
  on public.payment_orders(provider, provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists payment_orders_user_created_idx
  on public.payment_orders(user_id, created_at desc);

alter table public.payment_orders enable row level security;

drop policy if exists payment_orders_select_own on public.payment_orders;
create policy payment_orders_select_own
  on public.payment_orders for select
  using (auth.uid() = user_id);

-- Inserts and updates intentionally have no client policy. Only the trusted
-- server connection and verified payment webhooks may mutate billing state.
