import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Rung phản hồi nhẹ. Trên web hoặc máy không hỗ trợ thì bỏ qua, không bao giờ làm hỏng thao tác. */
const run = (effect: () => Promise<void>) => {
  if (Platform.OS === 'web') return;
  effect().catch(() => undefined);
};

export const haptic = {
  /** Chạm chọn một mục. */
  select: () => run(() => Haptics.selectionAsync()),
  /** Va chạm nhẹ (kéo qua mốc, thẻ bật lại). */
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Va chạm vừa (lắc máy, quẹt thẻ đi). */
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Hoàn tất (ảnh mới ra, đã bình chọn). */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
