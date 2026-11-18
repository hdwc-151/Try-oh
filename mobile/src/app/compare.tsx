import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, useTapGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppIcon } from '@/components/icon';
import { AppText } from '@/components/app-text';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius, spacing, useBrandColors } from '@/theme';

const clamp01 = (value: number) => {
  'worklet';
  return Math.min(Math.max(value, 0), 1);
};

/** So sánh ảnh gốc và outfit mới: kéo thanh dọc sang trái/phải, hoặc chạm vào một điểm để nhảy tới đó. */
export default function CompareRoute() {
  const brand = useBrandColors();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ before?: string; after?: string }>();
  const before = typeof params.before === 'string' ? params.before : '';
  const after = typeof params.after === 'string' ? params.after : '';
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const width = useSharedValue(0);
  const position = useSharedValue(0.5);
  const start = useSharedValue(0.5);

  const pan = usePanGesture({
    onBegin: () => {
      'worklet';
      start.set(position.get());
      scheduleOnRN(haptic.light);
    },
    onUpdate: (event) => {
      'worklet';
      if (width.get() > 0) position.set(clamp01(start.get() + event.translationX / width.get()));
    },
  });
  const tap = useTapGesture({
    onActivate: (event) => {
      'worklet';
      if (width.get() > 0) position.set(withSpring(clamp01(event.x / width.get()), { damping: 20, stiffness: 220 }));
    },
  });
  const gesture = useSimultaneousGestures(pan, tap);

  const beforeStyle = useAnimatedStyle(() => ({ width: position.get() * width.get() }));
  const handleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * width.get() - 22 }] }));

  const image = (uri: string) => <Image
    source={protectedImageSource(uri, session?.access_token)}
    style={{ width: frame.width, height: frame.height }}
    contentFit="contain"
    transition={150}
  />;

  return <>
    <Stack.Screen options={{ title: 'Trước / Sau' }}/>
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.md }}>
      {before && after
        ? <GestureDetector gesture={gesture}>
            <View
              accessibilityLabel="So sánh ảnh trước và sau. Kéo sang trái hoặc phải."
              style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.groupedBackground }}
              onLayout={(event) => {
                const layout = event.nativeEvent.layout;
                width.set(layout.width);
                setFrame({ width: layout.width, height: layout.height });
              }}>
              {frame.width > 0 && <>
                {image(after)}
                <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' }, beforeStyle]}>
                  {image(before)}
                </Animated.View>
                <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' }, handleStyle]}>
                  <View style={{ position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: colors.surface, boxShadow: '0 0 6px rgba(20, 26, 60, 0.35)' }}/>
                  <View style={{ width: 44, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: brand.primary, borderWidth: 3, borderColor: colors.surface }}>
                    <AppText style={{ color: colors.onBrand, fontWeight: '800', fontSize: 16 }}>‹›</AppText>
                  </View>
                </Animated.View>
                <Label text="Trước" side="left"/>
                <Label text="Sau" side="right"/>
              </>}
            </View>
          </GestureDetector>
        : <AppText variant="subhead" style={{ textAlign: 'center' }}>Chưa có đủ hai ảnh để so sánh.</AppText>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
        <AppIcon name="sparkles" size={14} color={brand.accent}/>
        <AppText variant="caption">Kéo thanh giữa hoặc chạm vào ảnh để so sánh</AppText>
      </View>
    </View>
  </>;
}

function Label({ text, side }: { text: string; side: 'left' | 'right' }) {
  return <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, [side]: spacing.sm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: 'rgba(20, 26, 60, 0.7)' }}>
    <AppText variant="caption" style={{ color: colors.onBrand, fontWeight: '700' }}>{text}</AppText>
  </View>;
}
