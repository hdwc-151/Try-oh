import type { SubscriptionPlan, SubscriptionPlanId } from './types.js'

export const SUBSCRIPTION_PLANS: Readonly<Record<SubscriptionPlanId, SubscriptionPlan>> = {
  free: {
    id: 'free', name: 'Free', description: 'Dùng thử các tính năng cốt lõi của Try-oh.', monthlyPriceVnd: 0, recommended: false,
    entitlements: { imageCredits: 10, wardrobeItems: 20, savedOutfits: 10, selectedGarments: 8, livePreviewSessions: 0, livePreviewSeconds: 10, livePreviewFastMode: false },
    highlights: ['10 ảnh tạo thử trọn đời', 'Tủ đồ 20 món', 'Lưu 10 outfit'],
  },
  plus: {
    id: 'plus', name: 'Plus', description: 'Cho người dùng thử đồ thường xuyên.', monthlyPriceVnd: 89_000, recommended: false,
    entitlements: { imageCredits: 60, wardrobeItems: 100, savedOutfits: 50, selectedGarments: 8, livePreviewSessions: 3, livePreviewSeconds: 10, livePreviewFastMode: false },
    highlights: ['60 ảnh mỗi chu kỳ', 'Tủ đồ 100 món', 'Lưu 50 outfit', '3 lượt thử trực tiếp bằng camera / 30 ngày'],
  },
  pro: {
    id: 'pro', name: 'Pro', description: 'Không gian lớn cho sáng tạo nội dung và phối đồ.', monthlyPriceVnd: 199_000, recommended: true,
    entitlements: { imageCredits: 200, wardrobeItems: 300, savedOutfits: 150, selectedGarments: 8, livePreviewSessions: 10, livePreviewSeconds: 10, livePreviewFastMode: true },
    highlights: ['200 ảnh mỗi chu kỳ', 'Tủ đồ 300 món', 'Lưu 150 outfit', '10 lượt thử trực tiếp bằng camera / 30 ngày, có chế độ Nhanh'],
  },
  max: {
    id: 'max', name: 'Max', description: 'Hạn mức cao cho KOC và người dùng chuyên nghiệp.', monthlyPriceVnd: 449_000, recommended: false,
    entitlements: { imageCredits: 600, wardrobeItems: 1_000, savedOutfits: 500, selectedGarments: 8, livePreviewSessions: 30, livePreviewSeconds: 10, livePreviewFastMode: true },
    highlights: ['600 ảnh mỗi chu kỳ', 'Tủ đồ 1.000 món', 'Lưu 500 outfit', '30 lượt thử trực tiếp bằng camera / 30 ngày, có chế độ Nhanh'],
  },
}

const subscriptionPlanIds = Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlanId[]
export const isSubscriptionPlanId = (value: unknown): value is SubscriptionPlanId =>
  typeof value === 'string' && subscriptionPlanIds.includes(value as SubscriptionPlanId)
export const planCatalog = (): SubscriptionPlan[] => subscriptionPlanIds.map((id) => SUBSCRIPTION_PLANS[id])
