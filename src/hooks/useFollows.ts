import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';

export function useFollows(pubkey: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query the user's follow list (kind 3)
  const followListQuery = useQuery({
    queryKey: ['follows', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [3], // Follow list events
        authors: [pubkey],
        limit: 1,
      }], { signal });
      
      return events[0] as NostrEvent | undefined;
    },
    enabled: !!pubkey,
  });

  // Query current user's follow list to check if they're following this user
  const currentUserFollowsQuery = useQuery({
    queryKey: ['follows', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return undefined;
      
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [3], // Follow list events
        authors: [user.pubkey],
        limit: 1,
      }], { signal });
      
      return events[0] as NostrEvent | undefined;
    },
    enabled: !!user?.pubkey,
  });

  // Extract following list from the follow list event
  const followingList = followListQuery.data?.tags
    .filter(tag => tag[0] === 'p')
    .map(tag => ({
      pubkey: tag[1],
      relay: tag[2] || '',
      petname: tag[3] || '',
    })) || [];

  // Check if current user is following this user
  const currentUserFollowing = currentUserFollowsQuery.data?.tags
    .filter(tag => tag[0] === 'p')
    .map(tag => tag[1]) || [];

  const isFollowing = currentUserFollowing.includes(pubkey);
  const followingCount = followingList.length;

  // Follow/unfollow mutation
  const followMutation = useMutation({
    mutationFn: async ({ targetPubkey, action }: { targetPubkey: string; action: 'follow' | 'unfollow' }) => {
      if (!user) {
        throw new Error('User not logged in');
      }

      // Get current follow list
      const currentFollowList = currentUserFollowsQuery.data;
      const currentFollowing = currentFollowList?.tags
        .filter(tag => tag[0] === 'p') || [];

      let newFollowing;
      if (action === 'follow') {
        // Add to follow list if not already following
        if (!currentFollowing.some(tag => tag[1] === targetPubkey)) {
          newFollowing = [...currentFollowing, ['p', targetPubkey, '', '']];
        } else {
          newFollowing = currentFollowing;
        }
      } else {
        // Remove from follow list
        newFollowing = currentFollowing.filter(tag => tag[1] !== targetPubkey);
      }

      // Create new follow list event
      await createEvent({
        kind: 3,
        content: '',
        tags: newFollowing,
      });
    },
    onSuccess: (_, { action }) => {
      // Invalidate follow queries to refetch
      queryClient.invalidateQueries({ queryKey: ['follows', user?.pubkey] });
      queryClient.invalidateQueries({ queryKey: ['followers', pubkey] });
      
      toast({
        title: action === 'follow' ? 'Followed' : 'Unfollowed',
        description: action === 'follow' ? 'Added to your following list' : 'Removed from your following list',
      });
    },
    onError: (error) => {
      console.error('Follow/unfollow error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update follow status. Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    followList: followListQuery.data,
    followingList,
    followingCount,
    isFollowing,
    isLoading: followListQuery.isLoading,
    follow: (targetPubkey: string) => followMutation.mutateAsync({ targetPubkey, action: 'follow' }),
    unfollow: (targetPubkey: string) => followMutation.mutateAsync({ targetPubkey, action: 'unfollow' }),
    isFollowLoading: followMutation.isPending,
  };
}