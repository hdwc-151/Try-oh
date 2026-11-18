import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Stack, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { QrCode } from '@/components/qr-code';
import { SegmentedControl } from '@/components/segmented-control';
import { ApiError, apiRequest, webBaseUrl } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { SocialPerson, SocialSnapshot } from '@/types/api';

type Mode = 'scan' | 'mine';

/** Mã QR của Try-oh là liên kết `.../ban-be?invite=<mã>`; chấp nhận cả mã trần. */
function inviteCodeFromQr(data: string): string | null {
  const value = data.trim();
  try {
    const url = new URL(value);
    const code = url.searchParams.get('invite');
    return code && code.length <= 100 ? code : null;
  } catch {
    return /^[A-Za-z0-9_-]{8,100}$/.test(value) ? value : null;
  }
}

/** Quét mã QR của bạn bè để mở trang cá nhân và gửi lời mời kèm mã; hoặc đưa mã của mình cho bạn quét. */
export default function ScanRoute() {
  const brand = useBrandColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Camera gọi onBarcodeScanned liên tục khi mã còn trong khung; chỉ xử lý một lần mỗi lượt.
  const handling = useRef(false);
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });
  const inviteCode = social.data?.me.inviteCode;
  const myLink = inviteCode ? webBaseUrl + '/ban-be?invite=' + encodeURIComponent(inviteCode) : null;

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handling.current) return;
    handling.current = true;
    const code = inviteCodeFromQr(data);
    if (!code) {
      setError('Đây không phải mã QR kết bạn của Try-oh.');
      setTimeout(() => { handling.current = false; }, 2000);
      return;
    }
    if (code === inviteCode) {
      setError('Đây là mã QR của chính bạn.');
      setTimeout(() => { handling.current = false; }, 2000);
      return;
    }
    haptic.success();
    setError(null);
    setResolving(true);
    try {
      const person = await apiRequest<SocialPerson>('/api/social/invite?code=' + encodeURIComponent(code));
      router.replace({ pathname: '/user/[id]', params: { id: person.id, invite: code } });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Không mở được mã QR này. Thử lại.');
      setTimeout(() => { handling.current = false; }, 2000);
    } finally {
      setResolving(false);
    }
  };

  return <>
    <Stack.Screen options={{ title: 'Mã QR kết bạn' }}/>
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.md }}>
      <SegmentedControl
        stretch
        value={mode}
        onChange={(next) => { setMode(next); setError(null); handling.current = false; }}
        options={[
          { value: 'scan', label: 'Quét mã', icon: 'camera' },
          { value: 'mine', label: 'Mã của tôi', icon: 'qr' },
        ]}/>

      {mode === 'mine'
        ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
            {myLink
              ? <View style={{ padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator }}>
                  <QrCode value={myLink} size={240}/>
                </View>
              : <ActivityIndicator color={brand.primary as string}/>}
            <AppText variant="headline">@{social.data?.me.username ?? ''}</AppText>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>Bạn bè mở Try-oh, vào Khám phá và quét mã này để gửi lời mời kết bạn.</AppText>
          </View>
        : !permission
          ? <ActivityIndicator style={{ flex: 1 }} color={brand.primary as string}/>
          : !permission.granted
            ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }}>
                <AppIcon name="camera" size={36} color={colors.secondaryLabel}/>
                <AppText variant="headline" style={{ textAlign: 'center' }}>Cho phép dùng camera để quét mã</AppText>
                <AppText variant="subhead" style={{ textAlign: 'center' }}>Try-oh chỉ dùng camera để đọc mã QR, không lưu hình ảnh.</AppText>
                {permission.canAskAgain
                  ? <AppButton title="Cho phép camera" onPress={() => void requestPermission()}/>
                  : <AppButton title="Mở Cài đặt" variant="secondary" onPress={() => void Linking.openSettings()}/>}
              </View>
            : <View style={{ flex: 1, gap: spacing.md }}>
                <View style={{ flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' }}>
                  <CameraView
                    style={{ flex: 1 }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={resolving ? undefined : (result) => { void onScanned(result); }}/>
                  <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 220, height: 220, borderRadius: radius.xl, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }}/>
                  </View>
                  {resolving && <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                    <ActivityIndicator color="#FFFFFF"/>
                  </View>}
                </View>
                <AppText variant="subhead" style={{ textAlign: 'center', color: error ? colors.destructive : colors.secondaryLabel }}>
                  {error ?? 'Đưa mã QR của bạn bè vào khung để mở trang cá nhân của họ.'}
                </AppText>
              </View>}
    </View>
  </>;
}
