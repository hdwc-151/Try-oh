-- Compatibility for existing external-provider accounts.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  candidate text;
begin
  candidate := left(btrim(coalesce(
    case when char_length(btrim(new.raw_user_meta_data ->> 'display_name')) >= 2 then new.raw_user_meta_data ->> 'display_name' end,
    case when char_length(btrim(new.raw_user_meta_data ->> 'full_name')) >= 2 then new.raw_user_meta_data ->> 'full_name' end,
    case when char_length(btrim(new.raw_user_meta_data ->> 'name')) >= 2 then new.raw_user_meta_data ->> 'name' end,
    -- Chỉ tài khoản có email thật mới lấy tên từ email.
    case when new.raw_app_meta_data ->> 'external_provider' is null then split_part(coalesce(new.email, ''), '@', 1) end
  )), 50);
  if coalesce(char_length(candidate), 0) < 2 then
    candidate := 'Người dùng';
  end if;

  insert into public.profiles (id, email, display_name, created_at)
  values (new.id, coalesce(new.email, ''), candidate, new.created_at)
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
