import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const RELEASE_SPRING = { damping: 16, stiffness: 300, mass: 0.6 };

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Tỉ lệ thu nhỏ khi nhấn; 1 = không co. */
  scaleTo?: number;
};

/** Pressable co nhẹ khi nhấn và bật lại bằng spring (chạy trên UI thread, tôn trọng "Giảm chuyển động"). */
export function PressableScale({ scaleTo = 0.97, style, onPressIn, onPressOut, ...props }: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <AnimatedPressable
    {...props}
    onPressIn={(event) => {
      if (!reduceMotion) scale.set(withTiming(scaleTo, { duration: 90 }));
      onPressIn?.(event);
    }}
    onPressOut={(event) => {
      scale.set(withSpring(1, RELEASE_SPRING));
      onPressOut?.(event);
    }}
    style={[style, animatedStyle]}
  />;
}
