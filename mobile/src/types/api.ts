export type GarmentCategory = 'tops' | 'outerwear' | 'bottoms' | 'shoes' | 'accessories';

export type PageResponse<T> = {
  items: T[];
  total: number;
  nextOffset: number | null;
};

export type Garment = {
  id: string;
  name: string;
  category: GarmentCategory;
  frontOriginalUrl: string;
  frontProcessedUrl: string;
  backOriginalUrl: string | null;
  backProcessedUrl: string | null;
  createdAt: string;
};

export type PersonImage = {
  id: 'current';
  imageUrl: string;
  width: number;
  height: number;
  warnings: string[];
  createdAt: string;
};

export type TryOnResult = { angle: 'front' | 'back'; imageUrl: string; createdAt: string };
export type CreditStatus = { remaining: number | null; limit: number; unlimited: boolean };
export type SavedOutfit = {
  id: string;
  frontImageUrl: string;
  backImageUrl: string | null;
  garmentIds: string[];
  createdAt: string;
};

/** `creator`: tài khoản KOL/KOC đã được xác minh (hiện dấu tích). */
export type SocialPerson = { id: string; username: string; name: string; avatar: string; creator?: boolean };
export type SocialSnapshot = {
  me: SocialPerson & {
    inviteCode: string;
    birthDate: string | null;
    invitePolicy: 'everyone' | 'known' | 'code';
    defaultVisibility: 'private' | 'friends';
    /** Ai xem được trang cá nhân. Máy chủ chưa chạy migration 014 không gửi trường này. */
    profileVisibility?: 'everyone' | 'friends' | 'private';
  };
  friends: SocialPerson[];
  incoming: { id: string; from: SocialPerson; createdAt: number }[];
  outgoing: { id: string; to: SocialPerson; createdAt: number }[];
  polls: SocialPoll[];
  blocked: SocialPerson[];
  notifications: SocialNotification[];
  groups?: SocialGroup[];
  policies?: OutfitPolicy[];
  creators?: SocialCreator[];
  /** Bài của KOL/KOC tôi theo dõi, và bài của chính tôi nếu tôi là KOL/KOC. */
  creatorFeed?: SocialPost[];
  /** Bài của người dùng thường (bạn bè và chính tôi) mà tôi được xem. */
  posts?: SocialPost[];
  followingIds?: string[];
  /** Số người đang theo dõi tôi (chỉ KOL/KOC mới có). Danh sách tải phân trang ở /api/social/followers. */
  followerCount?: number;
  /** KOL/KOC tôi đang theo dõi. */
  following?: SocialPerson[];
};

export type SocialCreator = { person: SocialPerson; following: boolean; followerCount: number };
export type SocialPost = {
  id: string;
  owner: SocialPerson;
  caption: string;
  imageUrls: string[];
  visibility: 'private' | 'friends' | 'groups' | 'public';
  createdAt: number;
  creator: boolean;
};
export type SocialProfileView = {
  person: SocialPerson;
  outfits: { id: string; frontImageUrl: string; backImageUrl: string | null; official: boolean }[];
  posts?: SocialPost[];
  followerCount?: number;
  followingCount?: number;
  following?: boolean;
  friend?: boolean;
  /** Bình chọn của chủ hồ sơ mà mình được phép thấy. */
  polls?: SocialPoll[];
  /** Chủ hồ sơ giới hạn người xem: chỉ có tên và ảnh đại diện. */
  locked?: boolean;
};

export type SocialNotification = { id: string; kind?: 'request' | 'poll' | 'result'; targetId?: string; text: string; read: boolean; createdAt: number };

export type OutfitVisibility = 'private' | 'friends' | 'groups';
export type SocialGroup = { id: string; name: string; ownerId: string };
export type OutfitPolicy = { outfitId: string; visibility: OutfitVisibility; groupIds: string[] };

export type PlanEntitlements = {
  imageCredits: number;
  wardrobeItems: number;
  savedOutfits: number;
  selectedGarments: number;
  /** Lượt thử trực tiếp bằng camera trong mỗi 30 ngày; 0 = gói không có. */
  livePreviewSessions: number;
  livePreviewSeconds: number;
  /** Gói được chọn chế độ Nhanh (Pro, Max). */
  livePreviewFastMode: boolean;
};

export type Plan = {
  id: 'free' | 'plus' | 'pro' | 'max';
  name: string;
  description: string;
  monthlyPriceVnd: number;
  recommended: boolean;
  entitlements: PlanEntitlements;
  highlights: string[];
};

export type PlanSnapshot = {
  plans: Plan[];
  current: {
    planId: 'free' | 'plus' | 'pro' | 'max';
    planName: string;
    unlimited: boolean;
    entitlements: PlanEntitlements;
  };
};

export type LivePreviewSpeed = 'standard' | 'fast';

export type LivePreviewStatus = {
  enabled: boolean;
  included: boolean;
  unlimited: boolean;
  sessionSeconds: number;
  fastModeIncluded: boolean;
  fastCost: number;
  limit: number;
  used: number;
  remaining: number | null;
  windowDays: number;
  nextResetAt: string | null;
};

export type LivePreviewStartResponse = {
  session: { id: string; model: string; speed: LivePreviewSpeed; seconds: number; tokenWindowEndsAt: string };
  reference: { prompt: string; imageBase64: string | null; mimeType: string | null };
  status: LivePreviewStatus;
};

export type LivePreviewToken = { apiKey: string; expiresAt: string; model: string; seconds: number };

export type GarmentColorItem = { id: string; hex: string | null; name: string | null };

export type SharedOutfit = { id: string; frontImageUrl: string; backImageUrl: string | null; official: boolean };
export type SocialPoll = {
  id: string;
  owner: SocialPerson;
  title: string;
  createdAt: number;
  expiresAt: number;
  closed: boolean;
  outfits: SharedOutfit[];
  recipients: SocialPerson[];
  /** Chỉ có khi người xem là chủ bình chọn, đã bình chọn, hoặc bình chọn đã kết thúc. */
  votes: { user: SocialPerson; outfitId: string }[];
  myVote: string | null;
  winnerId: string | null;
};
