import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/services/api-client';
import type { SocialSnapshot } from '@/types/api';

export type FollowAction = 'follow' | 'unfollow' | 'remove-follower';

/** Theo dõi / bỏ theo dõi KOL/KOC, hoặc (KOL/KOC) gỡ một người khỏi danh sách theo dõi mình. */
export function useFollowAction() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ action, targetId }: { action: FollowAction; targetId: string }) => apiRequest<SocialSnapshot>('/api/social/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId }),
    }),
    onSuccess: (snapshot, { targetId }) => {
      queryClient.setQueryData(['social'], snapshot);
      void queryClient.invalidateQueries({ queryKey: ['social-profile', targetId] });
      void queryClient.invalidateQueries({ queryKey: ['social-followers'] });
    },
  });
  const pendingId = mutation.isPending ? mutation.variables?.targetId : undefined;
  return { ...mutation, pendingId };
}
