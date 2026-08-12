import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuHistory } from '@/hooks/useCashuHistory';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { readMovements } from '@/lib/cashuStore';
import {
  HISTORY_KIND,
  buildHistoryContent,
  buildHistoryTags,
  type Nip44Signer,
} from '@/lib/nip60';

/**
 * Puts already-cut tokens onto relays, once.
 *
 * Tokens made before this app started backing them up exist only in the
 * browser that made them. That is the whole complaint this solves, and fixing
 * it going forward would leave exactly the tokens somebody already has
 * stranded on one machine.
 *
 * Each backfilled entry is marked so the transaction list ignores it. The
 * balance change was published at the time; this is only carrying the string,
 * and a second "out" for the same sats would read as the money leaving twice.
 */
export function useTokenBackup() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { data: history, isLoading } = useCashuHistory(200);
  const queryClient = useQueryClient();

  /** Once per session, whatever re-renders happen. */
  const done = useRef(false);

  const pubkey = user?.pubkey;
  const readOnly = user?.readOnly;

  useEffect(() => {
    if (done.current || isLoading || !pubkey || readOnly || !user) return;
    if (!history) return;

    done.current = true;

    const backedUp = new Set(
      history.filter((entry) => !!entry.token).map((entry) => entry.token)
    );

    const missing = readMovements(pubkey).filter(
      (movement) =>
        movement.type === 'cashu_send' &&
        !!movement.token &&
        !backedUp.has(movement.token)
    );

    if (!missing.length) return;

    const run = async () => {
      for (const movement of missing) {
        try {
          const content = await buildHistoryContent(
            user.signer as Nip44Signer,
            pubkey,
            {
              direction: 'out',
              amount: movement.amountSats,
              token: movement.token,
              memo: movement.memo,
              mint: movement.mint,
              backupOnly: true,
            }
          );

          await publishEvent({
            kind: HISTORY_KIND,
            content,
            tags: buildHistoryTags({ direction: 'out', amount: 0 }),
          });
        } catch {
          /**
           * One failure does not stop the rest. A signer that refuses, or a
           * relay that rejects, leaves that token where it already was — in
           * this browser — which is no worse than before the attempt.
           */
        }
      }

      queryClient.invalidateQueries({ queryKey: ['cashu-history'] });
    };

    void run();
  }, [history, isLoading, pubkey, readOnly, user, publishEvent, queryClient]);
}
