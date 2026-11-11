import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ActivityIndicator, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useState } from 'react';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialPerson, SocialSnapshot } from '@/types/api';

type SocialAction = {
  action: 'request' | 'request-response';
  body: Record<string, unknown>;
};

export function FriendsScreen() {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [search, setSearch] = useState('');
  const typedSearch = search.replace(/^@/, '').trim();
  // Chờ người dùng ngừng gõ rồi mới gọi máy chủ, thay vì một request cho mỗi ký tự.
  const normalizedSearch = useDebouncedValue(typedSearch, 300);

  const query = useQuery({
    queryKey: ['social'],
    queryFn: () => apiRequest<SocialSnapshot>('/api/social'),
  });
  const searchQuery = useQuery({
    queryKey: ['social-search', normalizedSearch],
    queryFn: () => apiRequest<SocialPerson[]>('/api/social/search?q=' + encodeURIComponent(normalizedSearch)),
    enabled: normalizedSearch.length >= 2,
    // Giữ kết quả cũ trong lúc tải kết quả mới, danh sách không nháy trống.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const searching = typedSearch.length >= 2 && (typedSearch !== normalizedSearch || searchQuery.isFetching);
  const showResults = typedSearch.length >= 2;
  const action = useMutation({
    mutationFn: ({ action: actionName, body }: SocialAction) => apiRequest<SocialSnapshot>('/api/social/' + actionName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(['social'], snapshot);
      void queryClient.invalidateQueries({ queryKey: ['social-search'] });
    },
  });
  // Chỉ hàng đang thao tác hiện vòng quay; các hàng khác vẫn bấm được.
  const pendingKey = action.isPending ? JSON.stringify(action.variables?.body) : null;
  const isBusy = (body: Record<string, unknown>) => pendingKey === JSON.stringify(body);

  if (query.error) return <ScreenError message={query.error instanceof Error ? query.error.message : 'Không thể tải bạn bè.'} onRetry={() => void query.refetch()}/>;
  if (query.data === undefined) return <ScreenLoading variant="list" label="Đang tải bạn bè…"/>;

  const data = query.data;
  const unread = data.notifications.filter((item) => !item.read).length;
  const act = (actionName: SocialAction['action'], body: Record<string, unknown>) => {
    action.mutate({ action: actionName, body });
  };
  const respond = (id: string, decision: 'accept' | 'decline' | 'cancel') => {
    const body = { id, decision };
    return { busy: isBusy(body), disabled: action.isPending, onPress: () => act('request-response', body) };
  };

  const searchAction = (person: SocialPerson) => {
    if (data.friends.some((item) => item.id === person.id)) {
      return <StatusPill label="Đã là bạn bè" />;
    }
    const incoming = data.incoming.find((item) => item.from.id === person.id);
    if (incoming) {
      return <SmallAction label="Chấp nhận" {...respond(incoming.id, 'accept')}/>;
    }
    const outgoing = data.outgoing.find((item) => item.to.id === person.id);
    if (outgoing) {
      return <SmallAction label="Huỷ lời mời" secondary {...respond(outgoing.id, 'cancel')}/>;
    }
    const body = { targetId: person.id };
    return <SmallAction label="Kết bạn" busy={isBusy(body)} disabled={action.isPending} onPress={() => act('request', body)}/>;
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={brand.primary}/>}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}>
      <View style={{ gap: spacing.sm, padding: spacing.lg, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: brand.secondary }}>
        <AppText variant="title">Kết nối cùng gu</AppText>
        <AppText variant="subhead">
          {data.incoming.length
            ? data.incoming.length + ' lời mời đang chờ'
            : unread
              ? unread + ' thông báo mới'
              : data.friends.length + ' bạn bè'}
        </AppText>
      </View>

      <Section title="Tìm bạn bè">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            accessibilityLabel="Tìm bạn theo tên hoặc username"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={50}
            placeholder="Tên hoặc @username"
            placeholderTextColor={colors.secondaryLabel}
            style={{
              flex: 1,
              minHeight: 48,
              paddingHorizontal: spacing.md,
              borderWidth: 1,
              borderColor: colors.separator,
              borderRadius: radius.lg,
              color: colors.label,
              backgroundColor: colors.surface,
              fontSize: 16,
            }}
          />
          {search.length > 0 && <SmallAction label="Xoá" secondary onPress={() => setSearch('')}/>}
        </View>
        {typedSearch.length === 1 && <AppText variant="caption">Nhập ít nhất 2 ký tự để tìm.</AppText>}
        {searching && !searchQuery.data && <View style={{ padding: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.label}/></View>}
        {showResults && searchQuery.error && <Notice tone="error" text={searchQuery.error instanceof Error ? searchQuery.error.message : 'Không thể tìm bạn lúc này.'} />}
        {showResults && !searching && searchQuery.data?.length === 0 && (
          <Animated.View entering={FadeIn.duration(180)} style={{ paddingVertical: spacing.md, alignItems: 'center' }}><AppText variant="subhead">Không tìm thấy tài khoản phù hợp.</AppText></Animated.View>
        )}
        {showResults && <View style={{ opacity: searching && searchQuery.data ? 0.55 : 1 }}>
          {searchQuery.data?.map((person) => (
            <Animated.View key={person.id} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
              <PersonRow person={person} accessToken={session?.access_token} action={searchAction(person)}/>
            </Animated.View>
          ))}
        </View>}
      </Section>

      {data.incoming.length > 0 && (
        <Section title={'Lời mời đã nhận · ' + data.incoming.length}>
          {data.incoming.map((request) => (
            <Animated.View key={request.id} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
              <PersonRow
                person={request.from}
                accessToken={session?.access_token}
                action={<View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <SmallAction label="Nhận" {...respond(request.id, 'accept')}/>
                  <SmallAction label="Từ chối" secondary {...respond(request.id, 'decline')}/>
                </View>}
              />
            </Animated.View>
          ))}
        </Section>
      )}

      {data.outgoing.length > 0 && (
        <Section title={'Lời mời đã gửi · ' + data.outgoing.length}>
          {data.outgoing.map((request) => (
            <Animated.View key={request.id} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
              <PersonRow
                person={request.to}
                accessToken={session?.access_token}
                action={<SmallAction label="Huỷ" secondary {...respond(request.id, 'cancel')}/>}
              />
            </Animated.View>
          ))}
        </Section>
      )}

      <Section title={'Bạn bè · ' + data.friends.length}>
        {data.friends.length === 0
          ? <View style={{ minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
              <AppIcon name="people" size={26} color={brand.accent}/>
            </View>
            <AppText variant="headline">Chưa có bạn bè</AppText>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>Tìm người dùng phía trên để gửi lời mời kết bạn.</AppText>
          </View>
          : data.friends.map((person) => <Animated.View key={person.id} entering={FadeIn.duration(200)} layout={LinearTransition.duration(200)}><PersonRow person={person} accessToken={session?.access_token}/></Animated.View>)}
      </Section>

      {action.error && <Notice tone="error" text={action.error instanceof Error ? action.error.message : 'Không thể thực hiện thao tác.'} />}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }}>
    <AppText variant="headline">{title}</AppText>
    {children}
  </View>;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function PersonRow({ person, accessToken, action }: { person: SocialPerson; accessToken?: string; action?: React.ReactNode }) {
  const brand = useBrandColors();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
    {person.avatar
      ? <Image source={protectedImageSource(person.avatar, accessToken)} recyclingKey={person.id} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.groupedBackground }} contentFit="cover" transition={200}/>
      : <View accessibilityElementsHidden style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
          <AppText selectable={false} variant="headline" style={{ fontSize: 16, color: brand.primary }}>{initials(person.name)}</AppText>
        </View>}
    <View style={{ flex: 1, minWidth: 0 }}>
      <AppText variant="headline" numberOfLines={1}>{person.name}</AppText>
      <AppText variant="caption" numberOfLines={1}>@{person.username}</AppText>
    </View>
    {action}
  </View>;
}

function SmallAction({ label, onPress, secondary = false, busy = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; busy?: boolean; disabled?: boolean }) {
  return <PressableScale
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ busy, disabled: busy || disabled }}
    disabled={busy || disabled}
    onPress={onPress}
    scaleTo={0.94}
    style={{
      minHeight: 38,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderWidth: secondary ? 1 : 0,
      borderColor: colors.separator,
      borderRadius: radius.full,
      backgroundColor: secondary ? colors.surface : colors.label,
      opacity: disabled && !busy ? 0.5 : 1,
    }}>
    {busy
      ? <ActivityIndicator size="small" color={secondary ? colors.label : colors.onBrand}/>
      : <AppText selectable={false} variant="caption" style={{ color: secondary ? colors.label : colors.onBrand, fontWeight: '800' }}>{label}</AppText>}
  </PressableScale>;
}

function StatusPill({ label }: { label: string }) {
  return <View style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.successBackground }}>
    <AppText variant="caption" style={{ color: colors.success, fontWeight: '700' }}>{label}</AppText>
  </View>;
}
