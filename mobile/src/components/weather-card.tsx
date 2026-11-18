import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { readWeatherCity, writeWeatherCity } from '@/services/device-store';
import { haptic } from '@/services/haptics';
import { pickOutfit, seededRandom } from '@/services/outfit-picker';
import { CITIES, DEFAULT_CITY, describeWeather, fetchWeather } from '@/services/weather';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { Garment } from '@/types/api';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

/**
 * Thẻ "Hôm nay mặc gì": thời tiết thành phố đã chọn + một bộ ghép từ tủ đồ hợp thời tiết.
 * Cùng ngày, cùng thành phố thì gợi ý giữ nguyên; bấm "Đổi bộ khác" để xoay vòng.
 */
export function WeatherCard({ garments, maxItems, onApply }: { garments: Garment[]; maxItems: number; onApply: (ids: string[]) => void }) {
  const brand = useBrandColors();
  const { session } = useAuth();
  const [cityId, setCityId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => { void readWeatherCity().then((id) => setCityId(id ?? DEFAULT_CITY.id)); }, []);
  const city = CITIES.find((item) => item.id === cityId) ?? DEFAULT_CITY;
  const weather = useQuery({
    queryKey: ['weather', city.id],
    queryFn: ({ signal }) => fetchWeather(city, signal),
    enabled: cityId !== null,
    staleTime: 30 * 60_000,
    retry: 1,
  });

  const suggestion = useMemo(() => pickOutfit(garments, {
    random: seededRandom(`${today()}|${city.id}|${round}|${garments.length}`),
    maxItems,
    weather: weather.data ?? null,
  }), [garments, city.id, round, maxItems, weather.data]);
  const items = suggestion.ids.map((id) => garments.find((item) => item.id === id)).filter((item): item is Garment => Boolean(item));
  const look = weather.data ? describeWeather(weather.data.code) : null;

  const chooseCity = (id: string) => {
    haptic.select();
    setCityId(id);
    setPicking(false);
    setRound(0);
    void writeWeatherCity(id);
  };

  return <Animated.View entering={FadeInDown.duration(320)} layout={LinearTransition.duration(220)} style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: brand.secondary }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <AppText style={{ fontSize: 34 }}>{look?.emoji ?? '🌤️'}</AppText>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="caption" style={{ color: brand.accent, fontWeight: '800', letterSpacing: 0.6 }}>HÔM NAY MẶC GÌ?</AppText>
        {weather.data
          ? <AppText variant="headline">{Math.round(weather.data.temperature)}°C · {look?.text}{weather.data.rainChance >= 30 ? ` · mưa ${weather.data.rainChance}%` : ''}</AppText>
          : <AppText variant="subhead">{weather.isError ? 'Chưa tải được thời tiết' : 'Đang xem trời…'}</AppText>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Đổi thành phố, đang chọn ${city.name}`} hitSlop={8} onPress={() => setPicking((value) => !value)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surface }}>
        <AppText variant="caption" style={{ color: brand.primary, fontWeight: '700' }}>{city.name}</AppText>
        <AppIcon name="chevronRight" size={12} color={brand.primary}/>
      </Pressable>
    </View>

    {picking && <Animated.View entering={FadeIn.duration(160)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {CITIES.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: item.id === city.id }} onPress={() => chooseCity(item.id)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: item.id === city.id ? brand.primary : colors.surface }}>
          <AppText variant="caption" style={{ fontWeight: '700', color: item.id === city.id ? colors.onBrand : colors.secondaryLabel }}>{item.name}</AppText>
        </Pressable>)}
      </ScrollView>
    </Animated.View>}

    {items.length >= 2 && <>
      <View style={{ flexDirection: 'row', gap: spacing.xs }}>
        {items.map((item, index) => <Animated.View key={item.id + round} entering={FadeInDown.delay(index * 70).duration(260)} style={{ flex: 1, maxWidth: 76, aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface, padding: 4 }}>
          <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ flex: 1 }} contentFit="contain" transition={160}/>
        </Animated.View>)}
      </View>
      {suggestion.reason && <AppText variant="caption" style={{ color: colors.label }}>{suggestion.reason}</AppText>}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Chọn bộ này để thử" onPress={() => { haptic.success(); onApply(suggestion.ids); }}
          style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: brand.primary }}>
          <AppText variant="caption" style={{ color: colors.onBrand, fontWeight: '800', fontSize: 13 }}>Chọn bộ này</AppText>
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel="Đổi bộ khác" onPress={() => { haptic.light(); setRound((value) => value + 1); }}
          style={{ minHeight: 40, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: colors.surface }}>
          <AppText variant="caption" style={{ color: brand.primary, fontWeight: '800', fontSize: 13 }}>Đổi bộ khác</AppText>
        </PressableScale>
      </View>
    </>}
  </Animated.View>;
}
