-- Normalized social graph. Replaces the single-row public.social_state JSONB
-- document, whose global row lock serialized every social write across all users.
-- Run after 008. Safe to re-run: every backfill uses ON CONFLICT DO NOTHING.
-- public.social_state is kept untouched as a rollback source; drop it later.

-- Vietnamese-aware, accent-insensitive normalization used by social search.
create or replace function public.vn_unaccent(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(lower(translate(coalesce(value, ''),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydAAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD')),
    '\s+', ' ', 'g')
$$;

create table if not exists public.social_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,40}$'),
  avatar text not null default '',
  birth_date date,
  invite_code text not null,
  invite_policy text not null default 'known' check (invite_policy in ('everyone','known','code')),
  default_visibility text not null default 'private' check (default_visibility in ('private','friends')),
  created_at timestamptz not null default now()
);
create unique index if not exists social_profiles_username_key on public.social_profiles(username);
create unique index if not exists social_profiles_invite_code_key on public.social_profiles(invite_code);
create index if not exists social_profiles_avatar_idx on public.social_profiles(avatar) where avatar <> '';
create index if not exists social_profiles_username_search_idx on public.social_profiles(public.vn_unaccent(username) text_pattern_ops);
create index if not exists profiles_display_name_search_idx on public.profiles(public.vn_unaccent(display_name) text_pattern_ops);
create index if not exists profiles_creator_role_idx on public.profiles(role) where role in ('koc','admin');

-- One row per friendship, stored with user_a < user_b.
create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists friendships_user_b_idx on public.friendships(user_b);

create table if not exists public.friend_requests (
  id uuid primary key,
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create unique index if not exists friend_requests_pair_key on public.friend_requests(least(from_id, to_id), greatest(from_id, to_id));
create index if not exists friend_requests_to_idx on public.friend_requests(to_id);
create index if not exists friend_requests_from_idx on public.friend_requests(from_id);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

create table if not exists public.friend_groups (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists friend_groups_owner_idx on public.friend_groups(owner_id);

create table if not exists public.friend_group_members (
  group_id uuid not null references public.friend_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null default 0,
  primary key (group_id, user_id)
);
create index if not exists friend_group_members_user_idx on public.friend_group_members(user_id);

create table if not exists public.creator_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id)
);
create index if not exists creator_follows_creator_idx on public.creator_follows(creator_id);

create table if not exists public.social_posts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 500),
  image_urls text[] not null,
  visibility text not null check (visibility in ('private','friends','groups','public')),
  group_ids uuid[] not null default '{}',
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists social_posts_owner_created_idx on public.social_posts(owner_id, created_at desc);
create index if not exists social_posts_public_created_idx on public.social_posts(created_at desc) where visibility = 'public' and hidden_at is null;
create index if not exists social_posts_image_urls_idx on public.social_posts using gin(image_urls);

-- Visibility override for a saved outfit; absent row = owner's default visibility.
create table if not exists public.outfit_policies (
  outfit_id uuid primary key references public.saved_outfits(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  visibility text not null check (visibility in ('private','friends','groups')),
  group_ids uuid[] not null default '{}',
  official boolean not null default false
);
create index if not exists outfit_policies_owner_idx on public.outfit_policies(owner_id);

create table if not exists public.social_polls (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  -- Saved-outfit ids for outfit polls; empty for image polls (see social_poll_options).
  outfit_ids uuid[] not null default '{}',
  visibility text check (visibility in ('private','friends','groups','public')),
  group_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed boolean not null default false,
  winner_id uuid,
  notified boolean not null default false
);
create index if not exists social_polls_owner_created_idx on public.social_polls(owner_id, created_at desc);
create index if not exists social_polls_pending_result_idx on public.social_polls(expires_at) where not notified;

create table if not exists public.social_poll_options (
  id uuid primary key,
  poll_id uuid not null references public.social_polls(id) on delete cascade,
  image_url text not null,
  position integer not null
);
create index if not exists social_poll_options_poll_idx on public.social_poll_options(poll_id, position);
create index if not exists social_poll_options_image_idx on public.social_poll_options(image_url);

create table if not exists public.social_poll_recipients (
  poll_id uuid not null references public.social_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (poll_id, user_id)
);
create index if not exists social_poll_recipients_user_idx on public.social_poll_recipients(user_id);

create table if not exists public.social_poll_votes (
  poll_id uuid not null references public.social_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_id uuid not null,
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.social_notifications (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('request','poll','result')),
  target_id uuid not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists social_notifications_user_created_idx on public.social_notifications(user_id, created_at desc);
create index if not exists social_notifications_actor_kind_idx on public.social_notifications(actor_id, kind, created_at desc);

create table if not exists public.user_reports (
  id uuid primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 1000),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_reports_open_idx on public.user_reports(created_at desc) where status = 'open';
create index if not exists user_reports_target_idx on public.user_reports(target_id);

-- AI-extracted images shown before the user saves them; swept after expires_at.
create table if not exists public.temporary_images (
  image_key text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists temporary_images_owner_idx on public.temporary_images(owner_id);
create index if not exists temporary_images_expires_idx on public.temporary_images(expires_at);

-- Durable queue of R2 objects to delete (account deletion, expired temporary images).
create table if not exists public.storage_cleanup_queue (
  image_key text primary key,
  reason text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists storage_cleanup_queue_due_idx on public.storage_cleanup_queue(next_attempt_at);

-- Moderation actions recorded in the admin audit log.
alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_action_check
  check (action in ('user.role_changed', 'user.status_changed', 'user.credits_changed', 'user.plan_changed',
                    'user.posts_hidden', 'report.resolved', 'report.dismissed'));

-- Lookups by image key for the authenticated /uploads endpoint.
create index if not exists garments_front_original_key_idx on public.garments(front_original_key);
create index if not exists garments_front_processed_key_idx on public.garments(front_processed_key);
create index if not exists garments_back_original_key_idx on public.garments(back_original_key) where back_original_key is not null;
create index if not exists garments_back_processed_key_idx on public.garments(back_processed_key) where back_processed_key is not null;
create index if not exists person_images_image_key_idx on public.person_images(image_key);
create index if not exists try_on_images_image_key_idx on public.try_on_images(image_key) where image_key is not null;
create index if not exists saved_outfits_front_image_key_idx on public.saved_outfits(front_image_key) where front_image_key is not null;
create index if not exists saved_outfits_back_image_key_idx on public.saved_outfits(back_image_key) where back_image_key is not null;

do $$
declare
  t text;
begin
  foreach t in array array['social_profiles','friendships','friend_requests','user_blocks','friend_groups','friend_group_members','creator_follows','social_posts','outfit_policies','social_polls','social_poll_options','social_poll_recipients','social_poll_votes','social_notifications','user_reports','temporary_images','storage_cleanup_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- One-time backfill from the legacy JSONB document. Rows that reference users,
-- outfits or groups which no longer exist are skipped.
-- ---------------------------------------------------------------------------
do $$
declare
  doc jsonb;
begin
  select data into doc from public.social_state where id = 1;
  if doc is null then return; end if;

  insert into public.social_profiles(user_id, username, avatar, birth_date, invite_code, invite_policy, default_visibility)
  select p.id,
         x->>'username',
         coalesce(x->>'avatar', ''),
         nullif(x->>'birthDate', '')::date,
         x->>'inviteCode',
         coalesce(x->>'invitePolicy', 'known'),
         case when x->>'defaultVisibility' = 'friends' then 'friends' else 'private' end
  from jsonb_array_elements(coalesce(doc->'profiles', '[]')) x
  join public.profiles p on p.id::text = x->>'id'
  where x->>'username' ~ '^[a-z0-9_]{3,40}$' and coalesce(x->>'inviteCode', '') <> ''
  on conflict do nothing;

  insert into public.friendships(user_a, user_b)
  select distinct least(a.id, b.id), greatest(a.id, b.id)
  from jsonb_array_elements(coalesce(doc->'friends', '[]')) pair
  join public.profiles a on a.id::text = pair->>0
  join public.profiles b on b.id::text = pair->>1
  where a.id <> b.id
  on conflict do nothing;

  insert into public.friend_requests(id, from_id, to_id, created_at)
  select (x->>'id')::uuid, f.id, t.id, to_timestamp((x->>'createdAt')::double precision / 1000)
  from jsonb_array_elements(coalesce(doc->'requests', '[]')) x
  join public.profiles f on f.id::text = x->>'from'
  join public.profiles t on t.id::text = x->>'to'
  where f.id <> t.id
  on conflict do nothing;

  insert into public.user_blocks(blocker_id, blocked_id)
  select a.id, b.id
  from jsonb_array_elements(coalesce(doc->'blocks', '[]')) pair
  join public.profiles a on a.id::text = pair->>0
  join public.profiles b on b.id::text = pair->>1
  on conflict do nothing;

  insert into public.friend_groups(id, owner_id, name)
  select (x->>'id')::uuid, o.id, left(x->>'name', 60)
  from jsonb_array_elements(coalesce(doc->'groups', '[]')) x
  join public.profiles o on o.id::text = x->>'ownerId'
  where char_length(coalesce(x->>'name', '')) > 0
  on conflict do nothing;

  insert into public.friend_group_members(group_id, user_id, position)
  select g.id, m.id, (member.ordinality - 1)::int
  from jsonb_array_elements(coalesce(doc->'groups', '[]')) x
  join public.friend_groups g on g.id::text = x->>'id'
  cross join lateral jsonb_array_elements_text(coalesce(x->'members', '[]')) with ordinality as member(user_id, ordinality)
  join public.profiles m on m.id::text = member.user_id
  on conflict do nothing;

  insert into public.creator_follows(follower_id, creator_id)
  select a.id, b.id
  from jsonb_array_elements(coalesce(doc->'follows', '[]')) pair
  join public.profiles a on a.id::text = pair->>0
  join public.profiles b on b.id::text = pair->>1
  on conflict do nothing;

  insert into public.social_posts(id, owner_id, caption, image_urls, visibility, group_ids, created_at)
  select (x->>'id')::uuid, o.id, left(coalesce(x->>'caption', ''), 500),
         array(select jsonb_array_elements_text(coalesce(x->'imageUrls', '[]'))),
         x->>'visibility',
         array(select g::uuid from jsonb_array_elements_text(coalesce(x->'groupIds', '[]')) g),
         to_timestamp((x->>'createdAt')::double precision / 1000)
  from jsonb_array_elements(coalesce(doc->'posts', '[]')) x
  join public.profiles o on o.id::text = x->>'ownerId'
  where x->>'visibility' in ('private','friends','groups','public')
  on conflict do nothing;

  insert into public.outfit_policies(outfit_id, owner_id, visibility, group_ids, official)
  select o.id, o.user_id, x->>'visibility',
         array(select g::uuid from jsonb_array_elements_text(coalesce(x->'groupIds', '[]')) g),
         coalesce((x->>'official')::boolean, false)
  from jsonb_array_elements(coalesce(doc->'policies', '[]')) x
  join public.saved_outfits o on o.id::text = x->>'outfitId' and o.user_id::text = x->>'ownerId'
  where x->>'visibility' in ('private','friends','groups')
  on conflict do nothing;

  insert into public.social_polls(id, owner_id, title, outfit_ids, visibility, group_ids, created_at, expires_at, closed, winner_id, notified)
  select (x->>'id')::uuid, o.id, left(coalesce(x->>'title', ''), 120),
         case when jsonb_array_length(coalesce(x->'imageOptions', '[]')) > 0 then '{}'::uuid[]
              else array(select v::uuid from jsonb_array_elements_text(coalesce(x->'outfitIds', '[]')) v) end,
         x->>'visibility',
         array(select g::uuid from jsonb_array_elements_text(coalesce(x->'groupIds', '[]')) g),
         to_timestamp((x->>'createdAt')::double precision / 1000),
         to_timestamp((x->>'expiresAt')::double precision / 1000),
         coalesce((x->>'closed')::boolean, false),
         nullif(x->>'winnerId', '')::uuid,
         coalesce((x->>'notified')::boolean, false)
  from jsonb_array_elements(coalesce(doc->'polls', '[]')) x
  join public.profiles o on o.id::text = x->>'ownerId'
  on conflict do nothing;

  insert into public.social_poll_options(id, poll_id, image_url, position)
  select (opt.value->>'id')::uuid, p.id, opt.value->>'imageUrl', (opt.ordinality - 1)::int
  from jsonb_array_elements(coalesce(doc->'polls', '[]')) x
  join public.social_polls p on p.id::text = x->>'id'
  cross join lateral jsonb_array_elements(coalesce(x->'imageOptions', '[]')) with ordinality as opt(value, ordinality)
  on conflict do nothing;

  insert into public.social_poll_recipients(poll_id, user_id)
  select p.id, u.id
  from jsonb_array_elements(coalesce(doc->'polls', '[]')) x
  join public.social_polls p on p.id::text = x->>'id'
  cross join lateral jsonb_array_elements_text(coalesce(x->'recipients', '[]')) r(user_id)
  join public.profiles u on u.id::text = r.user_id
  on conflict do nothing;

  insert into public.social_poll_votes(poll_id, user_id, option_id)
  select p.id, u.id, v.value::uuid
  from jsonb_array_elements(coalesce(doc->'polls', '[]')) x
  join public.social_polls p on p.id::text = x->>'id'
  cross join lateral jsonb_each_text(coalesce(x->'votes', '{}')) v(user_id, value)
  join public.profiles u on u.id::text = v.user_id
  on conflict do nothing;

  insert into public.social_notifications(id, user_id, actor_id, kind, target_id, read, created_at)
  select (x->>'id')::uuid, u.id, a.id, x->>'kind', (x->>'targetId')::uuid,
         coalesce((x->>'read')::boolean, false), to_timestamp((x->>'createdAt')::double precision / 1000)
  from jsonb_array_elements(coalesce(doc->'notices', '[]')) x
  join public.profiles u on u.id::text = x->>'userId'
  join public.profiles a on a.id::text = x->>'actor'
  where x->>'kind' in ('request','poll','result')
  on conflict do nothing;

  insert into public.user_reports(id, reporter_id, target_id, reason, created_at)
  select (x->>'id')::uuid, r.id, t.id, left(x->>'reason', 1000), to_timestamp((x->>'createdAt')::double precision / 1000)
  from jsonb_array_elements(coalesce(doc->'reports', '[]')) x
  join public.profiles r on r.id::text = x->>'from'
  join public.profiles t on t.id::text = x->>'target'
  where char_length(coalesce(x->>'reason', '')) >= 5
  on conflict do nothing;

  insert into public.temporary_images(image_key, owner_id, created_at, expires_at)
  select x->>'key', o.id,
         coalesce(to_timestamp((x->>'createdAt')::double precision / 1000), now()),
         coalesce(to_timestamp((x->>'createdAt')::double precision / 1000), now()) + interval '24 hours'
  from jsonb_array_elements(coalesce(doc->'temporaryImages', '[]')) x
  join public.profiles o on o.id::text = x->>'ownerId'
  where coalesce(x->>'key', '') <> ''
  on conflict do nothing;
end $$;
