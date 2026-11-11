import { Stack } from 'expo-router/stack';

export default function FavoritesLayout() {
  return <Stack screenOptions={{ headerLargeTitleEnabled: true, headerShadowVisible: false }}><Stack.Screen name="index" options={{ title: 'Yêu thích' }}/></Stack>;
}
