import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppIcon } from '@/components/icon';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { radius, useBrandColors } from '@/theme';

const SWEEP_MS = 1100;
const SPARKLES = [
  { left: '18%', top: '22%', delay: 250, size: 18 },
  { left: '72%', top: '35%', delay: 450, size: 22 },
  { left: '40%', top: '62%', delay: 650, size: 16 },
  { left: '80%', top: '78%', delay: 850, size: 14 },
] as const;

/**
 * Hiệu ứng "thay đồ" khi ảnh mới ra: ảnh cũ phủ lên trên rồi bị một vệt sáng quét từ trên xuống,
 * để lộ dần outfit mới phía dưới, kèm vài dấu lấp lánh. Đặt đè lên ảnh mới (position absolute).
 */
export function RevealOverlay({ from, onDone }: { from: string; onDone: () => void }) {
  const brand = useBrandColors();
  const { session } = useAuth();
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!height) return;
    if (reduceMotion) {
      progress.set(withTiming(1, { duration: 250 }, (finished) => { if (finished) scheduleOnRN(onDone); }));
      return;
    }
    progress.set(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(onDone);
    }));
  }, [height, onDone, progress, reduceMotion]);

  // Phần ảnh cũ còn lại: từ vệt sáng xuống đáy.
  const coverStyle = useAnimatedStyle(() => ({ top: progress.get() * height }));
  // Ảnh cũ bên trong dịch ngược lại để giữ nguyên vị trí khi khung co lại.
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -progress.get() * height }] }));
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.get() * height - 24 }],
    opacity: progress.get() >= 1 ? 0 : 1,
  }));

  return <View
    pointerEvents="none"
    onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.xl, overflow: 'hidden' }}>
    {height > 0 && <>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' }, coverStyle]}>
        <Animated.View style={[{ height }, innerStyle]}>
          <Image source={protectedImageSource(from, session?.access_token)} style={{ width: '100%', height: '100%' }} contentFit="cover"/>
        </Animated.View>
      </Animated.View>
      {!reduceMotion && <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 48 }, lineStyle]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)', 'rgba(239,234,255,0)']}
          locations={[0, 0.5, 1]}
          style={{ flex: 1 }}
        />
      </Animated.View>}
      {!reduceMotion && SPARKLES.map((sparkle) => <Sparkle key={sparkle.left + sparkle.top} {...sparkle} color={brand.sparkle}/>)}
    </>}
  </View>;
}

function Sparkle({ left, top, delay, size, color }: { left: `${number}%`; top: `${number}%`; delay: number; size: number; color: string }) {
  const value = useSharedValue(0);
  useEffect(() => {
    value.set(withDelay(delay, withSequence(withTiming(1, { duration: 260 }), withTiming(0, { duration: 420 }))));
  }, [delay, value]);
  const style = useAnimatedStyle(() => ({ opacity: value.get(), transform: [{ scale: 0.4 + value.get() * 0.8 }, { rotate: value.get() * 40 + 'deg' }] }));
  return <Animated.View style={[{ position: 'absolute', left, top }, style]}>
    <AppIcon name="sparkles" size={size} color={color}/>
  </Animated.View>;
}
