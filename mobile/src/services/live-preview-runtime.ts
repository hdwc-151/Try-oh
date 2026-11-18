import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

/**
 * Thử trực tiếp cần WebRTC gốc (bộ LiveKit cho React Native). Expo Go không có
 * module này, nên mọi thứ liên quan chỉ được nạp khi chắc chắn module đã có;
 * nạp sớm hơn sẽ làm app văng ngay khi mở.
 */
export type LivePreviewRuntime = {
  sdk: typeof import('@decartai/sdk');
  webrtc: typeof import('@livekit/react-native-webrtc');
};

export type LivePreviewSupport = { supported: true } | { supported: false; reason: string };

const hasNativeWebRTC = () => {
  try {
    return Boolean(TurboModuleRegistry.get('WebRTCModule') ?? NativeModules.WebRTCModule);
  } catch {
    return false;
  }
};

export function livePreviewSupport(): LivePreviewSupport {
  if (Platform.OS === 'web') return { supported: false, reason: 'Hãy dùng Try-oh trên trình duyệt máy tính hoặc ứng dụng điện thoại để thử trực tiếp.' };
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { supported: false, reason: 'Thử trực tiếp cần bản cài đặt Try-oh (dev build hoặc bản phát hành), không chạy trong Expo Go.' };
  }
  if (!hasNativeWebRTC()) return { supported: false, reason: 'Bản cài đặt này chưa có thành phần camera trực tiếp. Hãy cập nhật Try-oh lên bản mới.' };
  return { supported: true };
}

let runtime: LivePreviewRuntime | null = null;

export function loadLivePreviewRuntime(): LivePreviewRuntime {
  if (runtime) return runtime;
  const support = livePreviewSupport();
  if (!support.supported) throw new Error(support.reason);
  // Thứ tự quan trọng: đăng ký WebRTC toàn cục trước khi nạp SDK (SDK dùng livekit-client).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const livekit = require('@livekit/react-native') as typeof import('@livekit/react-native');
  livekit.registerGlobals();
  runtime = {
    webrtc: require('@livekit/react-native-webrtc') as typeof import('@livekit/react-native-webrtc'),
    sdk: require('@decartai/sdk') as typeof import('@decartai/sdk'),
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return runtime;
}
