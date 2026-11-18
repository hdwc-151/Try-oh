import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, ZoomIn, ZoomOut, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppIcon } from '@/components/icon';
import { AppText } from '@/components/app-text';
import { Notice } from '@/components/notice';
import { OutfitAngles } from '@/components/outfit-angles';
import { PressableScale } from '@/components/pressable-scale';
import { PreviewableImage } from '@/components/previewable-image';
import { RevealOverlay } from '@/components/reveal-overlay';
import { WeatherCard } from '@/components/weather-card';
import { useShake } from '@/hooks/use-shake';
import { haptic } from '@/services/haptics';
import { pickOutfit } from '@/services/outfit-picker';
import { router, useFocusEffect } from 'expo-router';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useAuth } from '@/providers/auth-provider';
import { ApiError, apiRequest, protectedImageSource } from '@/services/api-client';
import { generateTryOn } from '@/services/generation-api';
import { imageUploadFile } from '@/services/image-upload';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import { categoryNames } from '@/screens/wardrobe';
import type { Garment, LivePreviewStatus, PageResponse, PersonImage, PlanSnapshot, TryOnResult } from '@/types/api';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

type TryOnNotice = { tone: 'success' | 'info'; text: string };
/** Thời gian ước tính một lần tạo ảnh, dùng cho thanh tiến độ (chỉ để báo hiệu, không phải tiến độ thật). */
const EXPECTED_GENERATION_MS = 45_000;
const GARMENT_PAGE_SIZE = 40;
/** Mẹo hiện luân phiên trong lúc chờ tạo ảnh. */
const WAITING_TIPS = [
  'Áo sáng màu + quần tối màu luôn là công thức an toàn.',
  'Sơ vin nhẹ phía trước giúp chân trông dài hơn.',
  'Một món phụ kiện nổi bật là đủ, đừng để tất cả cùng "nói".',
  'Đồ oversize hợp nhất khi phần còn lại gọn gàng.',
  'Giày cùng tông với quần giúp dáng liền mạch.',
  'Ảnh rõ người, đủ sáng thì AI phối càng chuẩn.',
];

export function TryOnScreen({ onOpenWardrobe, active = true }: { onOpenWardrobe?: () => void; active?: boolean } = {}) {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<TryOnNotice | null>(null);
  // Phải tích lại mỗi khi đổi ảnh toàn thân, giống bản web.
  const [privacyConsent, setPrivacyConsent] = useState(false);
  // Tắt: nền studio xám trơn. Bật: giữ nguyên bối cảnh trong ảnh gốc.
  const [keepBackground, setKeepBackground] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Ảnh trước khi có kết quả mới: phủ lên rồi bị "quét" đi để lộ outfit mới.
  const [revealFrom, setRevealFrom] = useState<string | null>(null);
  const clearReveal = useCallback(() => setRevealFrom(null), []);
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const person = useQuery({ queryKey: ['person-image'], queryFn: () => apiRequest<{ item: PersonImage | null }>('/api/person-image') });
  const garments = useInfiniteQuery({
    queryKey: ['garments', 'catalog'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiRequest<PageResponse<Garment>>(`/api/garments?limit=${GARMENT_PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
  const results = useQuery({ queryKey: ['try-on-results'], queryFn: () => apiRequest<{ items: TryOnResult[] }>('/api/generations/results') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiRequest<PlanSnapshot>('/api/plans') });
  // Lỗi ở đây không chặn phòng thử: chỉ ẩn nút thử trực tiếp.
  const livePreview = useQuery({ queryKey: ['live-preview-status'], queryFn: () => apiRequest<LivePreviewStatus>('/api/live-preview/status') });
  const garmentItems = useMemo(() => garments.data?.pages.flatMap((page) => page.items) ?? [], [garments.data?.pages]);
  const selectedGarmentIds = selected.filter((id) => garmentItems.some((item) => item.id === id));
  const searchTerm = normalize(deferredSearch);
  const visibleGarments = useMemo(() => searchTerm
    ? garmentItems.filter((item) => normalize(item.name + ' ' + categoryNames[item.category]).includes(searchTerm))
    : garmentItems, [garmentItems, searchTerm]);
  // Đang tìm thì tải nốt các trang còn lại để không bỏ sót món ở cuối tủ.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = garments;
  useEffect(() => {
    if (searchTerm && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [searchTerm, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const upload = useMutation({
    mutationFn: async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Cần quyền truy cập thư viện ảnh để chọn ảnh toàn thân.');
      // Không bật khung cắt: trên iOS khung cắt của hệ thống luôn vuông (bỏ qua `aspect`),
      // nên ảnh toàn thân bị mất đầu/chân và mất một phần outfit. Gửi nguyên ảnh lên máy chủ.
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.9 });
      if (picked.canceled) return null;
      const asset = picked.assets[0];
      const form = new FormData();
      form.append('personImage', imageUploadFile(asset, 'person.jpg'));
      return apiRequest<PersonImage>('/api/person-image', { method: 'POST', body: form });
    },
    onSuccess: (item) => {
      if (!item) return;
      queryClient.setQueryData(['person-image'], { item });
      queryClient.setQueryData(['try-on-results'], { items: [] });
      setPrivacyConsent(false);
      void queryClient.invalidateQueries({ queryKey: ['try-on-results'] });
      setNotice({ tone: 'success', text: 'Ảnh toàn thân đã sẵn sàng.' });
    },
  });
  const deletePerson = useMutation({
    mutationFn: () => apiRequest<{ deleted: boolean }>('/api/person-image', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData(['person-image'], { item: null });
      setPrivacyConsent(false);
      setNotice({ tone: 'success', text: 'Đã gỡ ảnh tải lên. Các outfit đã tạo vẫn được giữ nguyên.' });
    },
  });
  const generate = useMutation({
    retry: false,
    mutationFn: (angle: 'front' | 'back') => generateTryOn(angle,
      { garmentIds: selectedGarmentIds, privacyConfirmed: privacyConsent, preservePose: true, keepBackground },
      {
        userId: session?.user.id ?? '',
        personImage: person.data?.item?.imageUrl ?? '',
        frontReference: angle === 'back' ? results.data?.items.find((item) => item.angle === 'front')?.imageUrl ?? '' : '',
      }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['try-on-results'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
    onSuccess: (item) => {
      if (item.angle === 'front') {
        const previous = queryClient.getQueryData<{ items: TryOnResult[] }>(['try-on-results'])?.items.find((result) => result.angle === 'front')?.imageUrl
          ?? queryClient.getQueryData<{ item: PersonImage | null }>(['person-image'])?.item?.imageUrl;
        if (previous) setRevealFrom(previous);
      }
      haptic.success();
      queryClient.setQueryData<{ items: TryOnResult[] }>(['try-on-results'], (current) => ({
        items: item.angle === 'front'
          ? [item]
          : [item, ...(current?.items ?? []).filter((result) => result.angle === 'front')],
      }));
      void queryClient.invalidateQueries({ queryKey: ['saved-outfits'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      if (item.outfitSaved === false) {
        // Ảnh đã tạo (và đã trừ lượt) nhưng mục Outfit đã đầy theo gói.
        setNotice({ tone: 'info', text: 'Đã tạo ảnh, nhưng mục Outfit đã đầy nên outfit chưa được lưu. Xoá bớt outfit cũ hoặc nâng gói để lưu thêm.' });
        return;
      }
      setNotice({ tone: 'success', text: item.angle === 'front' ? 'Đã tạo góc trước và lưu vào mục Outfit.' : 'Đã bổ sung góc sau cho outfit.' });
    },
  });
  // Lắc máy để phối ngẫu nhiên từ tủ đồ (chỉ khi phòng thử đang hiện).
  const shakeMax = plans.data?.current.entitlements.selectedGarments ?? 8;
  useShake(active && focused && garmentItems.length >= 2 && !generate.isPending, () => {
    const outfit = pickOutfit(garmentItems, { random: Math.random, maxItems: shakeMax });
    if (outfit.ids.length < 2) return;
    haptic.medium();
    setSelected(outfit.ids);
    setNotice({ tone: 'info', text: 'Đã phối ngẫu nhiên ' + outfit.ids.length + ' món — lắc tiếp để đổi bộ khác.' });
  });
  const loading = person.data === undefined || garments.data === undefined || results.data === undefined || plans.data === undefined;
  const loadError = person.error ?? garments.error ?? results.error ?? plans.error;
  if (loadError) return <ScreenError message={loadError instanceof Error ? loadError.message : 'Không thể mở phòng thử.'} onRetry={() => { void person.refetch(); void garments.refetch(); void results.refetch(); void plans.refetch(); }}/>;
  if (loading) return <ScreenLoading variant="cards" label="Đang chuẩn bị phòng thử…"/>;

  const maxSelected = plans.data!.current.entitlements.selectedGarments;
  const latestFront = results.data!.items.find((item) => item.angle === 'front');
  const latestBack = results.data!.items.find((item) => item.angle === 'back');
  const mutationError = upload.error ?? deletePerson.error ?? generate.error;
  const exhausted = mutationError instanceof ApiError && mutationError.status === 402;
  const mutationTitle = exhausted
    ? 'Bạn đã dùng hết lượt tạo ảnh.'
    : upload.error
      ? 'Chưa thể tải ảnh'
      : deletePerson.error
        ? 'Chưa thể gỡ ảnh'
        : 'Chưa thể tạo ảnh';
  const toggle = (id: string) => {
    const available = selected.filter((itemId) => garmentItems.some((item) => item.id === itemId));
    if (!available.includes(id) && available.length >= maxSelected) {
      // Không im lặng bỏ qua lần chạm: nói rõ vì sao chưa chọn được.
      haptic.warning();
      setNotice({ tone: 'info', text: 'Gói hiện tại cho phối tối đa ' + maxSelected + ' món mỗi lần. Bỏ chọn một món để đổi món khác.' });
      return;
    }
    setNotice(null);
    haptic.select();
    setSelected(available.includes(id) ? available.filter((item) => item !== id) : [...available, id]);
  };
  // Bắt đầu thao tác mới thì bỏ lỗi cũ của thao tác khác, tránh lỗi "treo" mãi trên màn.
  const startUpload = () => { setNotice(null); deletePerson.reset(); generate.reset(); upload.mutate(); };
  const startDelete = () => { setNotice(null); upload.reset(); generate.reset(); deletePerson.mutate(); };
  const startGenerate = (angle: 'front' | 'back') => { setNotice(null); upload.reset(); deletePerson.reset(); generate.mutate(angle); };

  const personItem = person.data!.item;
  const selectedItems = selectedGarmentIds
    .map((id) => garmentItems.find((item) => item.id === id))
    .filter((item): item is Garment => Boolean(item));
  const visibleSelected = selectedItems.slice(0, 3);
  const hiddenCount = selectedItems.length - visibleSelected.length;
  const preview = latestFront?.imageUrl ?? personItem?.imageUrl ?? null;
  const generatingFront = generate.isPending && generate.variables === 'front';
  const canGenerate = !generate.isPending && Boolean(personItem) && selectedGarmentIds.length > 0 && privacyConsent;
  const generateHint = !personItem
    ? 'Thêm ảnh toàn thân để bắt đầu.'
    : selectedGarmentIds.length === 0
      ? 'Chọn món đồ bên dưới để phối.'
      : !privacyConsent
        ? 'Tích xác nhận sử dụng ảnh để tạo outfit.'
        : null;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.lg }}>
    {garmentItems.length >= 2 && <WeatherCard
      garments={garmentItems}
      maxItems={maxSelected}
      onApply={(ids) => {
        setSelected(ids);
        setNotice({ tone: 'success', text: 'Đã chọn bộ gợi ý. Bấm "Tạo outfit ngay" để mặc thử.' });
      }}/>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: '36%', gap: spacing.sm }}>
        {visibleSelected.length === 0
          ? <Pressable accessibilityRole="button" accessibilityLabel="Chọn món đồ" onPress={onOpenWardrobe} style={({ pressed }) => ({ aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.separator, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 })}>
              <AppIcon name="plus" size={22} color={brand.accent}/>
              <AppText variant="caption" style={{ textAlign: 'center' }}>Chọn đồ bên dưới</AppText>
            </Pressable>
          : visibleSelected.map((item, index) => <Animated.View key={item.id} entering={ZoomIn.duration(220)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(220)} style={{ aspectRatio: 1, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface, boxShadow: '0 2px 10px rgba(20, 26, 60, 0.06)' }}>
              <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ flex: 1, margin: spacing.sm }} contentFit="contain"/>
              <CheckBadge/>
              {index === visibleSelected.length - 1 && hiddenCount > 0 && <View style={{ position: 'absolute', bottom: 6, right: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, backgroundColor: brand.primary }}><AppText variant="caption" style={{ color: colors.onBrand, fontWeight: '700' }}>+{hiddenCount}</AppText></View>}
            </Animated.View>)}
      </View>
      <AppIcon name="arrow" size={26} color={brand.primary}/>
      <View style={{ flex: 1 }}>
        {preview
          ? <OutfitAngles
              front={preview}
              back={latestFront ? latestBack?.imageUrl : null}
              onPressImage={(uri, angle) => router.push({ pathname: '/image-viewer', params: { uri, title: !latestFront ? 'Ảnh toàn thân' : angle === 'back' ? 'Outfit · góc sau' : 'Outfit · góc trước' } })}
              overlay={generate.isPending
                ? <GeneratingOverlay key={generate.submittedAt} angle={generate.variables ?? 'front'} garments={selectedItems}/>
                : revealFrom ? <RevealOverlay key={revealFrom} from={revealFrom} onDone={clearReveal}/> : null}
            />
          : <Pressable accessibilityRole="button" accessibilityLabel="Thêm ảnh toàn thân" onPress={startUpload} disabled={upload.isPending} style={({ pressed }) => ({ width: '100%', aspectRatio: 3 / 5, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.separator, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 })}>
              <AppIcon name="photo" size={32} color={brand.accent}/>
              <AppText variant="headline" style={{ textAlign: 'center' }}>{upload.isPending ? 'Đang tải ảnh…' : 'Thêm ảnh toàn thân'}</AppText>
              <AppText variant="caption" style={{ textAlign: 'center' }}>Ảnh rõ người, đủ sáng</AppText>
            </Pressable>}
      </View>
    </View>

    <View style={{ gap: spacing.sm }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Tạo outfit ngay"
        accessibilityState={{ disabled: !canGenerate, busy: generatingFront }}
        disabled={!canGenerate}
        onPress={() => startGenerate('front')}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 58, borderRadius: radius.full, borderCurve: 'continuous', backgroundColor: brand.primary, opacity: !canGenerate && !generatingFront ? 0.45 : 1, boxShadow: canGenerate ? '0 8px 20px rgba(20, 26, 60, 0.22)' : undefined }}>
        {generatingFront
          ? <><ActivityIndicator color={colors.onBrand}/><AppText variant="headline" style={{ color: colors.onBrand }}>Đang tạo outfit…</AppText></>
          : <><AppIcon name="sparkles" size={22} color={colors.onBrand}/><AppText variant="headline" style={{ color: colors.onBrand, fontSize: 19 }}>Tạo outfit ngay</AppText></>}
      </PressableScale>
      {generateHint && <AppText variant="caption" style={{ textAlign: 'center' }}>{generateHint}</AppText>}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: privacyConsent, disabled: !personItem }}
        accessibilityLabel="Xác nhận sử dụng ảnh"
        disabled={!personItem}
        onPress={() => setPrivacyConsent((value) => !value)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: privacyConsent ? brand.accent : 'transparent', backgroundColor: colors.surface, opacity: personItem ? 1 : 0.5 }}>
        <Animated.View key={privacyConsent ? 'on' : 'off'} entering={privacyConsent ? ZoomIn.duration(180) : FadeIn.duration(120)}>
          <AppIcon name={privacyConsent ? 'checkboxOn' : 'checkboxOff'} size={24} color={privacyConsent ? brand.accent : colors.secondaryLabel}/>
        </Animated.View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="caption" style={{ fontWeight: '700', color: colors.label }}>Xác nhận sử dụng ảnh</AppText>
          <AppText variant="caption">Tôi xác nhận đây là ảnh của mình và đồng ý gửi ảnh tới dịch vụ AI để tạo kết quả thử đồ.</AppText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: keepBackground }}
        accessibilityLabel="Giữ background ảnh gốc"
        onPress={() => setKeepBackground((value) => !value)}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: keepBackground ? brand.accent : 'transparent', backgroundColor: colors.surface }}>
        <Animated.View key={keepBackground ? 'on' : 'off'} entering={keepBackground ? ZoomIn.duration(180) : FadeIn.duration(120)}>
          <AppIcon name={keepBackground ? 'checkboxOn' : 'checkboxOff'} size={24} color={keepBackground ? brand.accent : colors.secondaryLabel}/>
        </Animated.View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="caption" style={{ fontWeight: '700', color: colors.label }}>Giữ background ảnh gốc</AppText>
          <AppText variant="caption">{keepBackground ? 'Giữ nguyên bối cảnh trong ảnh của bạn.' : 'Tắt: dùng nền studio xám trơn.'}</AppText>
        </View>
      </Pressable>
      {livePreview.data?.enabled && <AppButton
        title={`Thử trực tiếp ${livePreview.data.sessionSeconds} giây bằng camera`}
        icon="camera"
        variant="secondary"
        onPress={() => router.push({ pathname: '/live-preview', params: selectedGarmentIds[0] ? { garmentId: selectedGarmentIds[0] } : {} })}/>}
      {latestFront && <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {personItem && <AppButton title="Trước / Sau" icon="sparkles" variant="secondary" style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/compare', params: { before: personItem.imageUrl, after: latestFront.imageUrl } })}/>}
        <AppButton title="Chia sẻ" icon="link" variant="secondary" style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/share-card', params: { uri: latestFront.imageUrl } })}/>
      </View>}
      {latestFront && <AppButton title="Thêm góc sau" variant="secondary" loading={generate.isPending && generate.variables === 'back'} disabled={generate.isPending || selectedGarmentIds.length === 0 || !privacyConsent} onPress={() => startGenerate('back')}/>}
    </View>

    {mutationError && <Notice tone="error" title={mutationTitle} text={exhausted ? 'Hãy đăng ký thêm để tiếp tục tạo ảnh.' : mutationError instanceof Error ? mutationError.message : 'Dịch vụ chưa được hỗ trợ, vui lòng thử ảnh khác.'}/>}
    {exhausted && <AppButton title="Xem các gói đăng ký" variant="secondary" onPress={() => router.push('/plans')}/>}
    {notice && <Notice key={notice.text} tone={notice.tone} text={notice.text} onDismiss={() => setNotice(null)} autoHideMs={notice.tone === 'success' ? 4000 : 7000}/>}

    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">Chọn món đồ</AppText>
          {garmentItems.length >= 2 && <AppText variant="caption">Lắc máy để phối ngẫu nhiên</AppText>}
        </View>
        <AppText variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{selectedGarmentIds.length}/{maxSelected}</AppText>
        {garmentItems.length > 0 && <Pressable
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Đóng tìm kiếm' : 'Tìm món đồ'}
          hitSlop={8}
          onPress={() => { if (searchOpen) setSearch(''); setSearchOpen((value) => !value); }}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: searchOpen ? brand.secondary : colors.surface }}>
          <AppIcon name={searchOpen ? 'close' : 'search'} size={20} color={brand.primary}/>
        </Pressable>}
      </View>
      {searchOpen && <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface }}>
        <AppIcon name="search" size={18} color={colors.secondaryLabel}/>
        <TextInput
          autoFocus
          value={search}
          onChangeText={setSearch}
          placeholder="Tìm theo tên hoặc loại đồ"
          placeholderTextColor={colors.secondaryLabel}
          returnKeyType="search"
          style={{ flex: 1, minHeight: 44, color: colors.label, fontSize: 16 }}
        />
        {search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Xoá từ khoá" hitSlop={8} onPress={() => setSearch('')}><AppIcon name="close" size={18} color={colors.secondaryLabel}/></Pressable>}
      </Animated.View>}
      {garmentItems.length === 0
        ? <View style={{ paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm, borderRadius: radius.xl, backgroundColor: colors.surface }}>
            <AppText variant="headline">Tủ đồ đang trống</AppText>
            <AppText variant="subhead" style={{ textAlign: 'center' }}>Thêm món đầu tiên trong mục Tủ đồ.</AppText>
            {onOpenWardrobe && <AppButton title="Mở Tủ đồ" variant="secondary" onPress={onOpenWardrobe}/>}
          </View>
        : searchTerm && visibleGarments.length === 0 && !hasNextPage
          ? <AppText variant="subhead" style={{ paddingVertical: spacing.lg, textAlign: 'center' }}>Không tìm thấy món nào khớp “{search.trim()}”.</AppText>
          : <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
            {visibleGarments.map((item) => {
              const active = selected.includes(item.id);
              return <PressableScale key={item.id} accessibilityRole="checkbox" accessibilityLabel={item.name} accessibilityState={{ checked: active }} onPress={() => toggle(item.id)} scaleTo={0.94} style={{ width: 112, gap: spacing.xs, padding: spacing.xs, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 2, borderColor: active ? brand.accent : 'transparent', backgroundColor: colors.surface }}>
                <Image source={protectedImageSource(item.frontProcessedUrl, session?.access_token, 320)} style={{ width: '100%', height: 112, borderRadius: radius.md, backgroundColor: colors.groupedBackground }} contentFit="contain" transition={180}/>
                <AppText variant="caption" numberOfLines={1} style={{ paddingHorizontal: 2, color: active ? brand.primary : colors.secondaryLabel, fontWeight: active ? '700' : '500' }}>{item.name}</AppText>
                {active && <CheckBadge animated/>}
              </PressableScale>;
            })}
            {!searchTerm && garments.hasNextPage && <Pressable accessibilityRole="button" onPress={() => void garments.fetchNextPage()} disabled={garments.isFetchingNextPage} style={{ width: 112, alignItems: 'center', justifyContent: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface }}><AppText variant="headline" style={{ textAlign: 'center', color: brand.accent }}>{garments.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}</AppText></Pressable>}
          </ScrollView>}
    </View>

    <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {personItem
          ? <PreviewableImage uri={personItem.imageUrl} title="Ảnh toàn thân" style={{ width: 56, height: 72, borderRadius: radius.md, backgroundColor: colors.groupedBackground }} contentFit="cover"/>
          : <View style={{ width: 56, height: 72, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}><AppIcon name="photo" size={24} color={brand.accent}/></View>}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline">Ảnh của bạn</AppText>
          <AppText variant="caption">{personItem ? 'Dùng cho mọi lần thử đồ.' : 'Chọn ảnh toàn thân, rõ người và đủ sáng.'}</AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <AppButton title={personItem ? 'Đổi ảnh' : 'Chọn ảnh toàn thân'} variant="secondary" loading={upload.isPending} onPress={startUpload} style={{ flex: 1 }}/>
        {personItem && <AppButton title="Gỡ ảnh" variant="destructive" loading={deletePerson.isPending} disabled={upload.isPending} onPress={() => Alert.alert(
          'Gỡ ảnh đã tải lên?',
          'Chỉ ảnh toàn thân hiện tại bị gỡ. Các outfit đã tạo vẫn được giữ nguyên.',
          [
            { text: 'Huỷ', style: 'cancel' },
            { text: 'Gỡ ảnh', style: 'destructive', onPress: startDelete },
          ],
        )} style={{ flex: 1 }}/>}
      </View>
    </View>

  </ScrollView>;
}

/**
 * Lớp phủ trên ảnh trong lúc AI đang tạo outfit: nền "thở" nhẹ, các món đã chọn lần lượt bay vào
 * giữa ảnh như đang được mặc lên, mẹo phối đồ đổi mỗi vài giây, thanh tiến độ ước tính
 * (chạy chậm dần, dừng ở 92% tới khi có kết quả) và thời gian đã chờ.
 */
function GeneratingOverlay({ angle, garments }: { angle: 'front' | 'back'; garments: Garment[] }) {
  const brand = useBrandColors();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  const progress = useSharedValue(0);
  const [elapsed, setElapsed] = useState(0);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * WAITING_TIPS.length));
  useEffect(() => {
    if (!reduceMotion) {
      pulse.set(withRepeat(withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ), -1));
    }
    progress.set(withTiming(0.92, { duration: EXPECTED_GENERATION_MS * 1.6, easing: Easing.out(Easing.cubic) }));
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds > 0 && seconds % 5 === 0) setTip((value) => (value + 1) % WAITING_TIPS.length);
    }, 1000);
    return () => { cancelAnimation(pulse); cancelAnimation(progress); clearInterval(timer); };
  }, [pulse, progress, reduceMotion]);
  const backdrop = useAnimatedStyle(() => ({ opacity: 0.5 + pulse.get() * 0.2 }));
  const bar = useAnimatedStyle(() => ({ width: (progress.get() * 100) + '%' }));
  const flying = garments.slice(0, 4);
  return <Animated.View
    entering={FadeIn.duration(220)}
    exiting={FadeOut.duration(260)}
    accessibilityRole="progressbar"
    accessibilityLabel="Đang tạo outfit"
    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: brand.primary }, backdrop]}/>
    {!reduceMotion && flying.map((item, index) => <FlyingGarment key={item.id} garment={item} index={index} count={flying.length}/>)}
    <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.md, width: '100%' }}>
      <AppIcon name="sparkles" size={30} color={colors.onBrand}/>
      <AppText variant="headline" style={{ color: colors.onBrand, textAlign: 'center' }}>{angle === 'front' ? 'Đang mặc thử…' : 'Đang tạo góc sau…'}</AppText>
      <View style={{ width: '70%', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.25)' }}>
        <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: brand.sparkle }, bar]}/>
      </View>
      <AppText variant="caption" style={{ color: colors.onBrand, opacity: 0.85, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{elapsed}s · thường mất 20–60 giây</AppText>
      <Animated.View key={tip} entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)} style={{ minHeight: 34, paddingHorizontal: spacing.sm }}>
        <AppText variant="caption" style={{ color: colors.onBrand, textAlign: 'center', fontStyle: 'italic' }}>💡 {WAITING_TIPS[tip]}</AppText>
      </Animated.View>
    </View>
  </Animated.View>;
}

/** Một món đồ bay từ mép dưới vào giữa ảnh rồi mờ đi, lặp lại lệch nhịp với các món khác. */
function FlyingGarment({ garment, index, count }: { garment: Garment; index: number; count: number }) {
  const { session } = useAuth();
  const value = useSharedValue(0);
  useEffect(() => {
    const cycle = 2400;
    value.set(withDelay(index * (cycle / Math.max(count, 1)), withRepeat(withTiming(1, { duration: cycle, easing: Easing.inOut(Easing.cubic) }), -1)));
    return () => cancelAnimation(value);
  }, [count, index, value]);
  // Mỗi món xuất phát từ một góc khác nhau ở mép dưới.
  const startX = (index - (count - 1) / 2) * 70;
  const style = useAnimatedStyle(() => {
    const t = value.get();
    return {
      opacity: t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1,
      transform: [
        { translateX: startX * (1 - t) },
        { translateY: 140 * (1 - t) - 20 },
        { scale: 0.9 - t * 0.5 },
        { rotate: (1 - t) * (index % 2 ? 18 : -18) + 'deg' },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 64, height: 64, borderRadius: 14, padding: 4, backgroundColor: 'rgba(255,255,255,0.92)' }, style]}>
    <Image source={protectedImageSource(garment.frontProcessedUrl, session?.access_token, 160)} style={{ flex: 1 }} contentFit="contain"/>
  </Animated.View>;
}

function CheckBadge({ animated = false }: { animated?: boolean }) {
  const brand = useBrandColors();
  return <Animated.View
    entering={animated ? ZoomIn.duration(180) : undefined}
    exiting={animated ? ZoomOut.duration(120) : undefined}
    style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.accent, borderWidth: 2, borderColor: colors.surface }}>
    <AppIcon name="check" size={13} color={colors.onBrand}/>
  </Animated.View>;
}
