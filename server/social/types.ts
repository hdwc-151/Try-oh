export type SocialPerson = { id: string; username: string; name: string; avatar: string; creator?: boolean }
export type SocialProfile = SocialPerson & {
  birthDate: string | null
  inviteCode: string
  invitePolicy: 'everyone' | 'known' | 'code'
  defaultVisibility: 'private' | 'friends'
}
export type FriendRequest = { id: string; from: SocialPerson; to: SocialPerson; createdAt: number }
export type FriendGroup = { id: string; ownerId: string; name: string; members: SocialPerson[] }
export type SharedOutfit = { id: string; frontImageUrl: string; backImageUrl: string | null; official: boolean }
export type SocialVisibility = 'private' | 'friends' | 'groups' | 'public'
export type SocialPost = {
  id: string
  owner: SocialPerson
  caption: string
  imageUrls: string[]
  visibility: SocialVisibility
  groupIds: string[]
  createdAt: number
  creator: boolean
}
export type SocialCreator = {
  person: SocialPerson
  following: boolean
  followerCount: number
}
export type OutfitPolicy = { outfitId: string; visibility: 'private' | 'friends' | 'groups'; groupIds: string[]; official: boolean }
export type SocialPoll = {
  id: string; owner: SocialPerson; title: string; createdAt: number; expiresAt: number; closed: boolean;
  outfits: SharedOutfit[]; recipients: SocialPerson[]; votes: { user: SocialPerson; outfitId: string }[];
  myVote: string | null; winnerId: string | null;
}
export type SocialNotification = { id: string; kind: 'request' | 'poll' | 'result'; text: string; targetId: string; read: boolean; createdAt: number }
export type SocialSnapshot = {
  me: SocialProfile; friends: SocialPerson[]; incoming: FriendRequest[]; outgoing: FriendRequest[];
  groups: FriendGroup[]; polls: SocialPoll[]; blocked: SocialPerson[]; notifications: SocialNotification[];
  policies: OutfitPolicy[];
  posts: SocialPost[]; creatorFeed: SocialPost[]; creators: SocialCreator[]; followingIds: string[];
}
