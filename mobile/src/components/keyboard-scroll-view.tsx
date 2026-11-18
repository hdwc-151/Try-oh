import { useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

type Props = ComponentProps<typeof ScrollView>;

/**
 * ScrollView không để bàn phím che ô nhập.
 * - iOS: `automaticallyAdjustKeyboardInsets` (hệ thống tự thêm khoảng trống và cuộn tới ô đang nhập).
 * - Android: app chạy edge-to-edge nên cửa sổ không tự co lại khi bàn phím mở; KeyboardAvoidingView
 *   thu nhỏ vùng cuộn, ScrollView gốc của Android tự cuộn ô đang nhập vào tầm nhìn.
 *   `keyboardVerticalOffset` lấy từ vị trí thật trên màn hình (dưới header), nếu không phần đệm thiếu
 *   đúng bằng chiều cao header.
 */
export function KeyboardScrollView(props: Props) {
  if (Platform.OS === 'ios') {
    return <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...props}/>;
  }
  return <AndroidKeyboardScrollView {...props}/>;
}

function AndroidKeyboardScrollView(props: Props) {
  const holder = useRef<ComponentRef<typeof View>>(null);
  const [offset, setOffset] = useState(0);
  return <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={{ flex: 1 }}>
    <View
      ref={holder}
      collapsable={false}
      style={{ flex: 1 }}
      onLayout={() => holder.current?.measureInWindow((_x: number, y: number) => {
        const next = Math.max(0, Math.round(y));
        setOffset((current) => current === next ? current : next);
      })}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" {...props}/>
    </View>
  </KeyboardAvoidingView>;
}
