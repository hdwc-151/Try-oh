import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { BottomSheet } from '@/components/bottom-sheet';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { apiRequest } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialNotification, SocialSnapshot } from '@/types/api';

export function timeAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'Vừa xong';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' phút trước';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' giờ trước';
  const days = Math.round(hours / 24);
  if (days < 7) return days + ' ngày trước';
  return new Date(timestamp).toLocaleDateString('vi-VN');
}

/** Danh sách thông báo mở từ chuông ở Trang chủ; chạm lời mời kết bạn để tới tab Khám phá. */
export function NotificationsSheet({ visible, notifications, onClose, onOpenFriends }: {
  visible: boolean;
  notifications: SocialNotification[];
  onClose: () => void;
  onOpenFriends: () => void;
}) {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const unread = notifications.filter((item) => !item.read).length;
  const markRead = useMutation({
    mutationFn: () => apiRequest<SocialSnapshot>('/api/social/notification-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['social'] });
      const previous = queryClient.getQueryData<SocialSnapshot>(['social']);
      if (previous) queryClient.setQueryData<SocialSnapshot>(['social'], { ...previous, notifications: previous.notifications.map((item) => ({ ...item, read: true })) });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['social'], context.previous);
    },
    onSuccess: (snapshot) => queryClient.setQueryData(['social'], snapshot),
  });

  return <BottomSheet visible={visible} title={unread ? 'Thông báo · ' + unread + ' mới' : 'Thông báo'} onClose={onClose} onClosed={() => markRead.reset()}>
    {notifications.length === 0
      ? <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
            <AppIcon name="bell" size={26} color={brand.accent}/>
          </View>
          <AppText variant="headline">Chưa có thông báo</AppText>
          <AppText variant="subhead" style={{ textAlign: 'center' }}>Lời mời kết bạn và bình chọn outfit sẽ hiện ở đây.</AppText>
        </View>
      : <View style={{ borderRadius: radius.xl, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surface }}>
          {notifications.map((item, index) => <Animated.View key={item.id} entering={FadeIn.duration(200).delay(Math.min(index, 8) * 25)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={(item.read ? '' : 'Chưa đọc. ') + item.text}
              onPress={() => { if (item.kind === 'request') onOpenFriends(); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.separator, backgroundColor: pressed && item.kind === 'request' ? colors.groupedBackground : 'transparent' })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: item.read ? colors.groupedBackground : brand.secondary }}>
                <AppIcon name={item.kind === 'request' ? 'people' : 'sparkles'} size={20} color={item.read ? colors.secondaryLabel : brand.accent}/>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body" style={{ fontWeight: item.read ? '400' : '700' }}>{item.text}</AppText>
                <AppText variant="caption">{timeAgo(item.createdAt)}</AppText>
              </View>
              {!item.read && <View accessibilityElementsHidden style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: brand.sparkle }}/>}
              {item.kind === 'request' && <AppIcon name="chevronRight" size={18} color={colors.secondaryLabel}/>}
            </Pressable>
          </Animated.View>)}
        </View>}
    {markRead.error && <Notice tone="error" text="Không thể đánh dấu đã đọc. Vui lòng thử lại."/>}
    {unread > 0 && <AppButton title="Đánh dấu đã đọc hết" icon="check" variant="secondary" loading={markRead.isPending} onPress={() => markRead.mutate()}/>}
  </BottomSheet>;
}
