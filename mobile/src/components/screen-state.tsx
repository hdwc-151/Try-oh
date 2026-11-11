import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { GridSkeleton, ListSkeleton, SkeletonBlock } from '@/components/skeleton';
import { colors, radius, spacing, useBrandColors } from '@/theme';

type LoadingVariant = 'spinner' | 'grid' | 'list' | 'cards';

/**
 * Trạng thái đang tải. Các biến thể khung xương giữ đúng bố cục màn sắp hiện, nên lúc dữ liệu về
 * nội dung không "nhảy"; `label` vẫn được đọc cho trình đọc màn hình.
 */
export function ScreenLoading({ label = 'Đang tải…', variant = 'spinner' }: { label?: string; variant?: LoadingVariant }) {
  const brand = useBrandColors();
  if (variant === 'spinner') {
    return <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
      <ActivityIndicator color={brand.primary as string}/>
      <AppText variant="subhead">{label}</AppText>
    </View>;
  }
  return <ScrollView
    scrollEnabled={false}
    accessibilityRole="progressbar"
    accessibilityLabel={label}
    contentInsetAdjustmentBehavior="automatic"
    style={{ backgroundColor: colors.background }}
    contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
    {variant === 'grid' && <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <SkeletonBlock width={140} height={18}/>
        <SkeletonBlock width={40} height={14}/>
      </View>
      <SkeletonBlock height={52} rounded={radius.full}/>
      <GridSkeleton/>
    </>}
    {variant === 'list' && <>
      <SkeletonBlock height={96} rounded={radius.xl}/>
      <ListSkeleton/>
    </>}
    {variant === 'cards' && <>
      <SkeletonBlock height={220} rounded={radius.xl}/>
      <SkeletonBlock height={140} rounded={radius.xl}/>
      <SkeletonBlock height={52} rounded={radius.full}/>
    </>}
  </ScrollView>;
}

export function ScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const brand = useBrandColors();
  return <Animated.View entering={FadeIn.duration(200)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md }}>
    <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
      <AppIcon name="cloudOff" size={30} color={brand.accent}/>
    </View>
    <AppText variant="headline" style={{ textAlign: 'center' }}>Chưa thể tải dữ liệu</AppText>
    <AppText variant="subhead" style={{ textAlign: 'center', maxWidth: 320 }}>{message}</AppText>
    <AppButton title="Thử lại" onPress={onRetry} style={{ alignSelf: 'stretch', maxWidth: 320, width: '100%' }}/>
  </Animated.View>;
}
