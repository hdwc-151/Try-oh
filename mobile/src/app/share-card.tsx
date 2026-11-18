import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';

import { KeyboardScrollView } from '@/components/keyboard-scroll-view';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { TryOhWordmark } from '@/components/fitsy-mark';
import { Notice } from '@/components/notice';
import { QrCode } from '@/components/qr-code';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource, webBaseUrl } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialSnapshot } from '@/types/api';

const THEMES = [
  { id: 'lavender', label: 'Oải hương', colors: ['#EFEAFF', '#FFE3EC'] as const, ink: '#141A3C' },
  { id: 'sunset', label: 'Hoàng hôn', colors: ['#FFB38A', '#FF5A6E'] as const, ink: '#FFFFFF' },
  { id: 'night', label: 'Đêm', colors: ['#141A3C', '#6E4BF2'] as const, ink: '#FFFFFF' },
] as const;

/** Thẻ chia sẻ outfit có khung Try-oh + mã QR mời bạn; chụp thành ảnh rồi mở bảng chia sẻ của máy. */
export default function ShareCardRoute() {
  const brand = useBrandColors();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ uri?: string }>();
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const [theme, setTheme] = useState<(typeof THEMES)[number]>(THEMES[0]);
  const [caption, setCaption] = useState('Outfit hôm nay ✨');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const me = social.data?.me;
  const inviteLink = me?.inviteCode ? webBaseUrl + '/ban-be?invite=' + encodeURIComponent(me.inviteCode) : webBaseUrl;

  const share = async () => {
    setError(null);
    if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
      setError('Thiết bị này chưa hỗ trợ chia sẻ ảnh trực tiếp.');
      return;
    }
    setSharing(true);
    try {
      const file = await captureRef(cardRef as unknown as Parameters<typeof captureRef>[0], { format: 'png', quality: 1, result: 'tmpfile' });
      haptic.success();
      await Sharing.shareAsync(file, { mimeType: 'image/png', dialogTitle: 'Chia sẻ outfit', UTI: 'public.png' });
    } catch {
      setError('Chưa tạo được ảnh để chia sẻ. Vui lòng thử lại.');
    } finally {
      setSharing(false);
    }
  };

  return <>
    <Stack.Screen options={{ title: 'Chia sẻ outfit' }}/>
    <KeyboardScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl }}>
      <Animated.View entering={FadeIn.duration(260)}>
      <View ref={cardRef} collapsable={false} style={{ borderRadius: radius.xl, overflow: 'hidden' }}>
        <LinearGradient colors={theme.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.9)' }}>
              <TryOhWordmark size={22}/>
            </View>
            {me && <AppText style={{ color: theme.ink, fontWeight: '700' }}>@{me.username}</AppText>}
          </View>
          {uri
            ? <Image source={protectedImageSource(uri, session?.access_token)} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.4)' }} contentFit="cover"/>
            : <AppText style={{ color: theme.ink }}>Không tìm thấy ảnh.</AppText>}
          <AppText style={{ color: theme.ink, fontSize: 22, fontWeight: '800' }}>{caption || ' '}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ borderRadius: radius.sm, overflow: 'hidden' }}>
              <QrCode value={inviteLink} size={72}/>
            </View>
            <AppText style={{ flex: 1, color: theme.ink, fontSize: 13, lineHeight: 18 }}>Quét để phối đồ cùng mình trên Try-oh — thử đồ bằng AI ngay trên ảnh của bạn.</AppText>
          </View>
        </LinearGradient>
      </View>
      </Animated.View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {THEMES.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: item.id === theme.id }} onPress={() => { haptic.select(); setTheme(item); }}
          style={{ flex: 1, gap: 4, alignItems: 'center' }}>
          <LinearGradient colors={item.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: 36, borderRadius: radius.md, borderWidth: 3, borderColor: item.id === theme.id ? brand.accent : 'transparent' }}/>
          <AppText variant="caption">{item.label}</AppText>
        </Pressable>)}
      </View>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        maxLength={40}
        placeholder="Viết vài chữ cho outfit"
        placeholderTextColor={colors.secondaryLabel}
        style={{ minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface, color: colors.label, fontSize: 16 }}
      />
      {error && <Notice tone="error" text={error} onDismiss={() => setError(null)}/>}
      <AppButton title="Chia sẻ ảnh" icon="link" loading={sharing} disabled={!uri} onPress={() => void share()}/>
    </KeyboardScrollView>
  </>;
}
