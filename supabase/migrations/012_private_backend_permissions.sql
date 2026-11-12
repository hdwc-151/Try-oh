-- Internal trigger functions must not be callable as Data API RPCs.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.anonymize_payment_orders_before_profile_delete() from public, anon, authenticated;

-- Evaluate the stable identity once per query rather than once per row.
alter policy payment_orders_select_own on public.payment_orders
  to authenticated using ((select auth.uid()) = user_id);

-- Cover the remaining foreign keys used during account deletion.
create index if not exists social_poll_votes_user_idx on public.social_poll_votes(user_id);
create index if not exists user_reports_reporter_idx on public.user_reports(reporter_id);
create index if not exists user_reports_resolved_by_idx on public.user_reports(resolved_by);
