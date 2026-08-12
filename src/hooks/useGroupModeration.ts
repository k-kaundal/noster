import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { signToGroupRelay } from '@/hooks/useGroups';
import {
  CREATE_INVITE,
  DELETE_EVENT,
  DELETE_GROUP,
  EDIT_METADATA,
  PUT_USER,
  REMOVE_USER,
  UPDATE_PIN_LIST,
  createInviteTags,
  deleteEventTags,
  editMetadataTags,
  groupLifecycleTags,
  putUserTags,
  removeUserTags,
  reorderChildrenTags,
  rolesOf,
  updatePinsTags,
  type GroupAdmin,
  type GroupMetadata,
  type GroupMetadataEdit,
} from '@/lib/nip29';

/**
 * Admin actions on a group.
 *
 * Every one of these is a request, not a command. The relay decides whether
 * the sender may do it — the spec is explicit that roles are relay policy and
 * that what each role can do "is not defined in this NIP" — so nothing here
 * checks a role name before sending. A client that guessed the policy would
 * refuse actions the relay would have allowed, and offer ones it rejects.
 *
 * What the role list is good for is deciding whether to show the controls at
 * all, which is a different question with a much cheaper wrong answer.
 */
export function useGroupModeration(
  relayUrl: string | undefined,
  group: GroupMetadata | undefined,
  admins: GroupAdmin[] = []
) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /** Any role at all is an admin "in a broad sense", as the spec puts it. */
  const roles = user ? rolesOf(admins, user.pubkey) : [];
  const canModerate = roles.length > 0;

  const send = async (
    kind: number,
    tags: string[][],
    content = ''
  ): Promise<NostrEvent> => {
    if (!user) throw new Error('Log in first');
    if (!relayUrl) throw new Error('No relay for this group');

    return await signToGroupRelay(user, relayUrl, { kind, content, tags });
  };

  const invalidate = () => {
    for (const key of [
      'nip29-groups',
      'nip29-group',
      'nip29-messages',
      'nip29-membership',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const fail = (title: string) => (error: Error) => {
    /**
     * A relay's rejection reason is the only explanation the user gets. The
     * spec has relays say why, and swallowing it in favour of a generic
     * message would leave an admin guessing whether they lack the role, the
     * event was malformed, or the relay is simply down.
     */
    toast({ title, description: error.message, variant: 'destructive' });
  };

  const require = (): GroupMetadata => {
    if (!group) throw new Error('Group not loaded yet');
    return group;
  };

  const putUser = useMutation({
    mutationFn: async (input: {
      pubkey: string;
      roles?: string[];
      reason?: string;
    }) =>
      send(
        PUT_USER,
        putUserTags(require().id, input.pubkey, input.roles ?? []),
        input.reason ?? ''
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Member added' });
    },
    onError: fail('Could not add them'),
  });

  const removeUser = useMutation({
    mutationFn: async (input: { pubkey: string; reason?: string }) =>
      send(
        REMOVE_USER,
        removeUserTags(require().id, input.pubkey),
        input.reason ?? ''
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Member removed' });
    },
    onError: fail('Could not remove them'),
  });

  const editMetadata = useMutation({
    mutationFn: async (changes: GroupMetadataEdit) =>
      send(EDIT_METADATA, editMetadataTags(require(), changes)),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Group updated' });
    },
    onError: fail('Could not update the group'),
  });

  const reorderChildren = useMutation({
    mutationFn: async (children: string[]) =>
      send(EDIT_METADATA, reorderChildrenTags(require(), children)),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Subgroups reordered' });
    },
    onError: fail('Could not reorder them'),
  });

  const deleteEvent = useMutation({
    mutationFn: async (input: { eventId: string; reason?: string }) =>
      send(
        DELETE_EVENT,
        deleteEventTags(require().id, input.eventId),
        input.reason ?? ''
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nip29-messages'] });
      toast({ title: 'Message deleted' });
    },
    onError: fail('Could not delete it'),
  });

  /**
   * Sets the pinned list wholesale.
   *
   * Pin, unpin, reorder and clear are all the same event with a different
   * list, so callers pass the list they want rather than a delta — which also
   * makes an empty list a legitimate "nothing is pinned" rather than
   * something to guard against.
   */
  const setPins = useMutation({
    mutationFn: async (pins: string[]) =>
      send(UPDATE_PIN_LIST, updatePinsTags(require().id, pins)),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Pinned messages updated' });
    },
    onError: fail('Could not update the pins'),
  });

  const createInvite = useMutation({
    mutationFn: async (code?: string | undefined) => {
      /**
       * A code the relay has never seen, generated here when the admin does
       * not supply one. Long enough that guessing it is not a way into a
       * closed group.
       */
      const value = code?.trim() || crypto.randomUUID().replace(/-/g, '');
      await send(CREATE_INVITE, createInviteTags(require().id, value));
      return value;
    },
    onSuccess: () => {
      toast({ title: 'Invite created' });
    },
    onError: fail('Could not create an invite'),
  });

  const deleteGroup = useMutation({
    mutationFn: async (reason?: string) =>
      send(DELETE_GROUP, groupLifecycleTags(require().id), reason ?? ''),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Group deleted' });
    },
    onError: fail('Could not delete the group'),
  });

  return {
    canModerate,
    roles,
    putUser: putUser.mutateAsync,
    removeUser: removeUser.mutateAsync,
    editMetadata: editMetadata.mutateAsync,
    reorderChildren: reorderChildren.mutateAsync,
    deleteEvent: deleteEvent.mutateAsync,
    setPins: setPins.mutateAsync,
    createInvite: createInvite.mutateAsync,
    deleteGroup: deleteGroup.mutateAsync,
    isWorking:
      putUser.isPending ||
      removeUser.isPending ||
      editMetadata.isPending ||
      reorderChildren.isPending ||
      deleteEvent.isPending ||
      setPins.isPending ||
      createInvite.isPending ||
      deleteGroup.isPending,
  };
}
