import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { colors, spacing } from '@/theme';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** Ở mức thu phóng gốc, kéo dọc quá khoảng này thì đóng trình xem. */
const DISMISS_DISTANCE = 120;
const SPRING = { damping: 22, stiffness: 220 };

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.min(Math.max(value, min), max);
};

/**
 * Trình xem ảnh: chụm để phóng to (cả iOS lẫn Android — ScrollView zoom chỉ chạy trên iOS),
 * chạm đúp để phóng/thu, kéo khi đang phóng để di chuyển, kéo dọc ở mức gốc để đóng.
 */
export default function ImageViewerRoute() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ uri?: string; title?: string }>();
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const title = typeof params.title === 'string' ? params.title : 'Xem ảnh';
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const close = () => { if (router.canGoBack()) router.back(); };

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const frameWidth = useSharedValue(0);
  const frameHeight = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.set(withSpring(1, SPRING));
    translateX.set(withSpring(0, SPRING));
    translateY.set(withSpring(0, SPRING));
    savedScale.set(1);
    savedX.set(0);
    savedY.set(0);
  };

  const pinch = usePinchGesture({
    onUpdate: (event) => {
      'worklet';
      scale.set(clamp(savedScale.get() * event.scale, 0.8, MAX_SCALE));
    },
    onDeactivate: () => {
      'worklet';
      if (scale.get() <= 1) { reset(); return; }
      savedScale.set(scale.get());
      const maxX = (frameWidth.get() * (scale.get() - 1)) / 2;
      const maxY = (frameHeight.get() * (scale.get() - 1)) / 2;
      translateX.set(withSpring(clamp(translateX.get(), -maxX, maxX), SPRING));
      translateY.set(withSpring(clamp(translateY.get(), -maxY, maxY), SPRING));
      savedX.set(clamp(translateX.get(), -maxX, maxX));
      savedY.set(clamp(translateY.get(), -maxY, maxY));
    },
  });

  const pan = usePanGesture({
    averageTouches: true,
    onUpdate: (event) => {
      'worklet';
      if (savedScale.get() <= 1) {
        // Chưa phóng: chỉ cho kéo dọc để đóng.
        translateY.set(event.translationY);
        return;
      }
      const maxX = (frameWidth.get() * (scale.get() - 1)) / 2;
      const maxY = (frameHeight.get() * (scale.get() - 1)) / 2;
      translateX.set(clamp(savedX.get() + event.translationX, -maxX, maxX));
      translateY.set(clamp(savedY.get() + event.translationY, -maxY, maxY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (savedScale.get() <= 1) {
        if (Math.abs(event.translationY) > DISMISS_DISTANCE || Math.abs(event.velocityY) > 1200) {
          translateY.set(withTiming(Math.sign(event.translationY || 1) * frameHeight.get(), { duration: 180 }));
          scheduleOnRN(close);
        } else {
          translateY.set(withSpring(0, SPRING));
        }
        return;
      }
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (event) => {
      'worklet';
      if (savedScale.get() > 1) { reset(); return; }
      // Phóng quanh điểm chạm thay vì luôn quanh tâm ảnh.
      const maxX = (frameWidth.get() * (DOUBLE_TAP_SCALE - 1)) / 2;
      const maxY = (frameHeight.get() * (DOUBLE_TAP_SCALE - 1)) / 2;
      const nextX = clamp((frameWidth.get() / 2 - event.x) * (DOUBLE_TAP_SCALE - 1), -maxX, maxX);
      const nextY = clamp((frameHeight.get() / 2 - event.y) * (DOUBLE_TAP_SCALE - 1), -maxY, maxY);
      scale.set(withSpring(DOUBLE_TAP_SCALE, SPRING));
      translateX.set(withSpring(nextX, SPRING));
      translateY.set(withSpring(nextY, SPRING));
      savedScale.set(DOUBLE_TAP_SCALE);
      savedX.set(nextX);
      savedY.set(nextY);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }, { translateY: translateY.get() }, { scale: scale.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => {
    const dragging = savedScale.get() <= 1 && frameHeight.get() > 0;
    return { opacity: dragging ? 1 - Math.min(Math.abs(translateY.get()) / (frameHeight.get() * 0.8), 0.6) : 1 };
  });

  return (
    <>
      <Stack.Screen options={{ title }} />
      {uri
        ? <View
            style={{ flex: 1, overflow: 'hidden', backgroundColor: colors.background }}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              frameWidth.set(width);
              frameHeight.set(height);
              setFrame({ width, height });
            }}>
            <GestureDetector gesture={gesture}>
              <Animated.View style={[{ flex: 1 }, backdropStyle]}>
                <Animated.View style={[{ width: frame.width, height: frame.height }, imageStyle]}>
                  <Image
                    accessibilityLabel={title}
                    accessibilityHint="Chụm hoặc chạm đúp để phóng to"
                    source={protectedImageSource(uri, session?.access_token)}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                    transition={200}
                  />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </View>
        : <AppText variant="subhead" style={{ padding: spacing.lg, textAlign: 'center' }}>Không tìm thấy ảnh.</AppText>}
    </>
  );
}
