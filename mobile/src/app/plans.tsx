import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { ScreenError, ScreenLoading } from '@/components/screen-state';
import { apiRequest } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';
import type { Plan, PlanSnapshot } from '@/types/api';

type CheckoutProvider = 'payos' | 'momo';

export default function PlansRoute() {
  const brand = useBrandColors();
  const externalBilling = process.env.EXPO_PUBLIC_BILLING_MODE === 'external';
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiRequest<PlanSnapshot>('/api/plans') });
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const awaitingRef = useRef(false);
  // Quay lại app sau khi thanh toán ở trình duyệt/MoMo: tải lại gói và lượt ngay, không đợi hết hạn cache.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !awaitingRef.current) return;
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    });
    return () => subscription.remove();
  }, [queryClient]);
  const checkout = useMutation({
    mutationFn: ({ planId, provider }: { planId: Plan['id']; provider: CheckoutProvider }) => apiRequest<{ orderId: string; checkoutUrl: string }>('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, provider }),
    }),
    onSuccess: async ({ checkoutUrl }) => {
      awaitingRef.current = true;
      setAwaitingPayment(true);
      await Linking.openURL(checkoutUrl);
    },
  });

  if (plans.error) return <ScreenError message={plans.error instanceof Error ? plans.error.message : 'Không thể tải các gói.'} onRetry={() => void plans.refetch()}/>;
  if (plans.data === undefined) return <ScreenLoading variant="cards" label="Đang tải các gói…"/>;

  return <ScrollView
    contentInsetAdjustmentBehavior="automatic"
    refreshControl={<RefreshControl refreshing={plans.isRefetching} onRefresh={() => void plans.refetch()} tintColor={brand.primary}/>}
    contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, backgroundColor: colors.background }}>
    <View style={{ gap: spacing.xs }}>
      <AppText variant="title">Chọn gói phù hợp</AppText>
      <AppText variant="subhead">{externalBilling ? 'Thanh toán qua VietQR hoặc MoMo. Gói được kích hoạt khi hệ thống nhận webhook thành công.' : 'Xem quyền lợi và gói hiện đang sử dụng trên tài khoản của bạn.'}</AppText>
    </View>
    {checkout.error && <Notice tone="error" text={checkout.error instanceof Error ? checkout.error.message : 'Không thể tạo giao dịch.'}/>}
    {awaitingPayment && <Notice tone="info" text="Hoàn tất thanh toán rồi quay lại Fitsy, gói sẽ tự cập nhật sau vài giây. Kéo xuống để tải lại nếu chưa thấy thay đổi."/>}
    {plans.data.plans.map((plan, index) => {
      const current = plans.data.current.planId === plan.id && !plans.data.current.unlimited;
      const busy = checkout.isPending && checkout.variables?.planId === plan.id;
      return <Animated.View key={plan.id} entering={FadeIn.duration(240).delay(index * 50)} style={{ gap: spacing.md, padding: spacing.lg, borderWidth: plan.recommended ? 2 : 1, borderColor: plan.recommended ? colors.success : colors.separator, borderRadius: radius.xl, backgroundColor: plan.recommended ? brand.secondary : colors.surface }}>
        <View style={{ gap: spacing.xs }}>
          <AppText variant="caption" style={{ color: colors.success, fontWeight: '800' }}>{current ? 'ĐANG SỬ DỤNG' : plan.recommended ? 'ĐỀ XUẤT' : 'GÓI ĐĂNG KÝ'}</AppText>
          <AppText variant="title">{plan.name}</AppText>
          <AppText variant="subhead">{plan.description}</AppText>
          <AppText variant="headline">{plan.monthlyPriceVnd === 0 ? 'Miễn phí' : plan.monthlyPriceVnd.toLocaleString('vi-VN') + 'đ / tháng'}</AppText>
        </View>
        <View style={{ gap: spacing.xs }}>
          {plan.highlights.map((highlight) => <View key={highlight} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
            <View style={{ marginTop: 1 }}><AppIcon name="check" size={16} color={colors.success}/></View>
            <AppText variant="subhead" style={{ flex: 1 }}>{highlight}</AppText>
          </View>)}
        </View>
        {externalBilling && plan.id !== 'free' && !current && <>
          <AppButton title="Thanh toán VietQR" loading={busy && checkout.variables?.provider === 'payos'} disabled={checkout.isPending} onPress={() => checkout.mutate({ planId: plan.id, provider: 'payos' })}/>
          <AppButton title="Thanh toán MoMo" variant="secondary" loading={busy && checkout.variables?.provider === 'momo'} disabled={checkout.isPending} onPress={() => checkout.mutate({ planId: plan.id, provider: 'momo' })}/>
        </>}
        {current && <View style={{ padding: spacing.sm, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.successBackground }}><AppText variant="subhead" style={{ color: colors.success, fontWeight: '700' }}>Gói hiện tại</AppText></View>}
      </Animated.View>;
    })}
  </ScrollView>;
}
