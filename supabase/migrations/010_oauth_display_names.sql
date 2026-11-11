-- Social sign-in (Google) sends the person's name as `full_name` / `name`, not our
-- `display_name`. Use those before falling back to the email's local part, and never
-- produce a name that violates profiles.display_name (2..50 characters): a 1-letter
-- email such as a@gmail.com would otherwise abort the sign-up inside this trigger.
-- Mirrors displayNameFromMetadata() in server/auth/supabase-auth-service.ts.

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
    split_part(coalesce(new.email, ''), '@', 1)
  )), 50);
  if char_length(candidate) < 2 then
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
