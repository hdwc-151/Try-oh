import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable } from 'react-native';

import { AppIcon } from '@/components/icon';
import { useBrandColors } from '@/theme';

function SettingsButton() {
  const brand = useBrandColors();
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Cài đặt tài khoản"
    hitSlop={10}
    onPress={() => router.push('/settings')}
    style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
    <AppIcon name="gear" size={24} color={brand.primary}/>
  </Pressable>;
}

export default function ProfileLayout() {
  return <Stack screenOptions={{ headerLargeTitleEnabled: true, headerShadowVisible: false }}>
    <Stack.Screen name="index" options={{ title: 'Cá nhân', headerRight: () => <SettingsButton/> }}/>
  </Stack>;
}
