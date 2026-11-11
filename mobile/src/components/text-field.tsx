import { useState, type ComponentProps } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, radius, spacing, useBrandColors } from '@/theme';

type TextFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  /** Có giá trị thì ô là ô mật khẩu với nút Hiện/Ẩn. */
  passwordVisible?: boolean;
  onTogglePasswordVisible?: () => void;
  error?: boolean;
};

/** Ô nhập có nhãn, viền đổi màu khi đang gõ; dùng chung cho đăng nhập và cài đặt. */
export function TextField({ label, passwordVisible, onTogglePasswordVisible, error = false, onFocus, onBlur, editable, ref, ...props }: TextFieldProps) {
  const brand = useBrandColors();
  const [focused, setFocused] = useState(false);
  const isPassword = passwordVisible !== undefined;
  const borderColor = error ? colors.destructive : focused ? brand.accent : colors.separator;
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="caption" style={{ color: colors.label, fontWeight: '700' }}>{label}</AppText>
      <View style={{
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: focused ? 1.5 : 1,
        borderColor,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        backgroundColor: editable === false ? colors.groupedBackground : colors.surface,
        boxShadow: focused ? '0 0 0 3px rgba(110, 75, 242, 0.12)' : undefined,
      }}>
        <TextInput
          ref={ref}
          {...props}
          editable={editable}
          accessibilityLabel={props.accessibilityLabel ?? label}
          secureTextEntry={isPassword ? !passwordVisible : props.secureTextEntry}
          placeholderTextColor={colors.secondaryLabel}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          style={{ flex: 1, minHeight: 50, paddingHorizontal: spacing.md, color: editable === false ? colors.secondaryLabel : colors.label, fontSize: 16 }}
        />
        {isPassword && onTogglePasswordVisible && <Pressable
          accessibilityRole="button"
          accessibilityLabel={passwordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          onPress={onTogglePasswordVisible}
          hitSlop={8}
          style={({ pressed }) => ({ paddingHorizontal: spacing.md, opacity: pressed ? 0.55 : 1 })}>
          <AppText selectable={false} variant="caption" style={{ color: brand.accent, fontWeight: '800' }}>
            {passwordVisible ? 'Ẩn' : 'Hiện'}
          </AppText>
        </Pressable>}
      </View>
    </View>
  );
}
