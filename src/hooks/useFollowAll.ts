import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useToast } from '@/hooks/useToast';
import { mergeFollowAll } from '@/lib/starterPacks';
import type { PeopleList } from '@/lib/starterPacks';

/**
 * Follows every person in a starter pack.
 *
 * The follow list is a single replaceable kind 3 event, so "follow all" is
 * one write: read the current list, append the pubkeys not already on it,
 * publish. Done as a mutation rather than inline in the component because the
 * same flow is needed from the pack card and the pack detail page.
 */
export function useFollowAll() {
  const { user } = useCurrentUser();
  const { followingList, followMany } = useFollows(user?.pubkey ?? '');
  const { toast } = useToast();
  const [completedPacks, setCompletedPacks] = useState<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: async (pack: PeopleList) => {
      if (!user) throw new Error('Log in to follow people');

      const currentFollows = followingList.map((f) => f.pubkey);
      const { added } = mergeFollowAll(pack, currentFollows, '');

      if (added === 0) {
        return { added: 0, packTitle: pack.title };
      }

      const newFollows = pack.people.filter(
        (pubkey) => !currentFollows.includes(pubkey)
      );

      await followMany(newFollows);

      return { added, packTitle: pack.title };
    },
    onSuccess: ({ added, packTitle }, pack) => {
      setCompletedPacks((prev) => new Set(prev).add(pack.address));

      if (added > 0) {
        toast({
          title: 'Following',
          description: `You are now following ${added} new ${added === 1 ? 'person' : 'people'} from "${packTitle}".`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not follow',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    followAll: mutation.mutateAsync,
    isFollowing: mutation.isPending,
    isDone: (address: string) => completedPacks.has(address),
  };
}
