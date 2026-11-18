import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { KeyboardScrollView } from '@/components/keyboard-scroll-view';
import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { useAuth } from '@/providers/auth-provider';
import { apiRequest, protectedImageSource } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { PageResponse, SavedOutfit, SocialSnapshot } from '@/types/api';

/** Tối đa 1 ngày. Không chọn thì máy chủ dùng mặc định 1 ngày. */
const DURATIONS = [1, 2, 3, 6, 12, 24] as const;
const durationLabel = (hours: number) => hours === 24 ? '1 ngày' : hours + ' giờ';

type Audience = 'public' | 'friends' | 'friends_except' | 'specific';
const AUDIENCES: { value: Audience; label: string; hint: string; icon: 'sparkles' | 'people' | 'minus' | 'check' }[] = [
  { value: 'public', label: 'Công khai', hint: 'Mọi bạn bè và người theo dõi', icon: 'sparkles' },
  { value: 'friends', label: 'Bạn bè', hint: 'Tất cả bạn bè', icon: 'people' },
  { value: 'friends_except', label: 'Bạn bè ngoại trừ…', hint: 'Bỏ bớt vài người', icon: 'minus' },
  { value: 'specific', label: 'Bạn bè cụ thể', hint: 'Chỉ những người bạn chọn', icon: 'check' },
];

const QUICK_QUESTIONS = [
  'Mình nên chọn bộ nào?',
  'Đi tiệc tối nay mặc gì?',
  'Đi làm thứ Hai',
  'Hẹn hò cuối tuần',
  'Đi cà phê chụp ảnh',
  'Đi du lịch Đà Lạt',
];

const MAX_OPTIONS = 3;

/** Tạo bình chọn từ 2–3 outfit đã lưu, gửi cho bạn bè quẹt chọn giúp. */
export default function PollCreateRoute() {
  const brand = useBrandColors();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const outfits = useQuery({
    queryKey: ['saved-outfits', 'poll'],
    queryFn: () => apiRequest<PageResponse<SavedOutfit>>('/api/generations/outfits?limit=100&offset=0'),
  });
  const social = useQuery({
    queryKey: ['social'],
    queryFn: () => apiRequest<SocialSnapshot>('/api/social'),
  });

  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [audience, setAudience] = useState<Audience>('friends');
  // friends_except: những người bị loại; specific: những người được chọn.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<SocialSnapshot>('/api/social/poll-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (snapshot) => {
      haptic.success();
      queryClient.setQueryData(['social'], snapshot);
      router.replace('/polls');
    },
  });

  const error = outfits.error ?? social.error;
  if (error) {
    return (
      <ScreenError
        message={error instanceof Error ? error.message : 'Không thể tải dữ liệu.'}
        onRetry={() => {
          void outfits.refetch();
          void social.refetch();
        }}
      />
    );
  }
  if (!outfits.data || !social.data) return <ScreenLoading variant="grid" label="Đang tải dữ liệu…"/>;

  const friends = social.data.friends;
  const followerCount = social.data.followerCount ?? 0;
  const recipientCount = audience === 'public'
    ? friends.length + followerCount
    : audience === 'friends'
      ? friends.length
      : audience === 'friends_except'
        ? friends.filter((friend) => !excluded.includes(friend.id)).length
        : chosen.length;
  const toggleOutfit = (id: string) => {
    haptic.select();
    setPicked((list) =>
      list.includes(id)
        ? list.filter((item) => item !== id)
        : list.length >= MAX_OPTIONS
        ? list
        : [...list, id]
    );
  };

  const toggleFriend = (id: string) => {
    haptic.select();
    const update = (list: string[]) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    if (audience === 'specific') setChosen(update);
    else setExcluded(update);
  };

  const canSubmit = picked.length >= 2 && recipientCount > 0 && !create.isPending;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Tạo bình chọn',
          headerBackTitle: 'Quay lại',
          headerShadowVisible: false,
        }}
      />
      <KeyboardScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: spacing.md,
          gap: spacing.lg,
          paddingBottom: spacing.xxl * 2,
        }}
      >
        {/* BƯỚC 1: CHỌN OUTFIT */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.xl,
            padding: spacing.md,
            gap: spacing.md,
            borderWidth: 1,
            borderColor: colors.separator,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: brand.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText style={{ color: colors.onBrand, fontSize: 13, fontWeight: '700' }}>1</AppText>
              </View>
              <AppText variant="headline" style={{ fontSize: 16 }}>Chọn outfit so sánh</AppText>
            </View>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: radius.full,
                backgroundColor: picked.length >= 2 ? brand.secondary : colors.groupedBackground,
              }}
            >
              <AppText
                variant="caption"
                style={{
                  fontWeight: '700',
                  color: picked.length >= 2 ? brand.primary : colors.secondaryLabel,
                }}
              >
                {picked.length}/{MAX_OPTIONS} bộ
              </AppText>
            </View>
          </View>

          {outfits.data.items.length < 2 ? (
            <View
              style={{
                paddingVertical: spacing.lg,
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
              }}
            >
              <AppText variant="subhead" style={{ textAlign: 'center', color: colors.secondaryLabel }}>
                Bạn cần ít nhất 2 outfit đã lưu để tạo bình chọn.
              </AppText>
              <Pressable
                onPress={() => router.navigate({ pathname: '/(tabs)/home', params: { segment: 'try-on', t: String(Date.now()) } })}
                style={{
                  marginTop: spacing.xs,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: radius.full,
                  backgroundColor: brand.secondary,
                }}
              >
                <AppText variant="caption" style={{ color: brand.primary, fontWeight: '700' }}>
                  Đến Phòng thử tạo outfit ngay
                </AppText>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {outfits.data.items.map((outfit) => {
                const order = picked.indexOf(outfit.id);
                const isSelected = order >= 0;
                return (
                  <Pressable
                    key={outfit.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => toggleOutfit(outfit.id)}
                    style={{
                      width: '31%',
                      aspectRatio: 4 / 5,
                      borderRadius: radius.lg,
                      overflow: 'hidden',
                      borderWidth: isSelected ? 2.5 : 1,
                      borderColor: isSelected ? brand.primary : colors.separator,
                      backgroundColor: colors.groupedBackground,
                    }}
                  >
                    <Image
                      source={protectedImageSource(outfit.frontImageUrl, session?.access_token, 320)}
                      style={{ flex: 1 }}
                      contentFit="cover"
                      transition={150}
                    />
                    {isSelected && (
                      <Animated.View
                        entering={ZoomIn.duration(160)}
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: brand.primary,
                          borderWidth: 1.5,
                          borderColor: '#ffffff',
                        }}
                      >
                        <AppText style={{ color: colors.onBrand, fontWeight: '800', fontSize: 12 }}>
                          {order + 1}
                        </AppText>
                      </Animated.View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* BƯỚC 2: CÂU HỎI */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.xl,
            padding: spacing.md,
            gap: spacing.md,
            borderWidth: 1,
            borderColor: colors.separator,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: brand.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText style={{ color: colors.onBrand, fontSize: 13, fontWeight: '700' }}>2</AppText>
            </View>
            <AppText variant="headline" style={{ fontSize: 16 }}>Ghi chú</AppText>
          </View>

          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="Ví dụ: Đi tiệc tối nay, mình nên mặc bộ nào?"
            placeholderTextColor={colors.secondaryLabel}
            style={{
              minHeight: 46,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.separator,
              backgroundColor: colors.background,
              color: colors.label,
              fontSize: 15,
            }}
          />

          <View style={{ gap: spacing.xs }}>
            <AppText variant="caption" style={{ color: colors.secondaryLabel, fontSize: 12 }}>
              Gợi ý nhanh:
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {QUICK_QUESTIONS.map((idea) => {
                const isActive = title.trim() === idea;
                return (
                  <Pressable
                    key={idea}
                    onPress={() => {
                      haptic.light();
                      setTitle(idea);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: radius.full,
                      backgroundColor: isActive ? brand.primary : colors.groupedBackground,
                      borderWidth: 1,
                      borderColor: isActive ? brand.primary : 'transparent',
                    }}
                  >
                    <AppText
                      variant="caption"
                      style={{
                        color: isActive ? colors.onBrand : colors.label,
                        fontWeight: isActive ? '700' : '500',
                      }}
                    >
                      {idea}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* BƯỚC 3: THỜI HẠN (tối đa 1 ngày; bỏ trống = 1 ngày) */}
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <StepBadge n={3}/>
            <AppText variant="headline" style={{ fontSize: 16, flex: 1 }}>Thời hạn nhận bình chọn</AppText>
            <AppText variant="caption">{hours ? durationLabel(hours) : 'Mặc định 1 ngày'}</AppText>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {DURATIONS.map((value) => {
              const selected = hours === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityHint={selected ? 'Chạm lần nữa để bỏ chọn, dùng mặc định 1 ngày' : undefined}
                  onPress={() => {
                    haptic.select();
                    setHours(selected ? null : value);
                  }}
                  style={{
                    minWidth: 72,
                    minHeight: 44,
                    paddingHorizontal: spacing.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.full,
                    backgroundColor: selected ? brand.primary : colors.groupedBackground,
                    borderWidth: 1,
                    borderColor: selected ? brand.primary : colors.separator,
                  }}
                >
                  <AppText style={{ fontSize: 14, fontWeight: selected ? '800' : '600', color: selected ? colors.onBrand : colors.label }}>
                    {durationLabel(value)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* BƯỚC 4: AI NHẬN BÌNH CHỌN */}
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <StepBadge n={4}/>
            <AppText variant="headline" style={{ fontSize: 16, flex: 1 }}>Gửi cho ai?</AppText>
          </View>
          <View style={{ gap: spacing.xs }}>
            {AUDIENCES.map((option) => {
              const selected = audience === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    haptic.select();
                    setAudience(option.value);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    minHeight: 52,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.lg,
                    borderWidth: 1.5,
                    borderColor: selected ? brand.primary : colors.separator,
                    backgroundColor: selected ? brand.secondary : colors.surface,
                  }}
                >
                  <AppIcon name={option.icon} size={18} color={selected ? brand.primary : colors.secondaryLabel} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <AppText style={{ fontSize: 15, fontWeight: '700', color: colors.label }}>{option.label}</AppText>
                    <AppText variant="caption">{option.hint}</AppText>
                  </View>
                  <AppIcon name={selected ? 'checkboxOn' : 'checkboxOff'} size={20} color={selected ? brand.primary : colors.secondaryLabel} />
                </Pressable>
              );
            })}
          </View>
          {audience === 'public' && (
            <AppText variant="caption">
              Bình chọn hiện ở mục Bài đăng trên trang cá nhân của bạn với mọi bạn bè{followerCount > 0 ? ` và ${followerCount.toLocaleString('vi-VN')} người theo dõi` : ''}.
            </AppText>
          )}

          {friends.length === 0 && audience !== 'public' ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, gap: spacing.sm }}>
              <AppText variant="subhead" style={{ textAlign: 'center' }}>Bạn chưa có bạn bè trên Try-oh.</AppText>
              <AppButton title="Tìm bạn bè ngay" variant="secondary" onPress={() => router.navigate('/(tabs)/friends')} />
            </View>
          ) : (audience === 'friends_except' || audience === 'specific') && (
            <View style={{ gap: spacing.xs }}>
              <AppText variant="caption" style={{ color: colors.label, fontWeight: '700' }}>
                {audience === 'specific' ? 'Chọn người nhận · ' + chosen.length : 'Chạm để bỏ người không nhận · ' + excluded.length}
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {friends.map((friend) => {
                  const marked = audience === 'specific' ? chosen.includes(friend.id) : excluded.includes(friend.id);
                  const receives = audience === 'specific' ? marked : !marked;
                  return (
                    <Pressable
                      key={friend.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: receives }}
                      accessibilityLabel={friend.name + (receives ? ', nhận bình chọn' : ', không nhận')}
                      onPress={() => toggleFriend(friend.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        minHeight: 36,
                        paddingHorizontal: 12,
                        borderRadius: radius.full,
                        backgroundColor: receives ? brand.primary : colors.groupedBackground,
                        borderWidth: 1,
                        borderColor: receives ? brand.primary : colors.separator,
                      }}
                    >
                      <AppIcon name={receives ? 'check' : 'minus'} size={14} color={receives ? colors.onBrand : colors.secondaryLabel} />
                      <AppText variant="caption" style={{ fontWeight: '700', color: receives ? colors.onBrand : colors.label, textDecorationLine: receives ? 'none' : 'line-through' }}>
                        {friend.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>

        {create.error && (
          <Notice
            tone="error"
            text={create.error instanceof Error ? create.error.message : 'Chưa tạo được bình chọn.'}
            onDismiss={() => create.reset()}
          />
        )}

        {/* NÚT SUBMIT */}
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          <AppButton
            title="Đăng bình chọn"
            icon="people"
            loading={create.isPending}
            disabled={!canSubmit}
            onPress={() =>
              create.mutate({
                outfitIds: picked,
                title: title.trim(),
                audience,
                ...(hours ? { hours } : {}),
                ...(audience === 'friends_except' ? { excludedIds: excluded } : {}),
                ...(audience === 'specific' ? { recipientIds: chosen } : {}),
              })
            }
          />
          {!canSubmit && (
            <AppText
              variant="caption"
              style={{ textAlign: 'center', color: colors.secondaryLabel, fontSize: 12 }}
            >
              {picked.length < 2
                ? 'Vui lòng chọn ít nhất 2 outfit để so sánh'
                : recipientCount === 0
                ? 'Chưa có ai nhận bình chọn này'
                : ''}
            </AppText>
          )}
        </View>
      </KeyboardScrollView>
    </>
  );
}

function StepBadge({ n }: { n: number }) {
  const brand = useBrandColors();
  return <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center' }}>
    <AppText style={{ color: colors.onBrand, fontSize: 13, fontWeight: '700' }}>{n}</AppText>
  </View>;
}
