import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';

import { useAuth } from '@/providers/auth-provider';
import { colors, useBrandColors } from '@/theme';

export default function AppTabs() {
  const { session } = useAuth();
  const brand = useBrandColors();
  if (!session) return <Redirect href="/auth"/>;
  return (
    <NativeTabs
      tintColor={brand.accent}
      iconColor={{ default: brand.primary, selected: brand.accent }}
      labelStyle={{ default: { color: brand.primary }, selected: { color: brand.accent } }}
      backgroundColor={colors.surface}
      indicatorColor={brand.secondary}
      rippleColor="transparent"
      tabBarRespectsIMEInsets>
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Trang chủ</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="friends">
        <NativeTabs.Trigger.Icon sf={{ default: 'safari', selected: 'safari.fill' }} md="explore" />
        <NativeTabs.Trigger.Label>Khám phá</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="favorites">
        <NativeTabs.Trigger.Icon sf={{ default: 'heart', selected: 'heart.fill' }} md="favorite" />
        <NativeTabs.Trigger.Label>Yêu thích</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
        <NativeTabs.Trigger.Label>Cá nhân</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
