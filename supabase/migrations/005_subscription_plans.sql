-- Subscription tier attached to each profile. Payment activation will update this field
-- through a trusted server/webhook; clients never receive direct write permission.
alter table public.profiles
  add column if not exists subscription_plan text not null default 'free';

alter table public.profiles drop constraint if exists profiles_subscription_plan_check;
alter table public.profiles add constraint profiles_subscription_plan_check
  check (subscription_plan in ('free', 'plus', 'pro', 'max'));

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check
  check (action in ('user.role_changed', 'user.status_changed', 'user.credits_changed', 'user.plan_changed'));
