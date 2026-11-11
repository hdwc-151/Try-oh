import { useInfiniteQuery, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { BottomSheet } from '@/components/bottom-sheet';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { OutfitAngles } from '@/components/outfit-angles';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useSheetItem } from '@/hooks/use-sheet-item';
import { useAuth } from '@/providers/auth-provider';
import { ApiError, apiRequest, protectedImageSource } from '@/services/api-client';
import { clearPendingExtract, markPendingExtract, readOutfitTitles, readPendingExtract, removeOutfitTitle, writeOutfitTitle } from '@/services/device-store';
import { imageUploadFile } from '@/services/image-upload';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { CreditStatus, Garment, GarmentCategory, OutfitPolicy, OutfitVisibility, PageResponse, PlanSnapshot, SavedOutfit, SocialSnapshot } from '@/types/api';

type AiExtractedGarment = { id: string; category: GarmentCategory; name: string; studioImageUrl: string };

export type CatalogMode = 'garments' | 'outfits';
type CategoryFilter = 'all' | GarmentCategory;
type OutfitFilter = 'all' | 'complete' | 'front-only';
type CatalogEntry =
  | { key: string; type: 'garment'; item: Garment }
  | { key: string; type: 'outfit'; item: SavedOutfit };

export const categoryNames: Record<GarmentCategory, string> = {
  tops: 'Áo',
  outerwear: 'Áo khoác',
  bottoms: 'Quần / váy',
  shoes: 'Giày',
  accessories: 'Phụ kiện',
};
const categoryValues = Object.keys(categoryNames) as GarmentCategory[];

const categories: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  ...categoryValues.map((value) => ({ value, label: categoryNames[value] })),
];

const outfitFilters: { value: OutfitFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'complete', label: 'Đủ hai góc' },
  { value: 'front-only', label: 'Chỉ góc trước' },
];

const visibilityOptions: { value: OutfitVisibility; label: string }[] = [
  { value: 'private', label: 'Chỉ mình tôi' },
  { value: 'friends', label: 'Bạn bè' },
  { value: 'groups', label: 'Nhóm' },
];

const PAGE_SIZE = 40;
/** Số món tối đa AI tách từ một ảnh (khớp MAX_DETECTED_TARGETS ở máy chủ). */
const MAX_EXTRACT_ITEMS = 5;
const EXTRACT_KEY = ['ai-extract'];
const EXTRACT_TIMEOUT_MS = 300_000;

/** `fixedMode` khoá màn ở một chế độ và ẩn công tắc Món đồ/Outfit (segment Tủ đồ, tab Yêu thích). */
export function WardrobeScreen({ fixedMode }: { fixedMode?: CatalogMode } = {}) {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const [selectedMode, setMode] = useState<CatalogMode>('garments');
  const mode = fixedMode ?? selectedMode;
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [outfitFilter, setOutfitFilter] = useState<OutfitFilter>('all');
  const [message, setMessage] = useState<string | null>(null);
  // Giữ mục đang sửa trong lúc tấm trượt chạy hiệu ứng đóng, nội dung không biến mất giữa chừng.
  const extractSheet = useSheetItem<ImagePicker.ImagePickerAsset>();
  const garmentSheet = useSheetItem<Garment>();
  const outfitSheet = useSheetItem<SavedOutfit>();
  const columns = width >= 700 ? 3 : 2;
  // Bề rộng cố định mỗi ô: hàng chỉ có 1 món không bị giãn ra cả màn.
  const itemWidth = Math.floor((width - spacing.md * 2 - spacing.md * (columns - 1)) / columns);

  // Lần tách đồ đang chờ máy chủ (kể cả khi app đã tắt giữa chừng): máy chủ vẫn xử lý và tự lưu món đồ.
  const extractRunning = useIsMutating({ mutationKey: EXTRACT_KEY }) > 0;
  const pendingExtract = useQuery({
    queryKey: ['pending-extract'],
    queryFn: readPendingExtract,
    enabled: mode === 'garments',
    refetchInterval: (query) => query.state.data ? 15_000 : false,
  });
  const awaitingServer = !extractRunning && Boolean(pendingExtract.data);

  const garments = useInfiniteQuery({
    queryKey: ['garments', 'catalog'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiRequest<PageResponse<Garment>>(`/api/garments?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    refetchInterval: awaitingServer ? 8_000 : false,
  });
  const outfits = useInfiniteQuery({
    queryKey: ['saved-outfits', 'catalog'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiRequest<PageResponse<SavedOutfit>>(`/api/generations/outfits?limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiRequest<PlanSnapshot>('/api/plans') });
  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: () => apiRequest<CreditStatus>('/api/generations/credits'),
    enabled: mode === 'garments',
  });
  const social = useQuery({
    queryKey: ['social'],
    queryFn: () => apiRequest<SocialSnapshot>('/api/social'),
    enabled: mode === 'outfits',
  });

  const maxItems = plans.data?.current.entitlements.wardrobeItems ?? 0;
  const unlimited = plans.data?.current.unlimited ?? false;
  const garmentItems = useMemo(() => garments.data?.pages.flatMap((page) => page.items) ?? [], [garments.data?.pages]);
  const outfitItems = useMemo(() => outfits.data?.pages.flatMap((page) => page.items) ?? [], [outfits.data?.pages]);
  const garmentTotal = garments.data?.pages[0]?.total ?? 0;
  const outfitTotal = outfits.data?.pages[0]?.total ?? 0;
  const remainingSlots = unlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, maxItems - garmentTotal);
  const outfitIdsKey = outfitItems.map((item) => item.id).join(',');
  const outfitTitles = useQuery({
    queryKey: ['outfit-titles', outfitIdsKey],
    queryFn: () => readOutfitTitles(outfitIdsKey ? outfitIdsKey.split(',') : []),
    enabled: mode === 'outfits',
  });

  // Món đồ của lần tách đang chờ đã về: dọn trạng thái chờ và báo cho người dùng.
  const pendingBase = pendingExtract.data?.baseTotal;
  useEffect(() => {
    if (extractRunning || pendingBase === undefined || garmentTotal <= pendingBase) return;
    void clearPendingExtract().then(() => {
      void queryClient.invalidateQueries({ queryKey: ['pending-extract'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      setMessage('Món đồ vừa tách đã có trong tủ.');
    });
  }, [extractRunning, garmentTotal, pendingBase, queryClient]);

  const extract = useMutation({
    mutationKey: EXTRACT_KEY,
    mutationFn: async ({ asset, baseTotal }: { asset: ImagePicker.ImagePickerAsset; baseTotal: number }) => {
      await markPendingExtract(baseTotal);
      void queryClient.invalidateQueries({ queryKey: ['pending-extract'] });
      const form = new FormData();
      form.append('file', imageUploadFile(asset, 'garment.jpg'));
      form.append('category', 'tops');
      form.append('persist', 'true');
      const result = await apiRequest<{ items: AiExtractedGarment[]; garments: Garment[] }>('/api/garments/ai-extract', {
        method: 'POST',
        body: form,
        timeoutMs: EXTRACT_TIMEOUT_MS,
      });
      return result.garments;
    },
    onSuccess: async (items) => {
      await clearPendingExtract();
      setMessage(items.length === 0
        ? 'Không nhận diện được món đồ nào trong ảnh. Lượt chưa dùng đã được hoàn lại.'
        : items.length === 1 ? 'Đã thêm 1 món đồ vào tủ.' : 'Đã thêm ' + items.length + ' món đồ vào tủ.');
    },
    onError: async (error) => {
      // Mất kết nối giữa chừng: máy chủ có thể vẫn đang xử lý, giữ trạng thái chờ để tự tải lại khi xong.
      if (!(error instanceof ApiError && error.status === 0)) await clearPendingExtract();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['garments'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      void queryClient.invalidateQueries({ queryKey: ['pending-extract'] });
    },
  });

  const pickImage = async () => {
    setMessage(null);
    extract.reset();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Cần quyền truy cập ảnh', 'Hãy cho phép Fitsy truy cập thư viện ảnh để thêm món đồ.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.9 });
    if (!picked.canceled) extractSheet.show(picked.assets[0]);
  };

  const entries = useMemo<CatalogEntry[]>(() => {
    if (mode === 'garments') {
      return garmentItems
        .filter((item) => category === 'all' || item.category === category)
        .map((item) => ({ key: 'garment-' + item.id, type: 'garment' as const, item }));
    }
    return outfitItems
      .filter((item) => (
        outfitFilter === 'all'
        || (outfitFilter === 'complete' && Boolean(item.backImageUrl))
        || (outfitFilter === 'front-only' && !item.backImageUrl)
      ))
      .map((item) => ({ key: 'outfit-' + item.id, type: 'outfit' as const, item }));
  }, [category, garmentItems, mode, outfitFilter, outfitItems]);

  const loadError = garments.error ?? outfits.error ?? plans.error;
  if (loadError) {
    return <ScreenError
      message={loadError instanceof Error ? loadError.message : 'Không thể tải kho đồ.'}
      onRetry={() => { void garments.refetch(); void outfits.refetch(); void plans.refetch(); }}
    />;
  }
  if (garments.data === undefined || outfits.data === undefined || plans.data === undefined) {
    return <ScreenLoading variant="grid" label={mode === 'garments' ? 'Đang mở tủ đồ…' : 'Đang tải outfit…'}/>;
  }

  const currentCount = mode === 'garments' ? garmentTotal : outfitTotal;
  const currentLimit = mode === 'garments' ? plans.data.current.entitlements.wardrobeItems : plans.data.current.entitlements.savedOutfits;
  const extracting = extractRunning || awaitingServer;
  const extractError = extract.error;
  const policies = social.data?.policies ?? [];

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        key={mode + '-' + columns}
        data={entries}
        numColumns={columns}
        keyExtractor={(entry) => entry.key}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}
        columnWrapperStyle={{ gap: spacing.md }}
        onEndReachedThreshold={0.45}
        onEndReached={() => {
          if (mode === 'garments' && garments.hasNextPage && !garments.isFetchingNextPage) void garments.fetchNextPage();
          if (mode === 'outfits' && outfits.hasNextPage && !outfits.isFetchingNextPage) void outfits.fetchNextPage();
        }}
        refreshControl={<RefreshControl
          refreshing={mode === 'garments' ? garments.isRefetching && !awaitingServer : outfits.isRefetching}
          onRefresh={() => void (mode === 'garments' ? garments.refetch() : outfits.refetch())}
          tintColor={brand.primary as string}
        />}
        ListHeaderComponent={<View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
          {!fixedMode && <View accessibilityRole="tablist" style={{ flexDirection: 'row', minHeight: 44, padding: 2, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.full, backgroundColor: colors.surface }}>
            {([
              { value: 'garments' as const, label: 'Món đồ' },
              { value: 'outfits' as const, label: 'Outfit' },
            ]).map((option) => {
              const selected = mode === option.value;
              return <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => { setMode(option.value); setMessage(null); }}
                style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: selected ? brand.primary : 'transparent' }}>
                <AppText variant="body" style={{ color: selected ? colors.onBrand : colors.label, fontWeight: selected ? '700' : '500' }}>{option.label}</AppText>
              </Pressable>;
            })}
          </View>}

          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <AppText variant="headline">{mode === 'garments' ? 'Món đồ đã thêm' : 'Outfit đã lưu'}</AppText>
            <AppText variant="caption" style={{ fontVariant: ['tabular-nums'] }}>{currentCount}/{unlimited ? '∞' : currentLimit}</AppText>
          </View>

          {mode === 'garments' && (extracting
            ? <Animated.View entering={FadeIn.duration(220)} accessibilityRole="progressbar" accessibilityLabel="Đang tách đồ" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: brand.secondary }}>
                <ActivityIndicator color={brand.accent}/>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="headline">Đang tách đồ bằng AI…</AppText>
                  <AppText variant="caption">Thường mất 30–90 giây. Bạn cứ chuyển sang mục khác, kể cả tắt app; món đồ sẽ tự xuất hiện khi xong.</AppText>
                </View>
              </Animated.View>
            : <AppButton title="Thêm món đồ từ ảnh" icon="sparkles" disabled={remainingSlots === 0} onPress={() => void pickImage()}/>)}
          {mode === 'garments' && !extracting && remainingSlots === 0 && <AppText variant="caption">Tủ đồ đã đầy theo gói hiện tại. Xoá bớt món hoặc nâng gói để thêm.</AppText>}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {(mode === 'garments' ? categories : outfitFilters).map((filter) => {
              const active = mode === 'garments' ? category === filter.value : outfitFilter === filter.value;
              return <Chip key={filter.value} label={filter.label} active={active} onPress={() => {
                if (mode === 'garments') setCategory(filter.value as CategoryFilter);
                else setOutfitFilter(filter.value as OutfitFilter);
              }}/>;
            })}
          </ScrollView>

          {mode === 'garments' && extractError && <Notice
            tone="error"
            text={extractError instanceof ApiError && extractError.status === 0
              ? 'Mất kết nối khi đang tách đồ. Nếu máy chủ đã nhận ảnh, món đồ sẽ tự xuất hiện trong vài phút; nếu không, lượt đã trừ sẽ được hoàn lại.'
              : extractError instanceof Error ? extractError.message : 'Không thể tách đồ từ ảnh này.'}
          />}
          {message && <Notice key={message} tone="success" text={message} onDismiss={() => setMessage(null)} autoHideMs={4500}/>}
        </View>}
        ListEmptyComponent={<Animated.View entering={FadeIn.duration(220)} style={{ flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, marginBottom: spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.secondary }}>
            <AppIcon name={mode === 'garments' ? 'hanger' : 'sparkles'} size={30} color={brand.accent}/>
          </View>
          <AppText variant="headline">{mode === 'garments' ? 'Không có món đồ phù hợp' : 'Không có outfit phù hợp'}</AppText>
          <AppText variant="subhead" style={{ textAlign: 'center' }}>
            {mode === 'garments'
              ? garmentTotal === 0 ? 'Thêm ảnh sản phẩm hoặc ảnh phối đồ để bắt đầu.' : 'Hãy chọn bộ lọc khác.'
              : outfitTotal === 0 ? 'Outfit tạo trong Thử đồ AI sẽ xuất hiện tại đây.' : 'Hãy chọn bộ lọc khác.'}
          </AppText>
        </Animated.View>}
        ListFooterComponent={(mode === 'garments' ? garments.isFetchingNextPage : outfits.isFetchingNextPage)
          ? <View style={{ paddingVertical: spacing.lg }}><ActivityIndicator color={brand.primary as string}/></View>
          : undefined}
        renderItem={({ item: entry, index }) => <Animated.View entering={index < 12 ? FadeIn.duration(240).delay(index * 30) : FadeIn.duration(200)}>
          {entry.type === 'garment'
          ? <PressableScale
              accessibilityRole="button"
              accessibilityLabel={'Sửa ' + entry.item.name}
              onPress={() => garmentSheet.show(entry.item)}
              style={{ width: itemWidth, gap: spacing.xs, padding: spacing.sm, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface, boxShadow: '0 1px 3px rgba(20, 26, 60, 0.05)' }}>
              <Image
                source={protectedImageSource(entry.item.frontProcessedUrl || entry.item.frontOriginalUrl, session?.access_token)}
                recyclingKey={entry.key}
                style={{ width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.groupedBackground }}
                contentFit="contain"
                transition={200}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="headline" numberOfLines={1}>{entry.item.name}</AppText>
                  <AppText variant="caption" style={{ color: brand.accent }}>{categoryNames[entry.item.category]}</AppText>
                </View>
                <AppIcon name="edit" size={18} color={colors.secondaryLabel}/>
              </View>
            </PressableScale>
          : <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Sửa outfit"
              onPress={() => outfitSheet.show(entry.item)}
              style={{ width: itemWidth, gap: spacing.sm, padding: spacing.sm, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surface, boxShadow: '0 1px 3px rgba(20, 26, 60, 0.05)' }}>
              <OutfitAngles compact front={entry.item.frontImageUrl} back={entry.item.backImageUrl}/>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, paddingBottom: spacing.xs }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="headline" numberOfLines={1}>{outfitTitles.data?.[entry.item.id] ?? (entry.item.backImageUrl ? 'Outfit hai góc' : 'Outfit góc trước')}</AppText>
                  <AppText variant="caption" numberOfLines={1}>
                    {entry.item.garmentIds.length} món · {new Date(entry.item.createdAt).toLocaleDateString('vi-VN')}
                    {social.data ? ' · ' + visibilityLabel(policies.find((policy) => policy.outfitId === entry.item.id)?.visibility ?? social.data.me.defaultVisibility) : ''}
                  </AppText>
                </View>
                <AppIcon name="edit" size={18} color={colors.secondaryLabel}/>
              </View>
            </PressableScale>}
        </Animated.View>}
      />

      <ExtractConfirmSheet
        asset={extractSheet.item}
        visible={extractSheet.visible}
        credits={credits.data}
        maxItems={Math.min(MAX_EXTRACT_ITEMS, remainingSlots)}
        onClose={extractSheet.hide}
        onClosed={extractSheet.clear}
        onConfirm={(asset) => {
          extractSheet.hide();
          setMessage(null);
          extract.mutate({ asset, baseTotal: garmentTotal });
        }}
      />
      {garmentSheet.item && <GarmentEditor
        key={garmentSheet.item.id}
        garment={garmentSheet.item}
        visible={garmentSheet.visible}
        onClose={garmentSheet.hide}
        onClosed={garmentSheet.clear}
        onDone={setMessage}
      />}
      {outfitSheet.item && <OutfitEditor
        key={outfitSheet.item.id}
        outfit={outfitSheet.item}
        visible={outfitSheet.visible}
        title={outfitTitles.data?.[outfitSheet.item.id] ?? ''}
        policy={policies.find((policy) => policy.outfitId === outfitSheet.item?.id)}
        social={social.data}
        onClose={outfitSheet.hide}
        onClosed={outfitSheet.clear}
        onDone={setMessage}
      />}
    </View>
  );
}

function visibilityLabel(value: OutfitVisibility) {
  return visibilityOptions.find((option) => option.value === value)?.label ?? 'Chỉ mình tôi';
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const brand = useBrandColors();
  return <PressableScale
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    scaleTo={0.94}
    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: active ? brand.primary : colors.separator, backgroundColor: active ? brand.secondary : colors.surface }}>
    {/* Độ đậm giữ nguyên khi đổi trạng thái để chip không đổi bề rộng (Android). */}
    <AppText selectable={false} variant="caption" style={{ color: active ? brand.primary : colors.label, fontWeight: '700' }}>{label}</AppText>
  </PressableScale>;
}

function ExtractConfirmSheet({ asset, visible, credits, maxItems, onClose, onClosed, onConfirm }: {
  asset: ImagePicker.ImagePickerAsset | null;
  visible: boolean;
  credits: CreditStatus | undefined;
  maxItems: number;
  onClose: () => void;
  onClosed: () => void;
  onConfirm: (asset: ImagePicker.ImagePickerAsset) => void;
}) {
  const noCredits = Boolean(credits && !credits.unlimited && (credits.remaining ?? 0) <= 0);
  const limit = credits && !credits.unlimited ? Math.min(maxItems, credits.remaining ?? 0) : maxItems;
  return <BottomSheet visible={visible} title="Tách món đồ từ ảnh này?" onClose={onClose} onClosed={onClosed}>
    {asset && <Image source={{ uri: asset.uri }} style={{ width: '100%', height: 260, borderRadius: radius.lg, backgroundColor: colors.surface }} contentFit="contain"/>}
    <View style={{ gap: spacing.xs }}>
      <AppText variant="body">AI sẽ nhận diện từng món trong ảnh (tối đa {Math.max(limit, 0)} món) và tạo ảnh sản phẩm riêng cho mỗi món.</AppText>
      <AppText variant="subhead">Mỗi món tách được dùng 1 lượt tạo ảnh. Lượt không dùng tới sẽ được hoàn lại.</AppText>
      <AppText variant="subhead" style={{ fontWeight: '700', color: colors.label }}>
        {credits === undefined ? 'Đang kiểm tra lượt còn lại…' : credits.unlimited ? 'Gói của bạn không giới hạn lượt.' : 'Bạn còn ' + (credits.remaining ?? 0) + ' lượt.'}
      </AppText>
    </View>
    {noCredits && <AppText variant="subhead" style={{ color: colors.destructive }}>Bạn đã hết lượt tạo ảnh. Hãy nâng gói ở mục Cá nhân để tiếp tục.</AppText>}
    <AppButton title="Tách đồ bằng AI" icon="sparkles" disabled={!asset || noCredits || credits === undefined || limit <= 0} onPress={() => { if (asset) onConfirm(asset); }}/>
    <AppButton title="Huỷ" variant="secondary" onPress={onClose}/>
  </BottomSheet>;
}

function GarmentEditor({ garment, visible, onClose, onClosed, onDone }: { garment: Garment; visible: boolean; onClose: () => void; onClosed: () => void; onDone: (message: string) => void }) {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [name, setName] = useState(garment.name);
  const [category, setCategory] = useState<GarmentCategory>(garment.category);
  const trimmed = name.trim();
  const changed = trimmed !== garment.name || category !== garment.category;
  const save = useMutation({
    mutationFn: () => apiRequest<Garment>('/api/garments/' + encodeURIComponent(garment.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, category }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['garments'] });
      onDone('Đã lưu thay đổi cho món đồ.');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest<void>('/api/garments/' + encodeURIComponent(garment.id), { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['garments'] });
      onDone('Đã xoá món đồ.');
      onClose();
    },
  });
  const busy = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;
  return <BottomSheet visible={visible} title="Sửa món đồ" onClose={onClose} onClosed={onClosed} dismissable={!busy}>
    <Image source={protectedImageSource(garment.frontProcessedUrl || garment.frontOriginalUrl, session?.access_token)} style={{ width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.surface }} contentFit="contain"/>
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption">Tên món đồ</AppText>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder="Ví dụ: Áo sơ mi trắng"
        placeholderTextColor={colors.secondaryLabel}
        returnKeyType="done"
        style={{ minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface, color: colors.label, fontSize: 16 }}
      />
    </View>
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption">Loại đồ</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {categoryValues.map((value) => <Chip key={value} label={categoryNames[value]} active={category === value} onPress={() => setCategory(value)}/>)}
      </View>
    </View>
    {error && <Notice tone="error" text={error instanceof Error ? error.message : 'Không thể cập nhật món đồ.'}/>}
    <AppButton title="Lưu thay đổi" loading={save.isPending} disabled={!changed || !trimmed || busy} onPress={() => save.mutate()}/>
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => Alert.alert('Xoá món đồ?', 'Món đồ sẽ bị xoá khỏi tủ. Các outfit đã tạo trước đó vẫn được giữ.', [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xoá', style: 'destructive', onPress: () => remove.mutate() },
      ])}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 44 }}>
      {remove.isPending ? <ActivityIndicator color={colors.destructive}/> : <AppIcon name="trash" size={18} color={colors.destructive}/>}
      <AppText variant="headline" style={{ color: colors.destructive }}>Xoá món đồ</AppText>
    </Pressable>
    <AppText variant="caption" style={{ textAlign: 'center', color: brand.primary }}>Thay đổi áp dụng cho cả web và app.</AppText>
  </BottomSheet>;
}

function OutfitEditor({ outfit, visible, title: initialTitle, policy, social, onClose, onClosed, onDone }: {
  outfit: SavedOutfit;
  visible: boolean;
  onClosed: () => void;
  title: string;
  policy: OutfitPolicy | undefined;
  social: SocialSnapshot | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { height: windowHeight } = useWindowDimensions();
  const groups = social?.groups ?? [];
  const initialVisibility: OutfitVisibility = policy?.visibility ?? social?.me.defaultVisibility ?? 'private';
  const [title, setTitle] = useState(initialTitle);
  const [visibility, setVisibility] = useState<OutfitVisibility>(initialVisibility);
  const [groupIds, setGroupIds] = useState<string[]>(policy?.groupIds ?? []);
  const policyChanged = Boolean(social) && (visibility !== initialVisibility || groupIds.slice().sort().join(',') !== (policy?.groupIds ?? []).slice().sort().join(','));
  const changed = title.trim() !== initialTitle.trim() || policyChanged;
  const needsGroup = visibility === 'groups' && groupIds.length === 0;

  const save = useMutation({
    mutationFn: async () => {
      if (policyChanged) {
        const snapshot = await apiRequest<SocialSnapshot>('/api/social/outfit-policy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outfitId: outfit.id, visibility, groupIds: visibility === 'groups' ? groupIds : [] }),
        });
        queryClient.setQueryData(['social'], snapshot);
      }
      await writeOutfitTitle(outfit.id, title);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outfit-titles'] });
      onDone('Đã lưu thay đổi cho outfit.');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest<{ deleted: boolean }>('/api/generations/outfits/' + encodeURIComponent(outfit.id), { method: 'DELETE' }),
    onSuccess: async () => {
      await removeOutfitTitle(outfit.id);
      void queryClient.invalidateQueries({ queryKey: ['saved-outfits'] });
      void queryClient.invalidateQueries({ queryKey: ['outfit-titles'] });
      onDone('Đã xoá outfit.');
      onClose();
    },
  });
  const busy = save.isPending || remove.isPending;
  const error = save.error ?? remove.error;

  return <BottomSheet visible={visible} title="Sửa outfit" onClose={onClose} onClosed={onClosed} dismissable={!busy}>
    <OutfitAngles front={outfit.frontImageUrl} back={outfit.backImageUrl} maxHeight={Math.round(windowHeight * 0.45)}/>
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption">Tên outfit (lưu trên máy này)</AppText>
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={60}
        placeholder={outfit.backImageUrl ? 'Outfit hai góc' : 'Outfit góc trước'}
        placeholderTextColor={colors.secondaryLabel}
        returnKeyType="done"
        style={{ minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surface, color: colors.label, fontSize: 16 }}
      />
    </View>
    {social
      ? <View style={{ gap: spacing.xs }}>
          <AppText variant="caption">Ai được xem outfit này</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {visibilityOptions.filter((option) => option.value !== 'groups' || groups.length > 0).map((option) => <Chip key={option.value} label={option.label} active={visibility === option.value} onPress={() => setVisibility(option.value)}/>)}
          </View>
          {visibility === 'groups' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
            {groups.map((group) => <Chip key={group.id} label={group.name} active={groupIds.includes(group.id)} onPress={() => setGroupIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])}/>)}
          </View>}
          {needsGroup && <AppText variant="caption" style={{ color: colors.destructive }}>Chọn ít nhất một nhóm.</AppText>}
        </View>
      : <AppText variant="caption">Chưa tải được quyền xem outfit. Bạn vẫn có thể đổi tên hoặc xoá.</AppText>}
    {error && <Notice tone="error" text={error instanceof Error ? error.message : 'Không thể cập nhật outfit.'}/>}
    <AppButton title="Lưu thay đổi" loading={save.isPending} disabled={!changed || needsGroup || busy} onPress={() => save.mutate()}/>
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => Alert.alert('Xoá outfit?', 'Outfit sẽ bị xoá khỏi danh sách. Ảnh toàn thân đã tải lên không bị ảnh hưởng.', [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xoá', style: 'destructive', onPress: () => remove.mutate() },
      ])}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 44 }}>
      {remove.isPending ? <ActivityIndicator color={colors.destructive}/> : <AppIcon name="trash" size={18} color={colors.destructive}/>}
      <AppText variant="headline" style={{ color: colors.destructive }}>Xoá outfit</AppText>
    </Pressable>
  </BottomSheet>;
}
