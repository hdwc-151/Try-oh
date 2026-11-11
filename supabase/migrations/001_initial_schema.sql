-- Run once in Supabase SQL Editor. Application tables are private by default;
-- the Express backend connects through DATABASE_URL and performs authorization.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 2 and 50),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, created_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    new.created_at
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_auth_user();

create table if not exists public.garments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  category text not null check (category in ('tops','outerwear','bottoms','shoes','accessories')),
  front_original_key text not null,
  front_processed_key text not null,
  back_original_key text,
  back_processed_key text,
  created_at timestamptz not null default now()
);
create index if not exists idx_garments_user_created on public.garments(user_id, created_at desc);

create table if not exists public.person_images (
  user_id uuid primary key references auth.users(id) on delete cascade,
  image_key text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  warnings text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.try_on_images (
  user_id uuid not null references auth.users(id) on delete cascade,
  angle text not null check (angle in ('front','back')),
  image_url text not null,
  image_key text,
  created_at timestamptz not null default now(),
  primary key (user_id, angle)
);

create table if not exists public.saved_outfits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  front_image_url text not null,
  front_image_key text,
  back_image_url text,
  back_image_key text,
  garment_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_saved_outfits_user_created on public.saved_outfits(user_id, created_at desc);

-- MVP social module. Mutations lock this single row, so concurrent Render requests
-- cannot overwrite each other. Split into normalized tables before horizontal scaling.
create table if not exists public.social_state (
  id smallint primary key check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.social_state (id, data)
values (1, '{"profiles":[],"friends":[],"requests":[],"groups":[],"polls":[],"blocks":[],"reports":[],"notices":[],"policies":[],"temporaryImages":[]}'::jsonb)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.garments enable row level security;
alter table public.person_images enable row level security;
alter table public.try_on_images enable row level security;
alter table public.saved_outfits enable row level security;
alter table public.social_state enable row level security;

-- Backfill profiles if Auth already contains users.
insert into public.profiles (id, email, display_name, created_at)
select id, coalesce(email, ''),
  coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(email, 'user'), '@', 1)),
  created_at
from auth.users
on conflict (id) do nothing;
