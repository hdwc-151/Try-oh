import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/components/app-text';
import { TryOhMark } from '@/components/fitsy-mark';
import { AppIcon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialPerson } from '@/types/api';

/** Dấu tích xác minh cho tài khoản KOL/KOC (giống tích xanh trên các mạng xã hội). */
export function VerifiedBadge({ size = 16 }: { size?: number }) {
  const brand = useBrandColors();
  return <View accessible accessibilityLabel="Tài khoản KOL/KOC đã xác minh">
    <AppIcon name="verified" size={size} color={brand.accent}/>
  </View>;
}

export function ProfileAvatar({ path, size }: { path?: string | null; size: number }) {
  const { session } = useAuth();
  const source = path ? protectedImageSource(path, session?.access_token, size > 80 ? 320 : 160) : undefined;
  return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground }}>
    {source
      ? <Image source={source} style={{ width: size, height: size }} contentFit="cover" transition={150}/>
      : <TryOhMark size={size}/>}
  </View>;
}

/** Tên hiển thị kèm dấu tích nếu là KOL/KOC. */
export function PersonName({ person, variant = 'headline' }: { person: Pick<SocialPerson, 'name' | 'creator'>; variant?: 'headline' | 'body' }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
    <AppText variant={variant} numberOfLines={1} style={{ flexShrink: 1, fontWeight: '700' }}>{person.name}</AppText>
    {person.creator && <VerifiedBadge size={variant === 'headline' ? 17 : 15}/>}
  </View>;
}

const compact = (value: number) => value >= 10_000
  ? (value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace('.0', '') + 'K'
  : value.toLocaleString('vi-VN');

export function ProfileStat({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  const content = <View style={{ alignItems: 'flex-start', gap: 1 }}>
    <AppText variant="headline" style={{ fontSize: 18 }}>{compact(value)}</AppText>
    <AppText variant="subhead" style={{ fontSize: 13 }}>{label}</AppText>
  </View>;
  if (!onPress) return <View accessible accessibilityLabel={`${value} ${label}`}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${value} ${label}`} hitSlop={8} onPress={onPress}>{content}</Pressable>;
}

/** Nút viên thuốc cạnh tên: đen (Theo dõi) hoặc viền (Đang theo dõi / Sửa hồ sơ). */
export function PillButton({ title, onPress, variant = 'solid', loading = false, disabled = false, compactSize = false }: {
  title: string;
  onPress?: () => void;
  variant?: 'solid' | 'outline';
  loading?: boolean;
  disabled?: boolean;
  compactSize?: boolean;
}) {
  const brand = useBrandColors();
  const solid = variant === 'solid';
  return <PressableScale
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled: disabled || loading, busy: loading }}
    disabled={disabled || loading}
    onPress={onPress}
    style={{
      minWidth: compactSize ? 92 : 104,
      minHeight: compactSize ? 34 : 40,
      paddingHorizontal: compactSize ? spacing.md : spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: solid ? brand.primary : colors.separator,
      backgroundColor: solid ? brand.primary : colors.surface,
      opacity: disabled ? 0.5 : 1,
    }}>
    {loading
      ? <ActivityIndicator color={solid ? colors.onBrand : (brand.primary as string)}/>
      : <AppText variant="subhead" style={{ fontWeight: '700', fontSize: compactSize ? 13 : 14, color: solid ? colors.onBrand : colors.label }}>{title}</AppText>}
  </PressableScale>;
}

/** Tab gạch chân như mẫu (Clothes / Outfits). */
export function UnderlineTabs<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const brand = useBrandColors();
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.separator }}>
    {options.map((option) => {
      const active = option.value === value;
      return <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={() => onChange(option.value)}
        style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 4, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: active ? brand.primary : 'transparent' }}>
        <AppText variant="body" style={{ fontWeight: active ? '700' : '500', color: active ? colors.label : colors.secondaryLabel }}>{option.label}</AppText>
      </Pressable>;
    })}
  </View>;
}

/** Hàng chip lọc cuộn ngang (Tất cả, Áo, Quần…). */
export function FilterChips<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const brand = useBrandColors();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 }}>
    {options.map((option) => {
      const active = option.value === value;
      return <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onChange(option.value)}
        style={{ paddingHorizontal: spacing.sm + 4, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: active ? brand.primary : 'transparent' }}>
        <AppText variant="subhead" style={{ fontSize: 13, fontWeight: active ? '700' : '500', color: active ? colors.onBrand : colors.secondaryLabel }}>{option.label}</AppText>
      </Pressable>;
    })}
  </ScrollView>;
}

export type GridItem = { key: string; path: string; title?: string };

/**
 * Lưới ảnh 3 cột. `fit="contain"` cho món đồ đã tách nền (nền trắng như mẫu),
 * `fit="cover"` cho ảnh outfit/bài đăng. Chạm để mở trình xem ảnh.
 */
export function ImageGrid({ items, fit = 'contain', aspectRatio = 1, columns = 3 }: { items: GridItem[]; fit?: 'contain' | 'cover'; aspectRatio?: number; columns?: number }) {
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const gap = 2;
  const cell = Math.floor((width - gap * (columns - 1)) / columns);
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
    {items.map((item) => <PressableScale
      key={item.key}
      scaleTo={0.97}
      accessibilityRole="imagebutton"
      accessibilityLabel={item.title ?? 'Xem ảnh'}
      onPress={() => router.push({ pathname: '/image-viewer', params: { uri: item.path, title: item.title ?? 'Xem ảnh' } })}
      style={{ width: cell, height: Math.round(cell / aspectRatio), backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={protectedImageSource(item.path, session?.access_token, 320)}
        style={{ width: fit === 'contain' ? cell - spacing.md : cell, height: fit === 'contain' ? Math.round(cell / aspectRatio) - spacing.md : Math.round(cell / aspectRatio) }}
        contentFit={fit}
        transition={150}
        recyclingKey={item.key}/>
    </PressableScale>)}
  </View>;
}

export function GridEmpty({ icon = 'grid', title, text }: { icon?: 'grid' | 'hanger' | 'sparkles' | 'people'; title: string; text?: string }) {
  return <View style={{ alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg }}>
    <AppIcon name={icon} size={30} color={colors.secondaryLabel}/>
    <AppText variant="headline" style={{ marginTop: spacing.xs, textAlign: 'center' }}>{title}</AppText>
    {text && <AppText variant="subhead" style={{ textAlign: 'center' }}>{text}</AppText>}
  </View>;
}
