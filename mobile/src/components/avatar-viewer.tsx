import * as Clipboard from 'expo-clipboard';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { FitsyMark } from '@/components/fitsy-mark';
import { AppIcon, type AppIconName } from '@/components/icon';
import { QrCode } from '@/components/qr-code';
import { radius, spacing } from '@/theme';

const SURFACE = '#23262F';
const DANGER = '#FF6B7A';

/**
 * Xem ảnh đại diện toàn màn (mở bằng nhấn giữ): bút sửa (thư viện / chụp ảnh / xoá),
 * chân trang có sao chép liên kết trang cá nhân và mã QR.
 */
export function AvatarViewer({ visible, avatar, name, username, profileLink, busy, error, onClose, onPickLibrary, onTakePhoto, onDelete }: {
  visible: boolean;
  avatar: ImageSource | undefined;
  name: string;
  username: string;
  profileLink: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPickLibrary: () => void;
  onTakePhoto: () => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const size = Math.min(width * 0.68, 300);

  // Đóng trình xem hoặc tải ảnh xong thì đưa trình xem về trạng thái ban đầu (cập nhật ngay khi render, không cần effect).
  const [previous, setPrevious] = useState({ visible, busy });
  if (previous.visible !== visible || previous.busy !== busy) {
    setPrevious({ visible, busy });
    if (!visible) { setMenuOpen(false); setQrOpen(false); setToast(null); }
    if (previous.busy && !busy) setMenuOpen(false);
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const back = () => {
    if (menuOpen) setMenuOpen(false);
    else if (qrOpen) setQrOpen(false);
    else onClose();
  };
  const copyLink = async () => {
    if (!profileLink) return;
    await Clipboard.setStringAsync(profileLink);
    setToast('Đã sao chép liên kết');
  };

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={back}>
    <View style={{ flex: 1, backgroundColor: '#0E111E' }}>
      {avatar && <Image source={avatar} blurRadius={60} contentFit="cover" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.55 }}/>}
      <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(14, 17, 30, 0.55)' }}/>
      <Pressable accessibilityRole="button" accessibilityLabel={menuOpen || qrOpen ? 'Quay lại' : 'Đóng'} onPress={back} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}/>

      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom + 140 }}>
        {qrOpen && profileLink
          ? <Animated.View key="qr" entering={ZoomIn.duration(220)} style={{ alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: '#FFFFFF' }}>
              <QrCode value={profileLink} size={Math.min(width * 0.62, 260)}/>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="headline">{name}</AppText>
                <AppText variant="subhead">@{username}</AppText>
              </View>
              <AppText variant="caption" style={{ textAlign: 'center', maxWidth: 260 }}>Quét mã để kết bạn với bạn trên Fitsy</AppText>
            </Animated.View>
          : <Animated.View key="avatar" entering={ZoomIn.duration(220)} style={{ alignItems: 'center' }}>
              <View style={{ width: size, height: size }}>
                <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE }}>
                  {avatar
                    ? <Image source={avatar} contentFit="cover" style={{ width: size, height: size }}/>
                    : <FitsyMark size={size * 0.45}/>}
                  {busy && <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14, 17, 30, 0.5)' }}><ActivityIndicator size="large" color="#FFFFFF"/></View>}
                </View>
                {!menuOpen && !busy && <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Đổi ảnh đại diện"
                  onPress={() => setMenuOpen(true)}
                  style={({ pressed }) => ({ position: 'absolute', right: size * 0.04, bottom: size * 0.04, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#2E3240' : '#15171E', borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)' })}>
                  <AppIcon name="edit" size={22} color="#FFFFFF"/>
                </Pressable>}
              </View>
              {menuOpen && <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(140)} style={{ width: Math.max(size, 260), marginTop: -size * 0.1, paddingVertical: spacing.sm, borderRadius: radius.xl, backgroundColor: SURFACE, boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)' }}>
                <MenuItem icon="gallery" label="Chọn từ thư viện" onPress={onPickLibrary}/>
                <MenuItem icon="camera" label="Chụp ảnh" onPress={onTakePhoto}/>
                {avatar && <MenuItem icon="trash" label="Xóa" danger onPress={onDelete}/>}
              </Animated.View>}
              {error && <Animated.View entering={FadeIn.duration(180)}><AppText variant="subhead" style={{ marginTop: spacing.md, color: DANGER, textAlign: 'center', maxWidth: 300 }}>{error}</AppText></Animated.View>}
            </Animated.View>}
      </View>

      {!menuOpen && <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.xl, alignItems: 'center', gap: spacing.md }}>
        {toast && <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(160)} accessibilityLiveRegion="polite" style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.92)' }}>
          <AppText variant="caption" style={{ color: '#141A3C', fontWeight: '700' }}>{toast}</AppText>
        </Animated.View>}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
          <FooterButton icon="link" label="Sao chép liên kết" disabled={!profileLink} onPress={() => void copyLink()}/>
          <FooterButton icon={qrOpen ? 'person' : 'qr'} label={qrOpen ? 'Ảnh đại diện' : 'Mã QR'} disabled={!profileLink} onPress={() => setQrOpen((value) => !value)}/>
        </View>
      </View>}
    </View>
  </Modal>;
}

function MenuItem({ icon, label, danger = false, onPress }: { icon: AppIconName; label: string; danger?: boolean; onPress: () => void }) {
  const color = danger ? DANGER : '#FFFFFF';
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'transparent' })}>
    <AppIcon name={icon} size={24} color={color}/>
    <AppText selectable={false} variant="body" style={{ color, fontSize: 17 }}>{label}</AppText>
  </Pressable>;
}

function FooterButton({ icon, label, disabled, onPress }: { icon: AppIconName; label: string; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 96, alignItems: 'center', gap: spacing.sm, opacity: disabled ? 0.4 : 1 }}>
    {({ pressed }) => <>
      <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#2E3240' : '#15171E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <AppIcon name={icon} size={26} color="#FFFFFF"/>
      </View>
      <AppText selectable={false} variant="caption" style={{ color: '#FFFFFF', textAlign: 'center' }}>{label}</AppText>
    </>}
  </Pressable>;
}
