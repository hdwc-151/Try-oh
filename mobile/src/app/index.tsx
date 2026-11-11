import { Redirect } from 'expo-router';

import { useAuth } from '@/providers/auth-provider';

export default function IndexRoute() {
  const { recoveryMode, session } = useAuth();
  if (recoveryMode) return <Redirect href="/reset-password" />;
  return <Redirect href={session ? '/(tabs)/home' : '/auth'} />;
}
