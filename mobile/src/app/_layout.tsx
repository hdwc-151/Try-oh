import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { ApiError } from '@/services/api-client';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && ['network_error', 'request_timeout'].includes(error.code ?? '')) return false;
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

function RootNavigator() {
  const { ready, session } = useAuth();
  const userId = session?.user.id ?? null;
  // Đổi tài khoản hoặc đăng xuất: bỏ toàn bộ dữ liệu đã tải của người trước,
  // tránh người sau thoáng thấy tủ đồ/ảnh của người trước trong cache.
  const previousUserId = useRef(userId);
  useEffect(() => {
    if (previousUserId.current !== userId) {
      if (previousUserId.current !== null) queryClient.clear();
      previousUserId.current = userId;
    }
  }, [userId]);

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  const theme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.label,
      background: colors.background,
      card: colors.surface,
      text: colors.label,
      border: colors.separator,
      notification: colors.destructive,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShadowVisible: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        {/* Hết phiên ở bất kỳ màn nào cần đăng nhập thì quay về màn đăng nhập. */}
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="plans" options={{ title: 'Gói đăng ký', headerBackTitle: 'Hồ sơ' }} />
          <Stack.Screen name="settings" options={{ title: 'Cài đặt', headerBackTitle: 'Hồ sơ' }} />
          <Stack.Screen name="image-viewer" options={{ title: 'Xem ảnh', presentation: 'fullScreenModal', animation: 'fade', headerBackTitle: 'Đóng' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}><AuthProvider><RootNavigator/></AuthProvider></QueryClientProvider>
  </GestureHandlerRootView>;
}
