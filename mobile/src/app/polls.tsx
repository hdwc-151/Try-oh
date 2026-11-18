import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, interpolate, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Notice } from '@/components/notice';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { formatRemaining, useNow } from '@/hooks/use-now';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialPoll, SocialSnapshot } from '@/types/api';

const SWIPE_DISTANCE = 110;

export default function PollsRoute() {
  const queryClient = useQueryClient();
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const now = useNow();
  const act = useMutation({
    mutationFn: ({ action, body }: { action: 'vote' | 'poll-close' | 'poll-delete'; body: Record<string, unknown> }) =>
      apiRequest<SocialSnapshot>('/api/social/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: (snapshot) => queryClient.setQueryData(['social'], snapshot),
  });
  // Bình chọn vừa quẹt: ẩn ngay trên máy cho mượt, không đợi máy chủ trả về.
  const [swiped, setSwiped] = useState<string[]>([]);

  if (social.error) return <ScreenError message={social.error instanceof Error ? social.error.message : 'Không thể tải bình chọn.'} onRetry={() => void social.refetch()}/>;
  if (!social.data) return <ScreenLoading variant="cards" label="Đang tải bình chọn…"/>;

  const data = social.data;
  const meId = data.me.id;
  const active = (poll: SocialPoll) => !poll.closed && poll.expiresAt > now;
  const toVote = data.polls.filter((poll) => poll.owner.id !== meId && !poll.myVote && active(poll) && !swiped.includes(poll.id) && poll.outfits.length > 0);
  const mine = [...data.polls.filter((poll) => poll.owner.id === meId)].sort((a, b) => b.createdAt - a.createdAt);
  const voted = data.polls.filter((poll) => poll.owner.id !== meId && (poll.myVote || !active(poll)));
  const current = toVote[0];

  const vote = (poll: SocialPoll, outfitId: string) => {
    setSwiped((list) => [...list, poll.id]);
    act.mutate({ action: 'vote', body: { id: poll.id, outfitId } }, {
      onError: () => setSwiped((list) => list.filter((id) => id !== poll.id)),
    });
  };

  return <>
    <Stack.Screen options={{ title: 'Bình chọn' }}/>
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      refreshControl={<RefreshControl refreshing={social.isRefetching} onRefresh={() => void social.refetch()}/>}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}>
      {current
        ? <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" style={{ textAlign: 'center' }}>{toVote.length} bình chọn đang chờ · quẹt phải để chọn, quẹt trái để xem bộ khác</AppText>
            <SwipeCard key={current.id} poll={current} now={now} onVote={(outfitId) => vote(current, outfitId)}/>
          </View>
        : <Animated.View entering={FadeIn.duration(240)} style={{ alignItems: 'center', gap: spacing.xs, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface }}>
            <AppText style={{ fontSize: 34 }}>🎉</AppText>
            <AppText variant="headline">Bạn đã chọn hết rồi</AppText>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>Khi bạn bè nhờ chọn outfit, thẻ sẽ hiện ở đây.</AppText>
          </Animated.View>}

      {act.error && <Notice tone="error" text={act.error instanceof Error ? act.error.message : 'Chưa thể gửi bình chọn.'} onDismiss={() => act.reset()}/>}

      <AppButton title="Nhờ bạn bè chọn giúp" icon="plus" onPress={() => router.push('/poll-create')}/>

      {mine.length > 0 && <View style={{ gap: spacing.sm }}>
        <AppText variant="headline">Bình chọn của bạn</AppText>
        {mine.map((poll) => <ResultCard key={poll.id} poll={poll} now={now} owner
          onClose={active(poll) ? () => act.mutate({ action: 'poll-close', body: { id: poll.id } }) : undefined}/>)}
      </View>}

      {voted.length > 0 && <View style={{ gap: spacing.sm }}>
        <AppText variant="headline">Bạn đã chọn</AppText>
        {voted.map((poll) => <ResultCard key={poll.id} poll={poll} now={now}/>)}
      </View>}
    </ScrollView>
  </>;
}

/**
 * Thẻ quẹt: mỗi lần hiện một phương án. Quẹt phải (hoặc bấm tim) chọn phương án đó; quẹt trái
 * (hoặc bấm ✕) chuyển sang phương án kế tiếp, hết thì vòng lại.
 */
function SwipeCard({ poll, now, onVote }: { poll: SocialPoll; now: number; onVote: (outfitId: string) => void }) {
  const brand = useBrandColors();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const x = useSharedValue(0);
  const option = poll.outfits[index % poll.outfits.length]!;

  useEffect(() => { x.set(0); }, [index, x]);

  const next = () => { haptic.light(); setIndex((value) => (value + 1) % poll.outfits.length); };
  const choose = () => { haptic.success(); onVote(option.id); };
  const fly = (direction: 1 | -1) => {
    'worklet';
    x.set(withTiming(direction * width * 1.2, { duration: 220 }, (finished) => {
      if (!finished) return;
      if (direction > 0) scheduleOnRN(choose);
      else scheduleOnRN(next);
    }));
  };

  const pan = usePanGesture({
    onUpdate: (event) => { 'worklet'; x.set(event.translationX); },
    onDeactivate: (event) => {
      'worklet';
      if (event.translationX > SWIPE_DISTANCE || event.velocityX > 900) fly(1);
      else if (event.translationX < -SWIPE_DISTANCE || event.velocityX < -900) fly(-1);
      else x.set(withSpring(0, { damping: 18, stiffness: 220 }));
    },
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { rotate: interpolate(x.get(), [-width, width], [-14, 14]) + 'deg' }],
  }));
  const likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [0, SWIPE_DISTANCE], [0, 1], 'clamp') }));
  const skipStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [-SWIPE_DISTANCE, 0], [1, 0], 'clamp') }));

  return <View style={{ gap: spacing.md }}>
    <GestureDetector gesture={pan}>
      <Animated.View entering={FadeInDown.duration(260)} style={[{ borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, boxShadow: '0 10px 30px rgba(20, 26, 60, 0.18)' }, cardStyle]}>
        <Image source={protectedImageSource(option.frontImageUrl, session?.access_token)} style={{ width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.groupedBackground }} contentFit="cover" transition={150}/>
        <View style={{ position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: 4 }}>
          {poll.outfits.map((item, dot) => <View key={item.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: dot === index % poll.outfits.length ? colors.surface : 'rgba(255,255,255,0.45)' }}/>)}
        </View>
        <Animated.View style={[{ position: 'absolute', top: 40, left: spacing.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.md, borderWidth: 3, borderColor: colors.success, transform: [{ rotate: '-12deg' }] }, likeStyle]}>
          <AppText style={{ color: colors.success, fontWeight: '900', fontSize: 22 }}>CHỌN!</AppText>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', top: 40, right: spacing.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.md, borderWidth: 3, borderColor: colors.surface, transform: [{ rotate: '12deg' }] }, skipStyle]}>
          <AppText style={{ color: colors.surface, fontWeight: '900', fontSize: 22 }}>BỘ KHÁC</AppText>
        </Animated.View>
        <View style={{ padding: spacing.md, gap: 4 }}>
          <AppText variant="caption" style={{ color: brand.accent, fontWeight: '800' }}>{poll.owner.name} nhờ bạn chọn · {formatRemaining(poll.expiresAt, now)}</AppText>
          <AppText variant="headline">{poll.title}</AppText>
          <AppText variant="caption">Phương án {index % poll.outfits.length + 1}/{poll.outfits.length}</AppText>
        </View>
      </Animated.View>
    </GestureDetector>
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
      <RoundButton label="Xem bộ khác" emoji="✕" onPress={() => fly(-1)} color={colors.secondaryLabel}/>
      <RoundButton label="Chọn bộ này" emoji="♥" onPress={() => fly(1)} color={brand.sparkle}/>
    </View>
  </View>;
}

function RoundButton({ label, emoji, onPress, color }: { label: string; emoji: string; onPress: () => void; color: string }) {
  return <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress} scaleTo={0.9}
    style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: '0 4px 14px rgba(20, 26, 60, 0.15)' }}>
    <AppText style={{ fontSize: 28, color, fontWeight: '800' }}>{emoji}</AppText>
  </PressableScale>;
}

/** Kết quả một bình chọn: thanh phần trăm chạy dần, đánh dấu phương án dẫn đầu và lựa chọn của mình. */
function ResultCard({ poll, now, owner = false, onClose }: { poll: SocialPoll; now: number; owner?: boolean; onClose?: () => void }) {
  const brand = useBrandColors();
  const { session } = useAuth();
  const total = poll.votes.length;
  const counts = poll.outfits.map((outfit) => poll.votes.filter((vote) => vote.outfitId === outfit.id).length);
  const leader = Math.max(0, ...counts);
  const ended = poll.closed || poll.expiresAt <= now;
  return <Animated.View layout={LinearTransition.duration(200)} style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline" numberOfLines={2}>{poll.title}</AppText>
        <AppText variant="caption">{owner ? '' : poll.owner.name + ' · '}{ended ? 'Đã kết thúc' : formatRemaining(poll.expiresAt, now)} · {total} phiếu</AppText>
      </View>
      {onClose && <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.groupedBackground }}>
        <AppText variant="caption" style={{ color: brand.primary, fontWeight: '700' }}>Chốt luôn</AppText>
      </Pressable>}
    </View>
    {!owner && !poll.myVote && !ended
      ? <AppText variant="caption">Kết quả hiện sau khi bạn chọn.</AppText>
      : poll.outfits.map((outfit, index) => {
          const share = total ? counts[index]! / total : 0;
          const leading = counts[index]! === leader && leader > 0;
          return <View key={outfit.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Image source={protectedImageSource(outfit.frontImageUrl, session?.access_token, 160)} style={{ width: 44, height: 55, borderRadius: radius.sm, backgroundColor: colors.groupedBackground }} contentFit="cover"/>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="caption" style={{ color: colors.label, fontWeight: leading ? '800' : '500' }}>
                  Bộ {index + 1}{leading ? ' 👑' : ''}{poll.myVote === outfit.id ? ' · bạn chọn' : ''}
                </AppText>
                <AppText variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{Math.round(share * 100)}%</AppText>
              </View>
              <ShareBar value={share} color={leading ? brand.sparkle : brand.accent}/>
            </View>
          </View>;
        })}
  </Animated.View>;
}

function ShareBar({ value, color }: { value: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => { progress.set(withTiming(value, { duration: 500 })); }, [progress, value]);
  const style = useAnimatedStyle(() => ({ width: `${Math.max(progress.get() * 100, 2)}%` }));
  return <View style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.groupedBackground }}>
    <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: color }, style]}/>
  </View>;
}
