import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { AppText } from '@/components/app-text';
import { FitsyWordmark } from '@/components/fitsy-mark';
import { NotificationsSheet } from '@/components/notifications-sheet';
import { PressableScale } from '@/components/pressable-scale';
import { SegmentedControl, type SegmentOption } from '@/components/segmented-control';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource } from '@/services/api-client';
import { colors, spacing, useBrandColors } from '@/theme';
import { TryOnScreen } from '@/screens/try-on';
import { WardrobeScreen } from '@/screens/wardrobe';
import type { SocialSnapshot } from '@/types/api';

type HomeSegment = 'try-on' | 'wardrobe' | 'shop';

const segments: SegmentOption<HomeSegment>[] = [
  { value: 'try-on', label: 'Thử đồ AI', icon: 'hanger' },
  { value: 'wardrobe', label: 'Tủ đồ', icon: 'wardrobe' },
  { value: 'shop', label: 'Shop', icon: 'bag' },
];

export function HomeScreen() {
  const brand = useBrandColors();
  const [segment, setSegment] = useState<HomeSegment>('try-on');
  // Giữ các mục đã mở trong bộ nhớ: chuyển qua lại không tải lại, không nháy màn chờ, và việc đang chạy không bị huỷ.
  const [visited, setVisited] = useState<HomeSegment[]>(['try-on']);
  const open = (next: HomeSegment) => {
    setSegment(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
  };
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <HomeHeader />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
        <SegmentedControl
          options={segments}
          value={segment}
          onChange={open}
          size="large"
          inactiveColor={brand.primary}
          trackStyle={{ boxShadow: '0 2px 10px rgba(20, 26, 60, 0.06)' }}
        />
      </ScrollView>
      <View collapsable={false} style={{ flex: 1 }}>
        <Pane active={segment === 'try-on'}><TryOnScreen onOpenWardrobe={() => open('wardrobe')} /></Pane>
        {visited.includes('wardrobe') && <Pane active={segment === 'wardrobe'}><WardrobeScreen fixedMode="garments" /></Pane>}
        {visited.includes('shop') && <Pane active={segment === 'shop'}><ShopComingSoon /></Pane>}
      </View>
    </SafeAreaView>
  );
}

/** Mục đang chọn hiện ra bằng hiệu ứng mờ + trượt nhẹ; mục ẩn vẫn giữ trạng thái. */
function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (!active) return;
    if (reduceMotion) { progress.set(1); return; }
    progress.set(0);
    progress.set(withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }));
  }, [active, progress, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 8 }],
  }));
  return <Animated.View style={[{ flex: 1, display: active ? 'flex' : 'none' }, style]}>{children}</Animated.View>;
}

function HomeHeader() {
  const brand = useBrandColors();
  const router = useRouter();
  const { session } = useAuth();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Dùng chung cache với tab Cá nhân / Khám phá; lỗi ở đây không chặn trang chủ.
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const notifications = social.data?.notifications ?? [];
  const unread = notifications.filter((item) => !item.read).length;
  const avatar = social.data?.me.avatar;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      <FitsyWordmark size={32} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
          hitSlop={8}
          scaleTo={0.88}
          onPress={() => { setNotificationsOpen(true); if (!social.data) void social.refetch(); }}>
          <AppIcon name="bell" size={26} color={brand.primary} />
          {unread > 0 && <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.sparkle, borderWidth: 2, borderColor: colors.background }}>
            <AppText selectable={false} style={{ fontSize: 10, lineHeight: 12, fontWeight: '800', color: colors.onBrand }}>{unread > 9 ? '9+' : unread}</AppText>
          </View>}
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Cá nhân"
          hitSlop={8}
          scaleTo={0.9}
          onPress={() => router.navigate('/(tabs)/profile')}
          style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: brand.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {avatar
            ? <Image source={protectedImageSource(avatar, session?.access_token)} style={{ width: 36, height: 36 }} contentFit="cover" transition={200} />
            : <AppIcon name="person" size={28} color={brand.primary} />}
        </PressableScale>
      </View>
      <NotificationsSheet
        visible={notificationsOpen}
        notifications={notifications}
        onClose={() => setNotificationsOpen(false)}
        onOpenFriends={() => { setNotificationsOpen(false); router.navigate('/(tabs)/friends'); }}
      />
    </View>
  );
}

function ShopComingSoon() {
  const brand = useBrandColors();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
        <AppIcon name="bag" size={34} color={brand.accent} />
      </View>
      <AppText variant="title" style={{ textAlign: 'center' }}>Shop sắp ra mắt</AppText>
      <AppText variant="subhead" style={{ textAlign: 'center', maxWidth: 320 }}>
        Fitsy sẽ gợi ý sản phẩm hợp gu bạn từ các KOL/KOC trên Shopee, TikTok Shop và shop ngoài sàn — thử ngay trên ảnh của bạn trước khi mua.
      </AppText>
    </ScrollView>
  );
}
