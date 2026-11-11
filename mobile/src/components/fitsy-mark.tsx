import { Image } from 'expo-image';
import { View } from 'react-native';

import { AppText } from '@/components/app-text';
import { shadows, useBrandColors } from '@/theme';

/** Chữ "Fitsy" kèm dấu lấp lánh, dùng cho header và màn đăng nhập. */
export function FitsyWordmark({ size = 30 }: { size?: number }) {
  const brand = useBrandColors();
  return <View accessibilityRole="header" accessibilityLabel="Fitsy" style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
    <AppText selectable={false} style={{ fontSize: size, lineHeight: size * 1.15, fontWeight: '800', letterSpacing: -0.6, color: brand.primary }}>Fitsy</AppText>
    <AppText selectable={false} style={{ fontSize: size * 0.5, lineHeight: size * 0.6, fontWeight: '800', color: brand.sparkle, marginLeft: 2 }}>✦</AppText>
  </View>;
}

/** Ô vuông logo (avatar mặc định, màn đăng nhập) — dùng chính icon app. */
export function FitsyMark({ size = 58 }: { size?: number }) {
  return <View accessibilityRole="image" accessibilityLabel="Fitsy" style={{ width: size, height: size, borderRadius: size * 0.28, borderCurve: 'continuous', overflow: 'hidden', boxShadow: shadows.raised }}>
    <Image source={require('../../assets/images/icon.png')} contentFit="cover" style={{ width: size, height: size }} />
  </View>;
}
