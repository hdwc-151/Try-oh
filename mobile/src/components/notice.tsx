import { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { colors, radius, spacing, useBrandColors } from '@/theme';

export type NoticeTone = 'error' | 'success' | 'info';

/**
 * Thông báo trong trang: hiện/ẩn bằng hiệu ứng mờ dần. Có `onDismiss` + `autoHideMs`
 * thì tự ẩn (dùng cho thông báo thành công; lỗi nên giữ tới khi người dùng thao tác lại).
 */
export function Notice({ tone, text, title, onDismiss, autoHideMs, style }: {
  tone: NoticeTone;
  text: string;
  title?: string;
  onDismiss?: () => void;
  autoHideMs?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const brand = useBrandColors();
  useEffect(() => {
    if (!onDismiss || !autoHideMs) return;
    const timer = setTimeout(onDismiss, autoHideMs);
    return () => clearTimeout(timer);
  }, [onDismiss, autoHideMs, text]);
  const palette = tone === 'error'
    ? { background: colors.destructiveBackground, border: '#F2CACA', text: colors.destructive }
    : tone === 'success'
      ? { background: colors.successBackground, border: '#C8E6D3', text: colors.success }
      : { background: brand.secondary, border: '#DCD3FF', text: brand.primary };
  return <Animated.View
    entering={FadeIn.duration(200)}
    exiting={FadeOut.duration(160)}
    accessibilityRole={tone === 'error' ? 'alert' : 'text'}
    accessibilityLiveRegion="polite"
    style={[{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: palette.background }, style]}>
    {title && <AppText variant="headline" style={{ color: palette.text }}>{title}</AppText>}
    <AppText variant="subhead" style={{ color: title ? colors.label : palette.text, fontWeight: title ? '400' : '600' }}>{text}</AppText>
  </Animated.View>;
}
