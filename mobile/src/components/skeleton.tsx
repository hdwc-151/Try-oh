import { useEffect } from 'react';
import { View, useWindowDimensions, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';

/** Khối giữ chỗ nhấp nháy nhẹ trong lúc tải. */
export function SkeletonBlock({ width = '100%', height = 16, rounded = radius.md, style }: {
  width?: DimensionValue;
  height?: DimensionValue;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.get() * 0.4 }));
  return <Animated.View style={[{ width, height, borderRadius: rounded, borderCurve: 'continuous', backgroundColor: colors.separator }, style, animated]}/>;
}

function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: spacing.sm, padding: spacing.sm, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }, style]}>{children}</View>;
}

/** Bố cục giữ chỗ cho lưới thẻ (tủ đồ, outfit). */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 3 : 2;
  const itemWidth = Math.floor((width - spacing.md * 2 - spacing.md * (columns - 1)) / columns);
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
    {Array.from({ length: count }, (_, index) => <Card key={index} style={{ width: itemWidth }}>
      <SkeletonBlock height={itemWidth - spacing.sm * 2} rounded={radius.lg}/>
      <SkeletonBlock width="70%" height={14}/>
      <SkeletonBlock width="40%" height={10}/>
    </Card>)}
  </View>;
}

/** Bố cục giữ chỗ cho danh sách hàng (bạn bè, cài đặt). */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return <Card style={{ padding: spacing.md }}>
    <SkeletonBlock width="45%" height={18}/>
    {Array.from({ length: rows }, (_, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}>
      <SkeletonBlock width={48} height={48} rounded={24}/>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <SkeletonBlock width="60%" height={14}/>
        <SkeletonBlock width="35%" height={10}/>
      </View>
    </View>)}
  </Card>;
}
