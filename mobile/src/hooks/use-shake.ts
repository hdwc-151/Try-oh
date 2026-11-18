import { Accelerometer } from 'expo-sensors';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

/** Ngưỡng lực (đơn vị g) coi là một cú lắc; cầm máy bình thường ~1g. */
const SHAKE_FORCE = 2.1;
/** Cần hai cú mạnh trong khoảng này để tránh nhầm khi đặt máy xuống bàn. */
const SHAKE_WINDOW_MS = 700;
const COOLDOWN_MS = 1500;

/** Gọi `onShake` khi người dùng lắc máy. Chỉ nghe cảm biến khi `enabled` và app đang mở. */
export function useShake(enabled: boolean, onShake: () => void) {
  const callback = useRef(onShake);
  useEffect(() => { callback.current = onShake; }, [onShake]);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let subscription: { remove: () => void } | null = null;
    let lastPeak = 0;
    let lastShake = 0;
    const start = () => {
      if (subscription) return;
      Accelerometer.setUpdateInterval(100);
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const force = Math.sqrt(x * x + y * y + z * z);
        if (force < SHAKE_FORCE) return;
        const now = Date.now();
        if (now - lastShake < COOLDOWN_MS) return;
        if (now - lastPeak < SHAKE_WINDOW_MS) {
          lastShake = now;
          lastPeak = 0;
          callback.current();
        } else {
          lastPeak = now;
        }
      });
    };
    const stop = () => { subscription?.remove(); subscription = null; };
    let cancelled = false;
    void Accelerometer.isAvailableAsync().then((available) => {
      if (available && !cancelled && AppState.currentState === 'active') start();
    }).catch(() => undefined);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else stop(); });
    return () => { cancelled = true; stop(); appState.remove(); };
  }, [enabled]);
}
