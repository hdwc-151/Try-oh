import { ActivityIndicator, type StyleProp, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/app-text';
import { AppIcon, type AppIconName } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { colors, radius, spacing, useBrandColors } from '@/theme';

export function AppButton({
  title,
  onPress,
  loading = false,
  loadingTitle,
  disabled = false,
  variant = 'primary',
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  /** Chữ hiện cạnh vòng quay khi `loading` (mặc định chỉ có vòng quay). */
  loadingTitle?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
  icon?: AppIconName;
  style?: StyleProp<ViewStyle>;
}) {
  const brand = useBrandColors();
  const backgroundColor = variant === 'primary' ? brand.primary : variant === 'destructive' ? colors.destructive : colors.surface;
  const textColor = variant === 'primary' || variant === 'destructive' ? colors.onBrand : colors.label;
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading, disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      scaleTo={0.97}
      style={[{
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        backgroundColor,
        borderRadius: radius.full,
        borderCurve: 'continuous',
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: colors.separator,
        // Đang tải vẫn giữ màu đầy đủ; chỉ nút bị khoá mới mờ đi.
        opacity: disabled && !loading ? 0.45 : 1,
      }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {loading
          ? <ActivityIndicator color={textColor as string}/>
          : icon && <AppIcon name={icon} size={20} color={textColor}/>}
        {(!loading || loadingTitle) && <AppText selectable={false} variant="headline" numberOfLines={1} style={{ color: textColor, flexShrink: 1 }}>{loading && loadingTitle ? loadingTitle : title}</AppText>}
      </View>
    </PressableScale>
  );
}
