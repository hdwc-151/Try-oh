import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, TextInput, View } from 'react-native';

import { KeyboardScrollView } from '@/components/keyboard-scroll-view';
import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { GridEmpty, PersonName, PillButton, ProfileAvatar } from '@/components/profile-ui';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { SegmentedControl } from '@/components/segmented-control';
import { useFollowAction } from '@/hooks/use-follow-action';
import { apiRequest } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { PageResponse, SocialPerson, SocialSnapshot } from '@/types/api';

type ListTab = 'followers' | 'following';

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const matches = (person: SocialPerson, term: string) => !term || normalize(person.name + ' ' + person.username).includes(term);

/**
 * Danh sách Người theo dõi / Đang theo dõi (giống Instagram, TikTok):
 * KOL/KOC xem và gỡ người theo dõi; ai cũng xem, bỏ theo dõi KOL/KOC mình theo dõi và nhận gợi ý KOL/KOC.
 */
export default function FollowsRoute() {
  const brand = useBrandColors();
  const params = useLocalSearchParams<{ tab?: string }>();
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const follow = useFollowAction();
  const [tab, setTab] = useState<ListTab>(params.tab === 'followers' ? 'followers' : 'following');
  const [search, setSearch] = useState('');
  // Bỏ theo dõi xong vẫn giữ hàng trong danh sách (đổi thành nút "Theo dõi") để lỡ tay thì bấm lại được ngay.
  const [recentlyUnfollowed, setRecentlyUnfollowed] = useState<SocialPerson[]>([]);
  const term = normalize(search.replace(/^@/, ''));

  const data = social.data;
  const isCreator = Boolean(data?.me.creator);
  const activeTab: ListTab = isCreator ? tab : 'following';
  // Người theo dõi có thể lên tới hàng nghìn: tải từng trang 30 người, không nằm trong snapshot.
  const followersQuery = useInfiniteQuery({
    queryKey: ['social-followers'],
    initialPageParam: 0,
    enabled: isCreator,
    queryFn: ({ pageParam }) => apiRequest<PageResponse<SocialPerson>>(`/api/social/followers?offset=${pageParam}&limit=30`),
    getNextPageParam: (page) => page.nextOffset,
  });
  const followers = useMemo(() => followersQuery.data?.pages.flatMap((page) => page.items) ?? [], [followersQuery.data?.pages]);
  const followerTotal = data?.followerCount ?? followersQuery.data?.pages[0]?.total ?? 0;
  // Đang tìm thì tải nốt các trang còn lại để không bỏ sót người ở cuối danh sách.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = followersQuery;
  useEffect(() => {
    if (term && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [term, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const following = useMemo(() => data?.following ?? [], [data?.following]);
  const followingIds = useMemo(() => new Set(following.map((person) => person.id)), [following]);
  const followingRows = useMemo(() => [
    ...following,
    ...recentlyUnfollowed.filter((person) => !followingIds.has(person.id)),
  ], [following, recentlyUnfollowed, followingIds]);
  const meId = data?.me.id;
  const suggestions = useMemo(() => (data?.creators ?? [])
    .filter((item) => !item.following && item.person.id !== meId && !recentlyUnfollowed.some((person) => person.id === item.person.id))
    .sort((a, b) => b.followerCount - a.followerCount)
    .slice(0, 10), [data?.creators, meId, recentlyUnfollowed]);

  if (social.error) return <ScreenError message={social.error instanceof Error ? social.error.message : 'Không thể tải danh sách.'} onRetry={() => void social.refetch()} />;
  if (!data) return <ScreenLoading variant="list" label="Đang tải danh sách…" />;

  const rows = (activeTab === 'followers' ? followers : followingRows).filter((person) => matches(person, term));
  const openProfile = (person: SocialPerson) => router.push({ pathname: '/user/[id]', params: { id: person.id } });

  const toggleFollow = (person: SocialPerson) => {
    if (followingIds.has(person.id)) {
      Alert.alert(`Bỏ theo dõi @${person.username}?`, 'Bạn sẽ không còn thấy bài mới của họ trong mục KOL/KOC.', [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Bỏ theo dõi', style: 'destructive', onPress: () => follow.mutate({ action: 'unfollow', targetId: person.id }, {
            onSuccess: () => setRecentlyUnfollowed((current) => current.some((item) => item.id === person.id) ? current : [...current, person]),
          })
        },
      ]);
    } else {
      follow.mutate({ action: 'follow', targetId: person.id });
    }
  };
  const removeFollower = (person: SocialPerson) => Alert.alert(
    'Xoá người theo dõi?',
    `Try-oh sẽ không báo cho @${person.username} biết bạn đã xoá họ khỏi danh sách người theo dõi.`,
    [
      { text: 'Huỷ', style: 'cancel' },
      { text: 'Xoá', style: 'destructive', onPress: () => follow.mutate({ action: 'remove-follower', targetId: person.id }) },
    ],
  );

  const title = activeTab === 'followers' ? 'Người theo dõi' : 'Đang theo dõi';
  const emptyText = term
    ? { title: 'Không tìm thấy', text: 'Thử tên hoặc username khác.' }
    : activeTab === 'followers'
      ? { title: 'Chưa có người theo dõi' }
      : { title: 'Bạn chưa theo dõi ai' };

  return <>
    <Stack.Screen options={{ title: '@' + data.me.username }} />
    <KeyboardScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}
      scrollEventThrottle={200}
      onScroll={(event) => {
        if (activeTab !== 'followers' || !hasNextPage || isFetchingNextPage) return;
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) void fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={social.isRefetching || followersQuery.isRefetching} onRefresh={() => { void social.refetch(); if (isCreator) void followersQuery.refetch(); }} />}>
      {isCreator
        ? <SegmentedControl
          stretch
          value={activeTab}
          onChange={(value) => { setTab(value); setSearch(''); }}
          options={[
            { value: 'followers', label: `${followerTotal.toLocaleString('vi-VN')} Người theo dõi` },
            { value: 'following', label: `${following.length} Đang theo dõi` },
          ]} />
        : <AppText variant="headline">{following.length} {title}</AppText>}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.groupedBackground }}>
        <AppIcon name="search" size={18} color={colors.secondaryLabel} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Tìm theo tên hoặc @username"
          placeholderTextColor={colors.secondaryLabel}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={`Tìm trong ${title.toLowerCase()}`}
          style={{ flex: 1, fontSize: 16, color: colors.label, paddingVertical: spacing.sm }} />
        {search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Xoá tìm kiếm" hitSlop={10} onPress={() => setSearch('')}>
          <AppIcon name="close" size={16} color={colors.secondaryLabel} />
        </Pressable>}
      </View>

      {follow.error && <Notice tone="error" text={follow.error instanceof Error ? follow.error.message : 'Thao tác thất bại.'} />}

      {rows.length
        ? <View style={{ gap: spacing.xs }}>
          {rows.map((person) => <PersonRow
            key={person.id}
            person={person}
            onPress={() => openProfile(person)}
            inlineFollow={activeTab === 'followers' && person.creator && !followingIds.has(person.id)
              ? () => follow.mutate({ action: 'follow', targetId: person.id })
              : undefined}
            action={activeTab === 'followers'
              ? <PillButton compactSize variant="outline" title="Xoá" loading={follow.pendingId === person.id} disabled={follow.isPending} onPress={() => removeFollower(person)} />
              : <PillButton
                compactSize
                variant={followingIds.has(person.id) ? 'outline' : 'solid'}
                title={followingIds.has(person.id) ? 'Đang theo dõi' : 'Theo dõi'}
                loading={follow.pendingId === person.id}
                disabled={follow.isPending}
                onPress={() => toggleFollow(person)} />} />)}
        </View>
        : activeTab === 'followers' && (followersQuery.isPending || isFetchingNextPage)
          ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={brand.primary as string} />
          : <GridEmpty icon="people" title={emptyText.title} text={emptyText.text} />}
      {activeTab === 'followers' && rows.length > 0 && isFetchingNextPage && <ActivityIndicator style={{ marginVertical: spacing.md }} color={brand.primary as string} />}
      {activeTab === 'followers' && followersQuery.error && <Notice tone="error" text={followersQuery.error instanceof Error ? followersQuery.error.message : 'Không thể tải người theo dõi.'} />}

      {activeTab === 'following' && !term && suggestions.length > 0 && <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
        <AppText variant="headline" style={{ marginBottom: spacing.xs }}>Gợi ý cho bạn</AppText>
        {suggestions.map((item) => <PersonRow
          key={item.person.id}
          person={item.person}
          subtitle={`${item.followerCount.toLocaleString('vi-VN')} người theo dõi`}
          onPress={() => openProfile(item.person)}
          action={<PillButton compactSize title="Theo dõi" loading={follow.pendingId === item.person.id} disabled={follow.isPending} onPress={() => follow.mutate({ action: 'follow', targetId: item.person.id })} />} />)}
      </View>}
    </KeyboardScrollView>
  </>;
}

function PersonRow({ person, subtitle, action, onPress, inlineFollow }: {
  person: SocialPerson;
  subtitle?: string;
  action: ReactNode;
  onPress: () => void;
  inlineFollow?: () => void;
}) {
  const brand = useBrandColors();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: spacing.xs + 2 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Xem hồ sơ ${person.name}`} onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 }}>
      <ProfileAvatar path={person.avatar} size={50} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <PersonName person={person} variant="body" />
          {inlineFollow && <Pressable accessibilityRole="button" accessibilityLabel={`Theo dõi lại ${person.name}`} hitSlop={8} onPress={inlineFollow}>
            <AppText variant="subhead" style={{ color: brand.accent, fontWeight: '700' }}>· Theo dõi</AppText>
          </Pressable>}
        </View>
        <AppText variant="subhead" numberOfLines={1}>{subtitle ?? '@' + person.username}</AppText>
      </View>
    </Pressable>
    {action}
  </View>;
}
