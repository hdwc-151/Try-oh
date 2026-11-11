import { useEffect, useState } from 'react';
import { Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { AppIcon, type AppIconName } from '@/components/icon';
import { colors, radius, spacing, useBrandColors } from '@/theme';

export type SegmentOption<T extends string> = { value: T; label: string; icon?: AppIconName; accessibilityLabel?: string };

const INDICATOR_SPRING = { damping: 22, stiffness: 260, mass: 0.8 };

/**
 * Công tắc nhiều lựa chọn có "viên" nền trượt theo mục đang chọn.
 * `stretch` chia đều bề ngang; không stretch thì mỗi mục rộng theo nội dung.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  stretch = false,
  size = 'regular',
  trackColor = colors.surface,
  indicatorColor,
  activeColor = colors.onBrand,
  inactiveColor,
  trackStyle,
  indicatorStyle,
  labelStyle,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  stretch?: boolean;
  size?: 'compact' | 'regular' | 'large';
  trackColor?: string;
  indicatorColor?: string;
  activeColor?: string;
  inactiveColor?: string;
  trackStyle?: StyleProp<ViewStyle>;
  indicatorStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const brand = useBrandColors();
  const reduceMotion = useReducedMotion();
  const [layouts, setLayouts] = useState<Partial<Record<T, { x: number; width: number }>>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useSharedValue(false);
  const padding = size === 'compact' ? 3 : 4;
  const itemStyle: ViewStyle = size === 'compact'
    ? { minHeight: 26, paddingHorizontal: 12 }
    : size === 'large'
      ? { minHeight: 46, paddingHorizontal: spacing.md + 2 }
      : { minHeight: 40, paddingHorizontal: spacing.md };

  const target = layouts[value];
  useEffect(() => {
    if (!target) return;
    if (!placed.get() || reduceMotion) {
      // Lần đo đầu tiên: đặt thẳng vào chỗ, không trượt từ mép trái vào.
      x.set(target.x);
      width.set(target.width);
      placed.set(true);
      return;
    }
    x.set(withSpring(target.x, INDICATOR_SPRING));
    width.set(withSpring(target.width, INDICATOR_SPRING));
  }, [target, reduceMotion, x, width, placed]);

  const indicator = useAnimatedStyle(() => ({
    opacity: placed.get() ? 1 : 0,
    width: width.get(),
    transform: [{ translateX: x.get() }],
  }));

  return <View
    accessibilityRole="tablist"
    style={[{ flexDirection: 'row', padding, borderRadius: radius.full, backgroundColor: trackColor }, trackStyle]}>
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top: padding, bottom: padding, left: 0, borderRadius: radius.full, borderCurve: 'continuous', backgroundColor: indicatorColor ?? brand.primary }, indicatorStyle, indicator]}
    />
    {options.map((option) => {
      const active = option.value === value;
      const tint = active ? activeColor : inactiveColor ?? brand.primary;
      return <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={option.accessibilityLabel ?? option.label}
        hitSlop={size === 'compact' ? 6 : undefined}
        onLayout={(event) => {
          const { x: left, width: itemWidth } = event.nativeEvent.layout;
          setLayouts((current) => {
            const previous = current[option.value];
            return previous && previous.x === left && previous.width === itemWidth ? current : { ...current, [option.value]: { x: left, width: itemWidth } };
          });
        }}
        onPress={() => { if (!active) onChange(option.value); }}
        style={({ pressed }) => [{
          flex: stretch ? 1 : undefined,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          borderRadius: radius.full,
          opacity: pressed && !active ? 0.6 : 1,
        }, itemStyle]}>
        {option.icon && <AppIcon name={option.icon} size={size === 'large' ? 20 : 18} color={tint}/>}
        {/* Một dòng + chữ đậm cố định cho mọi trạng thái: Android không đo lại bề rộng khi đổi độ đậm nên chữ bị xuống dòng. */}
        <AppText
          selectable={false}
          numberOfLines={1}
          variant={size === 'compact' ? 'caption' : size === 'large' ? 'body' : 'subhead'}
          style={[{ color: tint, fontWeight: '700', textAlign: 'center' }, labelStyle]}>
          {option.label}
        </AppText>
      </Pressable>;
    })}
  </View>;
}
