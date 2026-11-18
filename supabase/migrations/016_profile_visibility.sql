-- Ai xem được trang cá nhân: mọi người / chỉ bạn bè (mặc định, giữ hành vi cũ) / chỉ mình tôi.
-- Hồ sơ KOL/KOC luôn công khai, không phụ thuộc cột này.
-- Chạy migration này TRƯỚC khi deploy code đọc cột profile_visibility.

alter table public.social_profiles
  add column if not exists profile_visibility text not null default 'friends';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_profiles_profile_visibility_check'
  ) then
    alter table public.social_profiles
      add constraint social_profiles_profile_visibility_check
      check (profile_visibility in ('everyone','friends','private'));
  end if;
end $$;

-- Danh sách người theo dõi tải phân trang theo thời gian theo dõi.
create index if not exists creator_follows_creator_created_idx
  on public.creator_follows(creator_id, created_at desc);
