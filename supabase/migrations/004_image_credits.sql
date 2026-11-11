-- Lifetime image-generation credits. Existing and new non-admin users start with 10.
-- Admin accounts are treated as unlimited by the application and do not consume this balance.

alter table public.profiles
  add column if not exists credit_balance integer not null default 10;

alter table public.profiles drop constraint if exists profiles_credit_balance_check;
alter table public.profiles add constraint profiles_credit_balance_check
  check (credit_balance between 0 and 1000000);

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check
  check (action in ('user.role_changed', 'user.status_changed', 'user.credits_changed'));
