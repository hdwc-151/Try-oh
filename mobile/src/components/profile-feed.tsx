import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';

import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { GridEmpty, ImageGrid } from '@/components/profile-ui';
import { PressableScale } from '@/components/pressable-scale';
import { formatRemaining, useNow } from '@/hooks/use-now';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialPoll, SocialPost } from '@/types/api';

/**
 * Mục "Bài đăng" trên trang cá nhân: bình chọn (mới nhất trước) rồi lưới ảnh đã đăng.
 * Chạm một bình chọn mở màn bình chọn, nơi người nhận quẹt chọn và chủ xem kết quả.
 */
export function ProfileFeed({ polls, posts, viewerId, emptyText }: { polls: SocialPoll[]; posts: SocialPost[]; viewerId?: string; emptyText?: string }) {
  const now = useNow(60_000);
  const imagePosts = posts.filter((post) => post.imageUrls.length > 0);
  if (!polls.length && !imagePosts.length) return <GridEmpty title="Chưa có bài đăng" text={emptyText}/>;
  return <View style={{ gap: spacing.md }}>
    {polls.length > 0 && <View style={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
      {[...polls].sort((a, b) => b.createdAt - a.createdAt).map((poll) => <PollSummaryCard key={poll.id} poll={poll} now={now} viewerId={viewerId}/>)}
    </View>}
    {imagePosts.length > 0 && <ImageGrid fit="cover" aspectRatio={3 / 4} items={imagePosts.map((post) => ({ key: post.id, path: post.imageUrls[0]!, title: post.caption || 'Bài đăng' }))}/>}
  </View>;
}

function PollSummaryCard({ poll, now, viewerId }: { poll: SocialPoll; now: number; viewerId?: string }) {
  const brand = useBrandColors();
  const { session } = useAuth();
  const ended = poll.closed || poll.expiresAt <= now;
  const isOwner = viewerId === poll.owner.id;
  const status = ended ? 'Đã kết thúc' : formatRemaining(poll.expiresAt, now);
  const voteLine = isOwner
    ? `${poll.votes.length}/${poll.recipients.length} người đã chọn`
    : poll.myVote ? 'Bạn đã chọn' : ended ? 'Bạn chưa chọn' : 'Chạm để chọn giúp';
  return <PressableScale
    accessibilityRole="button"
    accessibilityLabel={`Bình chọn ${poll.title}. ${status}. ${voteLine}`}
    onPress={() => router.push('/polls')}
    scaleTo={0.98}
    style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <AppIcon name="people" size={15} color={brand.accent}/>
      <AppText variant="caption" style={{ color: brand.accent, fontWeight: '700' }}>Bình chọn</AppText>
      <AppText variant="caption">· {status}</AppText>
      <View style={{ flex: 1 }}/>
      <AppIcon name="chevronRight" size={14} color={colors.secondaryLabel}/>
    </View>
    <AppText variant="headline" numberOfLines={2} style={{ fontSize: 16 }}>{poll.title}</AppText>
    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
      {poll.outfits.map((outfit) => {
        const winner = ended && poll.winnerId === outfit.id;
        const mine = poll.myVote === outfit.id;
        return <View key={outfit.id} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.groupedBackground, borderWidth: winner || mine ? 2 : 0, borderColor: brand.primary }}>
          <Image source={protectedImageSource(outfit.frontImageUrl, session?.access_token, 320)} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} recyclingKey={outfit.id}/>
        </View>;
      })}
    </View>
    <AppText variant="caption">{voteLine}</AppText>
  </PressableScale>;
}
