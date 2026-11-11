-- Keep legally relevant payment records after account deletion while removing PII.

alter table public.payment_orders
  drop constraint if exists payment_orders_user_id_fkey;

alter table public.payment_orders
  alter column user_id drop not null;

alter table public.payment_orders
  add constraint payment_orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function public.anonymize_payment_orders_before_profile_delete()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.payment_orders
  set customer_email = '',
      customer_name = 'Deleted user',
      checkout_url = null,
      status = case when status = 'pending' then 'cancelled' else status end,
      updated_at = now()
  where user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_payments_before_profile_delete on public.profiles;
create trigger anonymize_payments_before_profile_delete
  before delete on public.profiles
  for each row execute procedure public.anonymize_payment_orders_before_profile_delete();

