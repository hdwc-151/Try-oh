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

export type SocialPerson = { id: string; username: string; name: string; avatar: string };
export type SocialSnapshot = {
  me: SocialPerson & {
    inviteCode: string;
    birthDate: string | null;
    invitePolicy: 'everyone' | 'known' | 'code';
    defaultVisibility: 'private' | 'friends';
  };
  friends: SocialPerson[];
  incoming: { id: string; from: SocialPerson; createdAt: number }[];
  outgoing: { id: string; to: SocialPerson; createdAt: number }[];
  polls: unknown[];
  blocked: SocialPerson[];
  notifications: SocialNotification[];
  groups?: SocialGroup[];
  policies?: OutfitPolicy[];
};

export type SocialNotification = { id: string; kind?: 'request' | 'poll' | 'result'; targetId?: string; text: string; read: boolean; createdAt: number };

export type OutfitVisibility = 'private' | 'friends' | 'groups';
export type SocialGroup = { id: string; name: string; ownerId: string };
export type OutfitPolicy = { outfitId: string; visibility: OutfitVisibility; groupIds: string[] };

export type Plan = {
  id: 'free' | 'plus' | 'pro' | 'max';
  name: string;
  description: string;
  monthlyPriceVnd: number;
  recommended: boolean;
  entitlements: { imageCredits: number; wardrobeItems: number; savedOutfits: number; selectedGarments: number };
  highlights: string[];
};

export type PlanSnapshot = {
  plans: Plan[];
  current: {
    planId: 'free' | 'plus' | 'pro' | 'max';
    planName: string;
    unlimited: boolean;
    entitlements: { imageCredits: number; wardrobeItems: number; savedOutfits: number; selectedGarments: number };
  };
};
