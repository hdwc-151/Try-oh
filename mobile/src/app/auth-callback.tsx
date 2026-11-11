import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { useAuth } from '@/providers/auth-provider';
import { colors, spacing } from '@/theme';

export default function AuthCallbackRoute() {
  const { linkError, session } = useAuth();

  if (session) return <Redirect href="/(tabs)/home" />;
  if (linkError) return <Redirect href="/auth" />;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.label} />
      <AppText variant="subhead">Đang xác minh tài khoản…</AppText>
    </View>
  );
}
