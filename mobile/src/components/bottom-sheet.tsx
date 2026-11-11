import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal as NativeModal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { AppText } from '@/components/app-text';
import { colors, radius, spacing } from '@/theme';

const OPEN_MS = 320;
const CLOSE_MS = 220;
/** Vuốt quá tỉ lệ chiều cao này (hoặc vuốt nhanh) thì đóng. */
const DISMISS_RATIO = 0.25;
const DISMISS_VELOCITY = 900;

/**
 * Tấm trượt từ dưới lên: nền tối mờ dần (không trượt theo), tấm trượt lên mượt và
 * có thể kéo thanh nắm xuống để đóng. Khi `visible` chuyển false, tấm trượt chạy
 * hiệu ứng đóng rồi mới gỡ khỏi màn và gọi `onClosed`.
 */
export function BottomSheet({ visible, title, onClose, onClosed, children, dismissable = true }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onClosed?: () => void;
  children: ReactNode;
  dismissable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const sheetHeight = useSharedValue(windowHeight);
  const canDismiss = useSharedValue(dismissable);
  useEffect(() => { canDismiss.set(dismissable); }, [dismissable, canDismiss]);

  const onClosedRef = useRef(onClosed);
  useEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);
  const requestClose = () => { if (dismissable) onClose(); };

  useEffect(() => {
    if (!mounted) return;
    const finishClosing = () => {
      setMounted(false);
      onClosedRef.current?.();
    };
    if (visible) {
      drag.set(0);
      progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS, easing: Easing.out(Easing.cubic) }));
      return;
    }
    progress.set(withTiming(0, { duration: reduceMotion ? 0 : CLOSE_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) scheduleOnRN(finishClosing);
    }));
  }, [visible, mounted, reduceMotion, progress, drag]);

  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onUpdate: (event) => {
      'worklet';
      // Kéo lên quá vị trí mở thì có lực cản, kéo xuống thì đi theo tay.
      drag.set(event.translationY > 0 ? event.translationY : event.translationY * 0.15);
    },
    onDeactivate: (event) => {
      'worklet';
      const shouldClose = canDismiss.get() && (event.translationY > sheetHeight.get() * DISMISS_RATIO || event.velocityY > DISMISS_VELOCITY);
      if (shouldClose) scheduleOnRN(onClose);
      else drag.set(withSpring(0, { damping: 20, stiffness: 260 }));
    },
  });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * sheetHeight.get() + drag.get() }],
  }));

  return (
    <Modal visible={mounted} onRequestClose={requestClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(20, 26, 60, 0.45)' }, backdropStyle]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng" onPress={requestClose} style={{ flex: 1 }}/>
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            onLayout={(event) => sheetHeight.set(event.nativeEvent.layout.height)}
            style={[{ maxHeight: '90%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md, boxShadow: '0 -8px 30px rgba(20, 26, 60, 0.12)' }, sheetStyle]}>
            <GestureDetector gesture={pan}>
              <View>
                <View style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs }}>
                  <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.separator }}/>
                </View>
                <AppText accessibilityRole="header" variant="headline" style={{ fontSize: 19, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm }}>{title}</AppText>
              </View>
            </GestureDetector>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function Modal({ visible, onRequestClose, children }: { visible: boolean; onRequestClose: () => void; children: ReactNode }) {
  // Modal gốc chỉ để có lớp phủ toàn màn; hiệu ứng do Reanimated đảm nhiệm.
  return <NativeModal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onRequestClose}>{children}</NativeModal>;
}
