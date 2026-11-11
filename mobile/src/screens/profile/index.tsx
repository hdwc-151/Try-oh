import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AvatarViewer } from '@/components/avatar-viewer';
import { AppIcon } from '@/components/icon';
import { FitsyMark } from '@/components/fitsy-mark';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource, webBaseUrl } from '@/services/api-client';
import { imageUploadFile } from '@/services/image-upload';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { PlanSnapshot, SocialSnapshot } from '@/types/api';

const AVATAR_SIZE = 96;

type AvatarSource = 'library' | 'camera';

export function ProfileScreen() {
  const auth = useAuth();
  const brand = useBrandColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiRequest<PlanSnapshot>('/api/plans') });
  const social = useQuery({ queryKey: ['social'], queryFn: () => apiRequest<SocialSnapshot>('/api/social') });

  const uploadAvatar = useMutation({
    mutationFn: async (source: AvatarSource) => {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(source === 'camera'
          ? 'Cần quyền dùng camera để chụp ảnh đại diện. Hãy bật trong Cài đặt của máy.'
          : 'Cần quyền truy cập thư viện ảnh để đổi ảnh đại diện.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 };
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled) return null;
      const form = new FormData();
      form.append('avatar', imageUploadFile(picked.assets[0], 'avatar.jpg'));
      return apiRequest<SocialSnapshot>('/api/social/avatar', { method: 'POST', body: form });
    },
    onSuccess: (snapshot) => {
      if (snapshot) queryClient.setQueryData(['social'], snapshot);
    },
  });
  const deleteAvatar = useMutation({
    mutationFn: () => apiRequest<SocialSnapshot>('/api/social/avatar', { method: 'DELETE' }),
    onSuccess: (snapshot) => queryClient.setQueryData(['social'], snapshot),
  });

  const loadError = plans.error ?? social.error;
  if (loadError) return <ScreenError message={loadError instanceof Error ? loadError.message : 'Không thể tải hồ sơ.'} onRetry={() => { void plans.refetch(); void social.refetch(); }}/>;
  if (plans.data === undefined || social.data === undefined) return <ScreenLoading variant="cards" label="Đang tải hồ sơ…"/>;

  const me = social.data.me;
  const name = me.name || String(auth.user?.user_metadata.display_name ?? auth.user?.email?.split('@')[0] ?? 'Người dùng');
  const avatarSource = me.avatar ? protectedImageSource(me.avatar, auth.session?.access_token) : undefined;
  const profileLink = me.inviteCode ? webBaseUrl + '/ban-be?invite=' + encodeURIComponent(me.inviteCode) : null;
  const busy = uploadAvatar.isPending || deleteAvatar.isPending;
  const avatarError = uploadAvatar.error ?? deleteAvatar.error;

  const confirmSignOut = () => Alert.alert('Đăng xuất khỏi Fitsy?', 'Bạn có thể đăng nhập lại bất cứ lúc nào bằng email và mật khẩu.', [
    { text: 'Huỷ', style: 'cancel' },
    { text: 'Đăng xuất', style: 'destructive', onPress: () => {
      setSigningOut(true);
      void auth.signOut().finally(() => setSigningOut(false));
    } },
  ]);

  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }}>
    <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }}>
      {/* Chạm để mở (trước đây phải giữ 1,5 giây — khó phát hiện và chậm). */}
      <PressableScale
        accessibilityRole="imagebutton"
        accessibilityLabel="Ảnh đại diện"
        accessibilityHint="Mở để xem, đổi ảnh đại diện hoặc lấy mã QR"
        scaleTo={0.92}
        onPress={() => setViewerOpen(true)}>
        <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground }}>
          {avatarSource
            ? <Image source={avatarSource} style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }} contentFit="cover" transition={200}/>
            : <FitsyMark size={AVATAR_SIZE}/>}
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.primary, borderWidth: 2, borderColor: colors.surface }}>
          <AppIcon name="edit" size={14} color={colors.onBrand}/>
        </View>
      </PressableScale>
      <AppText variant="title" style={{ marginTop: spacing.sm, textAlign: 'center' }}>{name}</AppText>
      <AppText variant="subhead">@{me.username}</AppText>
    </Animated.View>

    <Animated.View entering={FadeIn.duration(220).delay(60)} style={{ gap: spacing.sm, padding: spacing.lg, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: brand.secondary }}>
      <AppText variant="caption">GÓI HIỆN TẠI</AppText>
      <AppText variant="title">{plans.data.current.planName}</AppText>
      <AppText variant="subhead">{plans.data.current.unlimited
        ? 'Tủ đồ và outfit không giới hạn'
        : 'Tủ đồ ' + plans.data.current.entitlements.wardrobeItems + ' món · ' + plans.data.current.entitlements.savedOutfits + ' outfit'}</AppText>
      <AppButton title="Xem các gói đăng ký" variant="secondary" onPress={() => router.push('/plans')}/>
    </Animated.View>
    <AppButton title="Đăng xuất" variant="destructive" loading={signingOut} onPress={confirmSignOut}/>

    <AvatarViewer
      visible={viewerOpen}
      avatar={avatarSource}
      name={name}
      username={me.username}
      profileLink={profileLink}
      busy={busy}
      error={avatarError ? (avatarError instanceof Error ? avatarError.message : 'Không thể cập nhật ảnh đại diện.') : null}
      onClose={() => { setViewerOpen(false); uploadAvatar.reset(); deleteAvatar.reset(); }}
      onPickLibrary={() => { deleteAvatar.reset(); uploadAvatar.mutate('library'); }}
      onTakePhoto={() => { deleteAvatar.reset(); uploadAvatar.mutate('camera'); }}
      onDelete={() => Alert.alert('Xóa ảnh đại diện?', 'Trang cá nhân sẽ dùng ảnh mặc định của Fitsy.', [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xóa', style: 'destructive', onPress: () => { uploadAvatar.reset(); deleteAvatar.mutate(); } },
      ])}
    />
  </ScrollView>;
}
