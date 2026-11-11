import { Stack } from 'expo-router/stack';

export default function FriendsLayout() {
  return <Stack screenOptions={{ headerLargeTitleEnabled: true, headerShadowVisible: false }}><Stack.Screen name="index" options={{ title: 'Khám phá' }}/></Stack>;
}
