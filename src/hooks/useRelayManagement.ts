import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  isUnauthorised,
  isUnsupported,
  parseEventList,
  parseIpList,
  parseKindList,
  parsePubkeyList,
  relayRpc,
  supportedMethods,
  type ManagementMethod,
} from '@/lib/nip86';

/**
 * Whether this key can administer this relay, and what it may do.
 *
 * `supportedmethods` is asked once and gates everything else. Without it a
 * moderation panel would be offered to every reader on every relay, and its
 * buttons would fail one at a time with a 401 — which reads as the app being
 * broken rather than as the reader not being an administrator.
 *
 * Not retried. A relay with no management API answers this the same way every
 * time, and most of them have no CORS headers for it either, so retrying only
 * multiplies the console noise.
 */
export function useRelayManagement(relayUrl: string | undefined) {
  const { user } = useCurrentUser();
  const signer = user && !user.readOnly ? user.signer : null;

  const query = useQuery({
    queryKey: ['relay-management', relayUrl ?? '', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      try {
        return await supportedMethods(relayUrl!, signer!, signal);
      } catch (error) {
        /**
         * Both "no such API" and "not you" mean the panel stays hidden, and
         * neither is worth surfacing as a failure — an ordinary reader on an
         * ordinary relay would see an error on every relay they open.
         */
        if (isUnsupported(error) || isUnauthorised(error)) return [];
        throw error;
      }
    },
    enabled: !!relayUrl && !!signer,
    retry: false,
    staleTime: 10 * 60_000,
  });

  const methods = query.data ?? [];

  return {
    /** True only when the relay answered and named at least one method. */
    isAdmin: methods.length > 0,
    methods,
    supports: (method: ManagementMethod) => methods.includes(method),
    isLoading: query.isLoading,
  };
}

/** One of the list-returning methods, fetched only when it is supported. */
function useManagementList<T>(
  relayUrl: string | undefined,
  method: ManagementMethod,
  parse: (value: unknown) => T,
  supported: boolean
) {
  const { user } = useCurrentUser();
  const signer = user && !user.readOnly ? user.signer : null;

  return useQuery({
    queryKey: ['relay-management-list', relayUrl ?? '', method],
    queryFn: async ({ signal }) =>
      parse(await relayRpc<unknown>(relayUrl!, signer!, method, [], signal)),
    enabled: !!relayUrl && !!signer && supported,
    retry: false,
    staleTime: 60_000,
  });
}

export function useBannedPubkeys(relayUrl: string | undefined, supported: boolean) {
  return useManagementList(relayUrl, 'listbannedpubkeys', parsePubkeyList, supported);
}

export function useAllowedPubkeys(relayUrl: string | undefined, supported: boolean) {
  return useManagementList(relayUrl, 'listallowedpubkeys', parsePubkeyList, supported);
}

export function useBannedEvents(relayUrl: string | undefined, supported: boolean) {
  return useManagementList(relayUrl, 'listbannedevents', parseEventList, supported);
}

export function useEventsNeedingModeration(
  relayUrl: string | undefined,
  supported: boolean
) {
  return useManagementList(
    relayUrl,
    'listeventsneedingmoderation',
    parseEventList,
    supported
  );
}

export function useBlockedIps(relayUrl: string | undefined, supported: boolean) {
  return useManagementList(relayUrl, 'listblockedips', parseIpList, supported);
}

export function useAllowedKinds(relayUrl: string | undefined, supported: boolean) {
  return useManagementList(relayUrl, 'listallowedkinds', parseKindList, supported);
}

/**
 * Running a management call.
 *
 * Every list is invalidated afterwards rather than the one that seems related:
 * allowing a pubkey may lift a ban, banning an event may add it to a different
 * list, and a moderation panel showing a stale ban list is a panel someone
 * acts on twice.
 */
export function useRelayCommand(relayUrl: string | undefined) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const signer = user && !user.readOnly ? user.signer : null;

  return useMutation({
    mutationFn: async ({
      method,
      params = [],
    }: {
      method: ManagementMethod;
      params?: unknown[];
    }) => {
      if (!relayUrl || !signer) {
        throw new Error('Log in with your own key to manage a relay.');
      }

      return await relayRpc<unknown>(relayUrl, signer, method, params);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['relay-management-list'] });
      queryClient.invalidateQueries({ queryKey: ['relay-info', relayUrl] });

      toast({ title: describeSuccess(variables.method) });
    },
    onError: (error: Error) => {
      toast({
        title: 'The relay refused that',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

function describeSuccess(method: ManagementMethod): string {
  switch (method) {
    case 'banpubkey':
      return 'Key banned';
    case 'unbanpubkey':
      return 'Ban lifted';
    case 'allowpubkey':
      return 'Key allowed';
    case 'unallowpubkey':
      return 'Key removed from the allow list';
    case 'banevent':
      return 'Event banned';
    case 'allowevent':
      return 'Event allowed';
    case 'blockip':
      return 'Address blocked';
    case 'unblockip':
      return 'Address unblocked';
    case 'allowkind':
      return 'Kind allowed';
    case 'disallowkind':
      return 'Kind disallowed';
    case 'changerelayname':
      return 'Name changed';
    case 'changerelaydescription':
      return 'Description changed';
    case 'changerelayicon':
      return 'Icon changed';
    default:
      return 'Done';
  }
}
