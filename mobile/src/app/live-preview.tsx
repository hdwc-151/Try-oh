import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, View } from 'react-native';
import type { MediaStream } from '@livekit/react-native-webrtc';
import type { RealTimeClient } from '@decartai/sdk';

import { AppButton } from '@/components/app-button';
import { AppIcon } from '@/components/icon';
import { AppText } from '@/components/app-text';
import { Notice } from '@/components/notice';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { SegmentedControl } from '@/components/segmented-control';
import { useAuth } from '@/providers/auth-provider';
import { ApiError, apiRequest, protectedImageSource } from '@/services/api-client';
import { livePreviewSupport, loadLivePreviewRuntime } from '@/services/live-preview-runtime';
import { categoryNames } from '@/screens/wardrobe';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { Garment, GarmentCategory, LivePreviewSpeed, LivePreviewStartResponse, LivePreviewStatus, LivePreviewToken, PageResponse } from '@/types/api';

type Phase = 'idle' | 'starting' | 'framing' | 'connecting' | 'live' | 'ended';
type Source = 'wardrobe' | 'upload';
type UploadedReference = { uri: string; base64: string };

const categories = Object.keys(categoryNames) as GarmentCategory[];
/** Không có hình sau khoảng này thì dừng, tránh để người dùng chờ mãi. */
const CONNECT_TIMEOUT_MS = 45_000;
const MAX_UPLOAD_BASE64_LENGTH = 11_000_000; // ~8MB ảnh gốc

export default function LivePreviewRoute() {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ garmentId?: string }>();
  const support = useMemo(() => livePreviewSupport(), []);
  const status = useQuery({ queryKey: ['live-preview-status'], queryFn: () => apiRequest<LivePreviewStatus>('/api/live-preview/status') });
  const garments = useQuery({ queryKey: ['garments', 'live-preview'], queryFn: () => apiRequest<PageResponse<Garment>>('/api/garments?limit=60&offset=0') });
  const [source, setSource] = useState<Source>('wardrobe');
  const [pickedGarmentId, setGarmentId] = useState<string | null>(params.garmentId ?? null);
  const [uploaded, setUploaded] = useState<UploadedReference | null>(null);
  const [uploadCategory, setUploadCategory] = useState<GarmentCategory>('tops');
  const [preferredSpeed, setPreferredSpeed] = useState<LivePreviewSpeed>('standard');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const clientRef = useRef<RealTimeClient | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const attemptRef = useRef(0);
  const confirmFrameRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmFrame = () => {
    const confirm = confirmFrameRef.current;
    confirmFrameRef.current = null;
    confirm?.(true);
  };

  const items = useMemo(() => garments.data?.items ?? [], [garments.data?.items]);
  // Mặc định là món đang chọn ở phòng thử, không có thì món đầu tiên của tủ đồ.
  const garmentId = pickedGarmentId ?? items[0]?.id ?? null;

  const stop = useCallback((next: Phase = 'ended') => {
    attemptRef.current += 1;
    confirmFrameRef.current?.(false);
    confirmFrameRef.current = null;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    try { clientRef.current?.disconnect(); } catch { /* đã đóng */ }
    clientRef.current = null;
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    cameraRef.current = null;
    setRemoteUrl(null);
    setLocalUrl(null);
    setPhase((current) => current === 'idle' || current === 'starting' || current === 'framing' ? 'idle' : next);
  }, []);

  // Không để camera hay phiên tính tiền chạy khi đã rời màn hoặc app xuống nền.
  useFocusEffect(useCallback(() => () => stop('idle'), [stop]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || (state === 'inactive' && cameraRef.current)) stop();
    });
    return () => subscription.remove();
  }, [stop]);

  const pickUpload = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Cần quyền truy cập thư viện ảnh để chọn ảnh món đồ.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset.base64) { setError('Không đọc được ảnh này. Hãy chọn ảnh khác.'); return; }
    if (asset.base64.length > MAX_UPLOAD_BASE64_LENGTH) { setError('Ảnh quá lớn, hãy chọn ảnh nhỏ hơn 8MB.'); return; }
    setUploaded({ uri: asset.uri, base64: asset.base64 });
  };

  // Gói không có chế độ Nhanh thì luôn chạy Tiêu chuẩn; máy chủ cũng kiểm lại.
  const speed: LivePreviewSpeed = preferredSpeed === 'fast' && status.data?.fastModeIncluded ? 'fast' : 'standard';
  const sessionCost = speed === 'fast' ? status.data?.fastCost ?? 1 : 1;
  const busy = phase === 'starting' || phase === 'connecting';
  const framing = phase === 'framing';
  const canAdjustReference = phase === 'idle' || phase === 'ended';
  const canOpenCamera = canAdjustReference && (source === 'wardrobe' ? Boolean(garmentId) : Boolean(uploaded));
  const canUseSession = support.supported && status.data?.enabled && status.data.included
    && (status.data.unlimited || (status.data.remaining ?? 0) >= sessionCost);

  const start = async () => {
    if (!canOpenCamera || !canUseSession) return;
    const attempt = ++attemptRef.current;
    const isCurrent = () => attemptRef.current === attempt;
    setError(null);
    setPhase('starting');
    try {
      const { sdk, webrtc } = loadLivePreviewRuntime();
      let camera: MediaStream;
      try {
        // Xin camera trước khi trừ lượt: từ chối quyền thì không mất gì.
        camera = await webrtc.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: 1280, height: 720, frameRate: 30 },
        }) as MediaStream;
      } catch {
        throw new Error('Không mở được camera. Hãy cho phép Try-oh dùng camera trong Cài đặt rồi thử lại.');
      }
      if (!isCurrent()) {
        camera.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraRef.current = camera;
      setLocalUrl(camera.toURL());

      const confirmed = await new Promise<boolean>((resolve) => {
        confirmFrameRef.current = resolve;
        setPhase('framing');
      });
      if (!confirmed || !isCurrent()) return;
      setPhase('connecting');

      const started = await apiRequest<LivePreviewStartResponse>('/api/live-preview/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(source === 'wardrobe'
          ? { source: 'wardrobe', garmentId, speed }
          : { source: 'upload', category: uploadCategory, speed }),
      });
      queryClient.setQueryData(['live-preview-status'], started.status);
      if (!isCurrent()) return;
      const seconds = started.session.seconds;
      setSecondsLeft(seconds);
      timersRef.current.push(setTimeout(() => {
        setError('Kết nối quá lâu nên phiên đã dừng. Hãy kiểm tra mạng rồi thử lại.');
        stop();
      }, CONNECT_TIMEOUT_MS));

      let countdownStarted = false;
      const beginCountdown = () => {
        if (countdownStarted || !isCurrent()) return;
        countdownStarted = true;
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        setPhase('live');
        const endsAt = Date.now() + seconds * 1000;
        const tick = () => {
          const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
          setSecondsLeft(left);
          if (left <= 0) stop();
          else timersRef.current.push(setTimeout(tick, 250));
        };
        tick();
      };

      const client = sdk.createDecartClient({
        apiKeyProvider: async () => {
          if (!isCurrent()) throw new Error('Phiên thử đã kết thúc.');
          return (await apiRequest<LivePreviewToken>(`/api/live-preview/sessions/${started.session.id}/token`, { method: 'POST' })).apiKey;
        },
      });
      const realtime = await client.realtime.connect(camera, {
        model: sdk.models.realtime(started.session.model as Parameters<typeof sdk.models.realtime>[0]),
        preferredVideoCodec: 'vp8',
        ...(started.session.speed === 'fast' ? { speed: 'fast' as const } : {}),
        initialState: {
          prompt: { text: started.reference.prompt, enhance: true },
          image: started.reference.imageBase64 ?? uploaded!.base64,
        },
        onRemoteStream: (stream) => { if (isCurrent()) setRemoteUrl(stream.toURL()); },
        onConnectionChange: (state) => { if (state === 'generating') beginCountdown(); },
      });
      if (!isCurrent()) {
        realtime.disconnect();
        return;
      }
      clientRef.current = realtime;
      realtime.on('generationTick', beginCountdown);
      realtime.on('sessionEnded', () => { if (isCurrent()) stop(); });
      realtime.on('error', (cause) => {
        if (!isCurrent()) return;
        setError(cause.message || 'Phiên thử trực tiếp bị gián đoạn.');
        stop();
      });
      if (realtime.getConnectionState() === 'generating') beginCountdown();
    } catch (cause) {
      if (!isCurrent()) return;
      stop('idle');
      if (cause instanceof ApiError && cause.status === 402) void status.refetch();
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu thử trực tiếp.');
    }
  };

  if (status.error || garments.error) {
    const cause = status.error ?? garments.error;
    return <ScreenError message={cause instanceof Error ? cause.message : 'Không thể mở thử trực tiếp.'} onRetry={() => { void status.refetch(); void garments.refetch(); }}/>;
  }
  if (!status.data || !garments.data) return <ScreenLoading label="Đang chuẩn bị camera…"/>;

  const info = status.data;
  const exhausted = info.included && !info.unlimited && info.remaining === 0;
  const resetText = info.nextResetAt ? new Date(info.nextResetAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : null;
  const RTCView = phase !== 'idle' && support.supported ? loadLivePreviewRuntime().webrtc.RTCView : null;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}>
    <View style={{ gap: spacing.xs }}>
      <AppText variant="subhead">Xem nhanh món đồ trên người bạn trong {info.sessionSeconds} giây trước khi tạo ảnh chất lượng cao.</AppText>
      {info.included && <AppText variant="caption" style={{ color: brand.accent, fontWeight: '700' }}>
        {info.unlimited ? 'Không giới hạn (quản trị viên)' : `Còn ${info.remaining}/${info.limit} lượt trong ${info.windowDays} ngày${exhausted && resetText ? ` · lượt mới từ ${resetText}` : ''}`}
      </AppText>}
    </View>

    {!info.enabled && <Notice tone="info" text="Tính năng thử trực tiếp tạm thời chưa mở."/>}
    {!support.supported && <Notice tone="info" text={support.reason}/>}

    {!info.included ? (
      <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface }}>
        <AppIcon name="lock" size={28} color={brand.accent}/>
        <AppText variant="headline">Dành cho gói trả phí</AppText>
        <AppText variant="subhead" style={{ textAlign: 'center' }}>Gói Plus có 3 lượt, Pro 10 lượt, Max 30 lượt mỗi 30 ngày.</AppText>
        <AppButton title="Xem các gói đăng ký" onPress={() => router.push('/plans')}/>
      </View>
    ) : <>
      {phase !== 'idle' && <View style={{ aspectRatio: 9 / 16, maxHeight: 560, width: '100%', alignSelf: 'center', borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#16171b' }}>
        {RTCView && (phase === 'live' && remoteUrl
          ? <RTCView streamURL={remoteUrl} objectFit="cover" style={{ flex: 1 }}/>
          : localUrl ? <RTCView streamURL={localUrl} objectFit="cover" mirror style={{ flex: 1, opacity: framing ? 1 : 0.4 }}/> : null)}
        {framing && <View pointerEvents="none" accessibilityElementsHidden style={{ position: 'absolute', top: '12%', bottom: '14%', left: '19%', right: '19%', borderWidth: 2, borderColor: '#fff', borderStyle: 'dashed', borderRadius: radius.lg }}/>}
        {busy && <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg }}>
          <ActivityIndicator color={colors.onBrand}/>
          <AppText variant="caption" style={{ color: colors.onBrand, textAlign: 'center' }}>{phase === 'starting' ? 'Đang chuẩn bị…' : 'Đang kết nối, đồng hồ chỉ chạy khi hình đã hiện…'}</AppText>
        </View>}
        {phase === 'live' && <View style={{ position: 'absolute', top: spacing.sm, right: spacing.sm, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.full, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <AppText variant="headline" style={{ color: colors.onBrand, fontVariant: ['tabular-nums'] }}>{secondsLeft}s</AppText>
        </View>}
        {phase === 'ended' && <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <AppIcon name="sparkles" size={28} color={colors.onBrand}/>
          <AppText variant="headline" style={{ color: colors.onBrand }}>Hết phiên xem trước</AppText>
          <AppText variant="caption" style={{ color: colors.onBrand, textAlign: 'center', opacity: 0.8 }}>Ưng món này? Quay lại và bấm “Tạo outfit ngay” để có ảnh chất lượng cao.</AppText>
        </View>}
      </View>}

      {canAdjustReference && <View style={{ gap: spacing.md }}>
        <SegmentedControl<Source>
          stretch
          value={source}
          onChange={setSource}
          options={[{ value: 'wardrobe', label: 'Từ tủ đồ' }, { value: 'upload', label: 'Tải ảnh lên' }]}
        />
        {source === 'wardrobe'
          ? items.length === 0
            ? <AppText variant="subhead" style={{ textAlign: 'center' }}>Tủ đồ đang trống. Hãy thêm món đồ hoặc chọn “Tải ảnh lên”.</AppText>
            : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {items.map((item) => {
                  const active = item.id === garmentId;
                  return <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={item.name} onPress={() => setGarmentId(item.id)}
                    style={{ width: 96, gap: spacing.xs, padding: spacing.xs, borderRadius: radius.lg, borderWidth: 2, borderColor: active ? brand.accent : 'transparent', backgroundColor: colors.surface }}>
                    <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ width: '100%', height: 96, borderRadius: radius.md }} contentFit="contain"/>
                    <AppText variant="caption" numberOfLines={1}>{item.name}</AppText>
                  </Pressable>;
                })}
              </ScrollView>
          : <View style={{ gap: spacing.sm }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Chọn ảnh món đồ" onPress={() => void pickUpload()}
                style={{ height: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.separator, backgroundColor: colors.surface, overflow: 'hidden' }}>
                {uploaded
                  ? <Image source={{ uri: uploaded.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain"/>
                  : <><AppIcon name="gallery" size={28} color={brand.accent}/><AppText variant="caption">Chọn ảnh món đồ</AppText></>}
              </Pressable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {categories.map((category) => <Pressable key={category} accessibilityRole="radio" accessibilityState={{ selected: uploadCategory === category }} onPress={() => setUploadCategory(category)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: uploadCategory === category ? brand.primary : colors.surface }}>
                  <AppText variant="caption" style={{ color: uploadCategory === category ? colors.onBrand : colors.secondaryLabel, fontWeight: '700' }}>{categoryNames[category]}</AppText>
                </Pressable>)}
              </View>
              <AppText variant="caption">Ảnh chụp riêng món đồ trên nền trơn cho kết quả tốt nhất; tránh ảnh có người đang mặc. Ảnh chỉ dùng cho phiên này, không lưu vào tủ đồ.</AppText>
            </View>}
      </View>}

      {canAdjustReference && <View style={{ gap: spacing.xs }}>
        <AppText variant="caption" style={{ fontWeight: '700', color: colors.label }}>Chế độ</AppText>
        <SegmentedControl<LivePreviewSpeed>
          stretch
          value={speed}
          onChange={(value) => {
            if (value === 'fast' && !info.fastModeIncluded) { setError('Chế độ Nhanh dành cho gói Pro và Max.'); return; }
            setPreferredSpeed(value);
          }}
          options={[
            { value: 'standard', label: 'Tiêu chuẩn' },
            { value: 'fast', label: info.fastModeIncluded ? 'Nhanh' : 'Nhanh · Pro', icon: info.fastModeIncluded ? undefined : 'lock' },
          ]}
        />
        <AppText variant="caption">{speed === 'fast'
          ? `Phản hồi nhanh hơn khi bạn cử động · ${info.fastCost} lượt mỗi phiên.`
          : info.fastModeIncluded ? 'Chất lượng như nhau, độ trễ cao hơn chế độ Nhanh · 1 lượt mỗi phiên.' : '1 lượt mỗi phiên. Gói Pro và Max có thêm chế độ Nhanh.'}</AppText>
      </View>}

      {framing && <View style={{ gap: spacing.xs }}>
        <AppText variant="caption">Đưa vùng mặc món đồ vào giữa khung. Hướng về nơi đủ sáng và giữ tay tránh che trang phục.</AppText>
        <AppText variant="caption">Camera đang hiển thị trên thiết bị. Bấm bắt đầu để gửi video và ảnh món đồ sang dịch vụ thử.</AppText>
      </View>}
      {error && <Notice tone="error" text={error} onDismiss={() => setError(null)}/>}

      {phase === 'live'
        ? <AppButton title="Dừng" variant="secondary" onPress={() => stop()}/>
        : framing ? <>
            <AppButton title={`Bắt đầu ${info.sessionSeconds} giây (dùng ${sessionCost} lượt)`} disabled={!canUseSession} onPress={confirmFrame}/>
            <AppButton title="Quay lại chọn đồ" variant="secondary" onPress={() => stop('idle')}/>
          </> : <AppButton
            title="Căn khung camera"
            icon="camera"
            loading={busy}
            disabled={!canOpenCamera || !canUseSession}
            onPress={() => void start()}/>}
      {exhausted && <AppButton title="Nâng cấp để có thêm lượt" variant="secondary" onPress={() => router.push('/plans')}/>}
    </>}
  </ScrollView>;
}
