import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { ProfileFeed } from '@/components/profile-feed';
import { Notice } from '@/components/notice';
import { GridEmpty, ImageGrid, PersonName, PillButton, ProfileAvatar, ProfileStat, UnderlineTabs } from '@/components/profile-ui';
import { ScreenError } from '@/components/screen-state';
import { useFollowAction } from '@/hooks/use-follow-action';
import { apiRequest } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialProfileView, SocialSnapshot } from '@/types/api';

type Tab = 'posts' | 'outfits';
const tabs = [
  { value: 'posts', label: 'Bài đăng' },
  { value: 'outfits', label: 'Outfits' },
] as const satisfies readonly { value: Tab; label: string }[];

/**
 * Hồ sơ người khác. KOL/KOC luôn công khai; người dùng thường theo cài đặt "Ai được xem trang cá nhân".
 * Khi bị giới hạn, máy chủ chỉ trả tên và ảnh đại diện (`locked`), màn hiện thông báo và nút kết bạn.
 * `invite` (từ mã QR) được gửi kèm lời mời kết bạn để vượt qua giới hạn "chỉ nhận lời mời có mã".
 */
export default function UserProfileRoute() {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { id: rawId, invite } = useLocalSearchParams<{ id: string; invite?: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const inviteCode = typeof invite === 'string' && invite ? invite : undefined;
  const [tab, setTab] = useState<Tab>('posts');
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const profile = useQuery({
    queryKey: ['social-profile', id],
    queryFn: () => apiRequest<SocialProfileView>('/api/social/profile/' + encodeURIComponent(id)),
    enabled: id.length > 0,
  });
  const follow = useFollowAction();
  const friendAction = useMutation({
    mutationFn: ({ action, body }: { action: 'request' | 'request-response'; body: Record<string, unknown> }) => apiRequest<SocialSnapshot>('/api/social/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(['social'], snapshot);
      void queryClient.invalidateQueries({ queryKey: ['social-profile', id] });
    },
  });

  if (profile.error) return <>
    <Stack.Screen options={{ title: 'Hồ sơ' }}/>
    <ScreenError message={profile.error instanceof Error ? profile.error.message : 'Không thể tải hồ sơ.'} onRetry={() => void profile.refetch()}/>
  </>;
  if (!profile.data) return <>
    <Stack.Screen options={{ title: 'Hồ sơ' }}/>
    <ActivityIndicator style={{ flex: 1, backgroundColor: colors.background }} color={brand.primary as string}/>
  </>;

  const view = profile.data;
  const person = view.person;
  const isMe = social.data?.me.id === person.id;
  // Ưu tiên trạng thái mới nhất từ snapshot (vừa bấm Theo dõi ở màn khác), rồi mới tới dữ liệu hồ sơ.
  const following = social.data?.followingIds ? social.data.followingIds.includes(person.id) : Boolean(view.following);
  const followerCount = Math.max(0, (view.followerCount ?? 0) + (following === Boolean(view.following) ? 0 : following ? 1 : -1));
  const posts = view.posts ?? [];
  const polls = view.polls ?? [];
  const postCount = polls.length + posts.filter((post) => post.imageUrls.length > 0).length;
  const friend = Boolean(view.friend) || Boolean(social.data?.friends.some((item) => item.id === person.id));
  const incoming = social.data?.incoming.find((request) => request.from.id === person.id);
  const outgoing = social.data?.outgoing.find((request) => request.to.id === person.id);
  const friendError = friendAction.error ?? follow.error;

  const onFollowPress = () => {
    if (following) {
      Alert.alert(`Bỏ theo dõi @${person.username}?`, undefined, [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Bỏ theo dõi', style: 'destructive', onPress: () => follow.mutate({ action: 'unfollow', targetId: person.id }) },
      ]);
    } else {
      follow.mutate({ action: 'follow', targetId: person.id });
    }
  };

  return <>
    <Stack.Screen options={{ title: person.name }}/>
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}/>}>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ProfileAvatar path={person.avatar} size={86}/>
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
            <ProfileStat value={postCount} label="Bài đăng"/>
            {person.creator && <ProfileStat value={followerCount} label="Followers"/>}
            <ProfileStat value={view.followingCount ?? 0} label="Following"/>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <PersonName person={person}/>
            <AppText variant="subhead" numberOfLines={1}>@{person.username}</AppText>
          </View>
          {isMe
            ? <PillButton title="Hồ sơ của bạn" variant="outline" onPress={() => router.push('/profile')}/>
            : person.creator
              ? <PillButton title={following ? 'Đang theo dõi' : 'Theo dõi'} variant={following ? 'outline' : 'solid'} loading={follow.isPending} onPress={onFollowPress}/>
              : null}
        </View>
        {!isMe && <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {friend
            ? <PillButton title="Bạn bè" variant="outline" disabled/>
            : incoming
              ? <PillButton title="Chấp nhận lời mời" loading={friendAction.isPending} onPress={() => friendAction.mutate({ action: 'request-response', body: { id: incoming.id, decision: 'accept' } })}/>
              : outgoing
                ? <PillButton title="Huỷ lời mời" variant="outline" loading={friendAction.isPending} onPress={() => friendAction.mutate({ action: 'request-response', body: { id: outgoing.id, decision: 'cancel' } })}/>
                : <PillButton title="Kết bạn" variant={person.creator ? 'outline' : 'solid'} loading={friendAction.isPending} onPress={() => friendAction.mutate({ action: 'request', body: { targetId: person.id, ...(inviteCode ? { inviteCode } : {}) } })}/>}
        </View>}
        {friendError && <Notice tone="error" text={friendError instanceof Error ? friendError.message : 'Thao tác thất bại.'}/>}
      </View>

      {view.locked
        ? <View style={{ alignItems: 'center', gap: spacing.sm, margin: spacing.md, padding: spacing.xl, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface }}>
            <AppIcon name="lock" size={28} color={colors.secondaryLabel}/>
            <AppText variant="headline" style={{ textAlign: 'center' }}>Trang cá nhân được giới hạn</AppText>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>{friend ? 'Người này chỉ cho chính họ xem trang cá nhân.' : 'Kết bạn với @' + person.username + ' để xem bài đăng và outfit.'}</AppText>
          </View>
        : <>
            <View style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
              <UnderlineTabs options={tabs} value={tab} onChange={setTab}/>
            </View>
            {tab === 'posts'
              ? <ProfileFeed polls={polls} posts={posts} viewerId={social.data?.me.id} emptyText={person.creator && !following && !isMe ? 'Theo dõi để không bỏ lỡ outfit mới.' : undefined}/>
              : view.outfits.length
                ? <ImageGrid fit="cover" aspectRatio={3 / 4} items={view.outfits.map((outfit) => ({ key: outfit.id, path: outfit.frontImageUrl, title: 'Outfit' }))}/>
                : <GridEmpty icon="sparkles" title="Chưa có outfit được chia sẻ"/>}
          </>}
    </ScrollView>
  </>;
}
