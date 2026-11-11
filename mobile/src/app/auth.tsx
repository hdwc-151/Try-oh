import { Stack } from 'expo-router/stack';

import { AuthScreen } from '@/screens/auth';

export default function AuthRoute() {
  return <><Stack.Title>Đăng nhập</Stack.Title><AuthScreen/></>;
}
