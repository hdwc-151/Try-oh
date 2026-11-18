import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useNow } from '@/hooks/use-now';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource } from '@/services/api-client';
import { categoryNames } from '@/screens/wardrobe';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { Garment, GarmentCategory, GarmentColorItem, PageResponse, SavedOutfit } from '@/types/api';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;
const MAX_PAGES = 10;

/** Tải hết các trang (tối đa 1.000 mục) để thống kê trên cả tủ đồ, không chỉ trang đầu. */
async function fetchAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let offset: number | null = 0;
  for (let page = 0; offset !== null && page < MAX_PAGES; page += 1) {
    const response: PageResponse<T> = await apiRequest<PageResponse<T>>(`${path}?limit=${PAGE}&offset=${offset}`);
    items.push(...response.items);
    offset = response.nextOffset;
  }
  return items;
}

export default function WardrobeInsightsRoute() {
  const brand = useBrandColors();
  const { session } = useAuth();
  const garments = useQuery({ queryKey: ['insights', 'garments'], queryFn: () => fetchAll<Garment>('/api/garments') });
  const outfits = useQuery({ queryKey: ['insights', 'outfits'], queryFn: () => fetchAll<SavedOutfit>('/api/generations/outfits') });
  const now = useNow(60_000);
  const palette = useQuery({ queryKey: ['insights', 'colors'], queryFn: () => apiRequest<{ items: GarmentColorItem[] }>('/api/garments/colors'), staleTime: 10 * 60_000 });

  const stats = useMemo(() => {
    const items = garments.data ?? [];
    const looks = outfits.data ?? [];
    const byCategory = (Object.keys(categoryNames) as GarmentCategory[])
      .map((category) => ({ category, count: items.filter((item) => item.category === category).length }));
    const usage = new Map<string, number>();
    const recent = new Set<string>();
    const monthAgo = now - 30 * DAY_MS;
    for (const look of looks) {
      for (const id of look.garmentIds) {
        usage.set(id, (usage.get(id) ?? 0) + 1);
        if (new Date(look.createdAt).getTime() >= monthAgo) recent.add(id);
      }
    }
    const favorites = items
      .map((item) => ({ item, count: usage.get(item.id) ?? 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    // "Ngủ quên": có trong tủ hơn 1 tuần mà 30 ngày qua chưa vào outfit nào.
    const dormant = items
      .filter((item) => !recent.has(item.id) && now - new Date(item.createdAt).getTime() > 7 * DAY_MS)
      .slice(0, 8);
    const groups = new Map<string, { name: string; hex: string; count: number }>();
    for (const entry of palette.data?.items ?? []) {
      if (!entry.name || !entry.hex || !items.some((item) => item.id === entry.id)) continue;
      const group = groups.get(entry.name) ?? { name: entry.name, hex: entry.hex, count: 0 };
      group.count += 1;
      groups.set(entry.name, group);
    }
    const colorGroups = [...groups.values()].sort((a, b) => b.count - a.count);
    return { total: items.length, outfitTotal: looks.length, byCategory, favorites, dormant, colorGroups };
  }, [garments.data, outfits.data, palette.data, now]);

  const error = garments.error ?? outfits.error;
  if (error) return <ScreenError message={error instanceof Error ? error.message : 'Không thể tải thống kê.'} onRetry={() => { void garments.refetch(); void outfits.refetch(); }}/>;
  if (!garments.data || !outfits.data) return <ScreenLoading variant="cards" label="Đang soi tủ đồ…"/>;

  const topColor = stats.colorGroups[0];
  const coloredTotal = stats.colorGroups.reduce((sum, group) => sum + group.count, 0);
  const maxCategory = Math.max(1, ...stats.byCategory.map((entry) => entry.count));
  const headline = topColor && coloredTotal
    ? `Tủ đồ của bạn nghiêng về màu ${topColor.name.toLowerCase()} — ${Math.round(topColor.count / coloredTotal * 100)}% số món.`
    : `${stats.total} món đồ, ${stats.outfitTotal} outfit đã tạo.`;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}>
    <Animated.View entering={FadeInDown.duration(320)} style={{ gap: spacing.xs, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: brand.primary }}>
      <AppText variant="caption" style={{ color: colors.onBrand, opacity: 0.7, fontWeight: '800', letterSpacing: 0.6 }}>TỦ ĐỒ CỦA BẠN</AppText>
      <AppText variant="title" style={{ color: colors.onBrand }}>{headline}</AppText>
      <AppText variant="caption" style={{ color: colors.onBrand, opacity: 0.8 }}>{stats.total} món · {stats.outfitTotal} outfit đã tạo</AppText>
    </Animated.View>

    {stats.colorGroups.length > 0 && <Section title="Bảng màu" delay={80}>
      <View style={{ flexDirection: 'row', height: 28, borderRadius: radius.full, overflow: 'hidden' }}>
        {stats.colorGroups.map((group) => <View key={group.name} style={{ flex: group.count, backgroundColor: group.hex }}/>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {stats.colorGroups.map((group) => <View key={group.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.surface }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: group.hex, borderWidth: 1, borderColor: colors.separator }}/>
          <AppText variant="caption" style={{ color: colors.label }}>{group.name} · {group.count}</AppText>
        </View>)}
      </View>
    </Section>}
    {palette.isLoading && <AppText variant="caption" style={{ textAlign: 'center' }}>Đang phân tích màu sắc…</AppText>}

    <Section title="Theo loại" delay={160}>
      {stats.byCategory.map((entry, index) => <View key={entry.category} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <AppText variant="caption" style={{ width: 72, color: colors.label }}>{categoryNames[entry.category]}</AppText>
        <Bar value={entry.count / maxCategory} delay={200 + index * 80} color={brand.accent}/>
        <AppText variant="caption" style={{ width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{entry.count}</AppText>
      </View>)}
    </Section>

    <Section title="Được phối nhiều nhất" delay={240}>
      {stats.favorites.length === 0
        ? <AppText variant="subhead">Tạo vài outfit là bảng xếp hạng sẽ hiện ở đây.</AppText>
        : <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {stats.favorites.map(({ item, count }, index) => <View key={item.id} style={{ flex: 1, gap: 4, alignItems: 'center' }}>
              <View style={{ width: '100%', aspectRatio: 1, borderRadius: radius.lg, padding: spacing.xs, backgroundColor: colors.surface }}>
                <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ flex: 1 }} contentFit="contain"/>
                <View style={{ position: 'absolute', top: 6, left: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: index === 0 ? brand.sparkle : brand.primary }}>
                  <AppText style={{ color: colors.onBrand, fontSize: 12, fontWeight: '800' }}>{index + 1}</AppText>
                </View>
              </View>
              <AppText variant="caption" numberOfLines={1} style={{ color: colors.label }}>{item.name}</AppText>
              <AppText variant="caption">{count} outfit</AppText>
            </View>)}
          </View>}
    </Section>

    <Section title="Đang ngủ quên" delay={320}>
      {stats.dormant.length === 0
        ? <AppText variant="subhead">Món nào cũng được dùng gần đây. Tủ đồ rất “sống”! ✨</AppText>
        : <>
            <AppText variant="caption">30 ngày qua chưa vào outfit nào — thử phối lại xem sao.</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {stats.dormant.map((item) => <View key={item.id} style={{ width: 84, gap: 4 }}>
                <View style={{ width: 84, height: 84, borderRadius: radius.md, padding: 4, backgroundColor: colors.surface, opacity: 0.85 }}>
                  <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ flex: 1 }} contentFit="contain"/>
                </View>
                <AppText variant="caption" numberOfLines={1}>{item.name}</AppText>
              </View>)}
            </ScrollView>
          </>}
    </Section>
  </ScrollView>;
}

function Section({ title, delay, children }: { title: string; delay: number; children: ReactNode }) {
  return <Animated.View entering={FadeInDown.delay(delay).duration(320)} style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface, boxShadow: '0 1px 3px rgba(17, 23, 25, 0.06)' }}>
    <AppText variant="headline">{title}</AppText>
    {children}
  </Animated.View>;
}

function Bar({ value, delay, color }: { value: number; delay: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withDelay(delay, withTiming(value, { duration: 600, easing: Easing.out(Easing.cubic) })));
  }, [delay, progress, value]);
  const style = useAnimatedStyle(() => ({ width: `${Math.max(progress.get() * 100, 2)}%` }));
  return <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.groupedBackground, overflow: 'hidden' }}>
    <Animated.View style={[{ height: 10, borderRadius: 5, backgroundColor: color }, style]}/>
  </View>;
}
