import { Stack } from 'expo-router/stack';

export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }}><Stack.Screen name="index" options={{ title: 'Try-oh' }}/></Stack>;
}
