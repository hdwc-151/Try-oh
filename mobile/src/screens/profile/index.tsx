import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AvatarViewer } from '@/components/avatar-viewer';
import { AppIcon } from '@/components/icon';
import { ProfileFeed } from '@/components/profile-feed';
import { GridEmpty, ImageGrid, PersonName, ProfileAvatar, ProfileStat, UnderlineTabs } from '@/components/profile-ui';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource, webBaseUrl } from '@/services/api-client';
import { imageUploadFile } from '@/services/image-upload';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { PageResponse, PlanSnapshot, SavedOutfit, SocialSnapshot } from '@/types/api';

const AVATAR_SIZE = 86;
const PAGE_SIZE = 60;

type AvatarSource = 'library' | 'camera';
type ProfileTab = 'posts' | 'outfits';

const profileTabs = [
  { value: 'posts', label: 'Bài đăng' },
  { value: 'outfits', label: 'Outfits' },
] as const satisfies readonly { value: ProfileTab; label: string }[];

/**
 * Trang cá nhân là nơi trưng bày: "Bài đăng" (bình chọn, ảnh đã đăng) và "Outfits" (chỉ outfit đã chia sẻ).
 * Tủ đồ và toàn bộ outfit được quản lý ở Trang chủ và tab Outfit; sửa hồ sơ nằm trong Cài đặt (nút bánh răng).
 */
export function ProfileScreen() {
  const auth = useAuth();
  const brand = useBrandColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiRequest<PlanSnapshot>('/api/plans') });
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const outfits = useInfiniteQuery({
    queryKey: ['saved-outfits', 'profile'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiRequest<PageResponse<SavedOutfit>>(`/api/generations/outfits?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (page) => page.nextOffset,
  });
  const outfitItems = useMemo(() => outfits.data?.pages.flatMap((page) => page.items) ?? [], [outfits.data?.pages]);

  const uploadAvatar = useMutation({
    mutationFn: async (source: AvatarSource) => {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(source === 'camera'
          ? 'Cần quyền dùng camera để chụp ảnh đại diện. Hãy bật trong Cài đặt của máy.'
          : 'Cần quyền truy cập thư viện ảnh để đổi ảnh đại diện.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 };
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled) return null;
      const form = new FormData();
      form.append('avatar', imageUploadFile(picked.assets[0], 'avatar.jpg'));
      return apiRequest<SocialSnapshot>('/api/social/avatar', { method: 'POST', body: form });
    },
    onSuccess: (snapshot) => {
      if (snapshot) queryClient.setQueryData(['social'], snapshot);
    },
  });
  const deleteAvatar = useMutation({
    mutationFn: () => apiRequest<SocialSnapshot>('/api/social/avatar', { method: 'DELETE' }),
    onSuccess: (snapshot) => queryClient.setQueryData(['social'], snapshot),
  });

  const loadError = plans.error ?? social.error;
  if (loadError) return <ScreenError message={loadError instanceof Error ? loadError.message : 'Không thể tải hồ sơ.'} onRetry={() => { void plans.refetch(); void social.refetch(); }}/>;
  if (plans.data === undefined || social.data === undefined) return <ScreenLoading variant="cards" label="Đang tải hồ sơ…"/>;

  const me = social.data.me;
  const isCreator = Boolean(me.creator);
  const emailName = auth.user?.email?.split('@')[0];
  const name = me.name || String(auth.user?.user_metadata.display_name ?? emailName ?? 'Người dùng');
  const avatarSource = me.avatar ? protectedImageSource(me.avatar, auth.session?.access_token) : undefined;
  const profileLink = me.inviteCode ? webBaseUrl + '/ban-be?invite=' + encodeURIComponent(me.inviteCode) : null;
  const busy = uploadAvatar.isPending || deleteAvatar.isPending;
  const avatarError = uploadAvatar.error ?? deleteAvatar.error;
  const following = social.data.following ?? [];
  const plan = plans.data.current;
  // Outfit chỉ lên trang cá nhân khi đã chia sẻ (bạn bè / nhóm); outfit riêng tư vẫn ở tab Outfit.
  const policies = social.data.policies ?? [];
  const sharedOutfits = outfitItems.filter((item) => (policies.find((policy) => policy.outfitId === item.id)?.visibility ?? me.defaultVisibility) !== 'private');
  const myPolls = social.data.polls.filter((poll) => poll.owner.id === me.id);
  const myPosts = [...(social.data.creatorFeed ?? []), ...(social.data.posts ?? [])].filter((post, index, list) => post.owner.id === me.id && list.findIndex((item) => item.id === post.id) === index);
  const postCount = myPolls.length + myPosts.filter((post) => post.imageUrls.length > 0).length;

  const refreshing = social.isRefetching || outfits.isRefetching;
  const refresh = () => { void social.refetch(); void outfits.refetch(); void plans.refetch(); };
  const loadMoreOnScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (tab !== 'outfits') return;
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y < contentSize.height - 600) return;
    if (outfits.hasNextPage && !outfits.isFetchingNextPage) void outfits.fetchNextPage();
  };
  const openTryOn = () => router.push({ pathname: '/home', params: { segment: 'try-on', t: String(Date.now()) } });

  return <ScrollView
    contentInsetAdjustmentBehavior="automatic"
    style={{ backgroundColor: colors.background }}
    contentContainerStyle={{ paddingBottom: spacing.xxl }}
    scrollEventThrottle={200}
    onScroll={loadMoreOnScroll}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
    <Animated.View entering={FadeIn.duration(220)} style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <PressableScale
          accessibilityRole="imagebutton"
          accessibilityLabel="Ảnh đại diện"
          accessibilityHint="Mở để xem, đổi ảnh đại diện hoặc lấy mã QR"
          scaleTo={0.92}
          onPress={() => setViewerOpen(true)}>
          <ProfileAvatar path={me.avatar} size={AVATAR_SIZE}/>
          <View pointerEvents="none" style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.primary, borderWidth: 2, borderColor: colors.background }}>
            <AppIcon name="edit" size={12} color={colors.onBrand}/>
          </View>
        </PressableScale>
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
          <ProfileStat value={postCount} label="Bài đăng" onPress={() => setTab('posts')}/>
          {isCreator
            ? <ProfileStat value={social.data.followerCount ?? 0} label="Followers" onPress={() => router.push({ pathname: '/follows', params: { tab: 'followers' } })}/>
            : <ProfileStat value={social.data.friends.length} label="Bạn bè" onPress={() => router.push('/friends')}/>}
          <ProfileStat value={following.length} label="Following" onPress={() => router.push({ pathname: '/follows', params: { tab: 'following' } })}/>
        </View>
      </View>

      <View style={{ gap: 2 }}>
        <PersonName person={{ name, creator: isCreator }}/>
        <AppText variant="subhead" numberOfLines={1}>@{me.username}</AppText>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {isCreator && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.full, backgroundColor: brand.secondary }}>
          <AppIcon name="verified" size={13} color={brand.accent}/>
          <AppText variant="caption" style={{ color: brand.accent, fontWeight: '700' }}>KOL/KOC</AppText>
        </View>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Gói ${plan.planName}. Xem các gói đăng ký`}
          onPress={() => router.push('/plans')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.full, backgroundColor: colors.groupedBackground }}>
          <AppIcon name="sparkles" size={12} color={colors.label}/>
          <AppText variant="caption" style={{ color: colors.label, fontWeight: '700' }}>Gói {plan.planName}</AppText>
          <AppIcon name="chevronRight" size={11} color={colors.secondaryLabel}/>
        </Pressable>
      </View>

    </Animated.View>

    <View style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
      <UnderlineTabs options={profileTabs} value={tab} onChange={setTab}/>
    </View>

    {tab === 'posts'
      ? <ProfileFeed
          polls={myPolls}
          posts={myPosts}
          viewerId={me.id}
          emptyText="Bình chọn bạn tạo sẽ hiện ở đây. Tạo bình chọn từ tab Outfit."/>
      : outfits.error
        ? <View style={{ padding: spacing.md, gap: spacing.sm }}>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>{outfits.error instanceof Error ? outfits.error.message : 'Không thể tải outfit.'}</AppText>
            <AppButton title="Thử lại" variant="secondary" onPress={() => void outfits.refetch()}/>
          </View>
        : outfits.data === undefined
          ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={brand.primary as string}/>
          : sharedOutfits.length
            ? <View style={{ gap: spacing.sm }}>
                <ImageGrid fit="cover" aspectRatio={3 / 4} items={sharedOutfits.map((item) => ({ key: item.id, path: item.frontImageUrl, title: 'Outfit' }))}/>
                <Pressable accessibilityRole="button" onPress={() => router.push('/favorites')} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <AppText variant="caption" style={{ textAlign: 'center' }}>Chỉ hiện outfit đã chia sẻ. <AppText variant="caption" style={{ color: brand.accent, fontWeight: '700' }}>Quản lý quyền xem</AppText></AppText>
                </Pressable>
              </View>
            : <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
                <GridEmpty
                  icon="sparkles"
                  title={outfitItems.length ? 'Chưa chia sẻ outfit nào' : 'Chưa có outfit nào'}
                  text={outfitItems.length
                    ? 'Outfit của bạn đang ở chế độ riêng tư. Mở một outfit trong tab Outfit để chia sẻ với bạn bè.'
                    : 'Outfit bạn tạo bằng Thử đồ AI và chia sẻ sẽ được trưng bày ở đây.'}/>
                {outfitItems.length
                  ? <AppButton title="Mở tab Outfit" variant="secondary" onPress={() => router.push('/favorites')}/>
                  : <AppButton title="Tạo outfit đầu tiên" icon="sparkles" onPress={openTryOn}/>}
              </View>}
    {tab === 'outfits' && outfits.isFetchingNextPage && <ActivityIndicator style={{ marginVertical: spacing.md }} color={brand.primary as string}/>}

    <AvatarViewer
      visible={viewerOpen}
      avatar={avatarSource}
      name={name}
      username={me.username}
      profileLink={profileLink}
      busy={busy}
      error={avatarError ? (avatarError instanceof Error ? avatarError.message : 'Không thể cập nhật ảnh đại diện.') : null}
      onClose={() => { setViewerOpen(false); uploadAvatar.reset(); deleteAvatar.reset(); }}
      onPickLibrary={() => { deleteAvatar.reset(); uploadAvatar.mutate('library'); }}
      onTakePhoto={() => { deleteAvatar.reset(); uploadAvatar.mutate('camera'); }}
      onDelete={() => Alert.alert('Xóa ảnh đại diện?', 'Trang cá nhân sẽ dùng ảnh mặc định của Try-oh.', [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xóa', style: 'destructive', onPress: () => { uploadAvatar.reset(); deleteAvatar.mutate(); } },
      ])}
    />
  </ScrollView>;
}
