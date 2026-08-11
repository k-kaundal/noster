import { useCallback } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useToast } from '@/hooks/useToast';
import {
  readMovements,
  recordMovement,
  settleMovement,
  type CashuMovement,
} from '@/lib/cashuStore';
import type { TokenState } from '@/lib/cashu';

export interface SentToken {
  id: string;
  token: string;
  amountSats: number;
  memo?: string;
  mint: string;
  createdAt: number;
  settledAt?: number;
  /** From the mint, not from local state. */
  state: TokenState;
  isChecking: boolean;
}

/**
 * Tokens this wallet has cut, and what became of them.
 *
 * A Cashu token is a bearer string: once handed over, nothing tells the sender
 * whether it was taken. The sats have already left the balance, so a wallet
 * that forgets the token shows money gone with no way to know if it arrived —
 * and no way to get it back if it did not.
 *
 * Each one is checked against the mint, which is the only authority on whether
 * its proofs are still unspent.
 */
export function useSentTokens() {
  const { user } = useCurrentUser();
  const { checkToken, mintUrl } = useCashuWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pubkey = user?.pubkey;

  const stored = useQuery<CashuMovement[]>({
    queryKey: ['cashu-sent-tokens', pubkey ?? ''],
    queryFn: async () =>
      readMovements(pubkey!)
        .filter((movement) => movement.type === 'cashu_send' && !!movement.token)
        .sort((a, b) => b.createdAt - a.createdAt),
    enabled: !!pubkey,
    staleTime: 0,
  });

  const movements = stored.data ?? [];

  /**
   * One query per token rather than one for all of them.
   *
   * They settle at different times and a redeemed one never changes again, so
   * per-token caching lets the finished ones stop being asked about while a
   * live one is still polled.
   */
  const states = useQueries({
    queries: movements.map((movement) => ({
      queryKey: ['cashu-token-state', movement.id],
      queryFn: async () => {
        const state = await checkToken(movement.token!);

        /**
         * A token found spent is written back as settled, so the history stops
         * calling it pending. Only in that direction: a mint that could not be
         * reached must never turn a redeemed token back into an open one.
         */
        if (state === 'redeemed' && pubkey && movement.status !== 'settled') {
          settleMovement(pubkey, movement.id);
          queryClient.invalidateQueries({ queryKey: ['cashu-sent-tokens'] });
        }

        return state;
      },
      staleTime: 60_000,
      retry: false,
    })),
  });

  const tokens: SentToken[] = movements.map((movement, index) => ({
    id: movement.id,
    token: movement.token!,
    amountSats: movement.amountSats,
    memo: movement.memo,
    mint: movement.mint,
    createdAt: movement.createdAt,
    settledAt: movement.settledAt,
    state: states[index]?.data ?? 'unknown',
    isChecking: states[index]?.isLoading ?? false,
  }));

  /**
   * Takes an unclaimed token back.
   *
   * The proofs are still this wallet's to spend until somebody else swaps
   * them, so redeeming your own token is how you undo a send that never
   * landed. It fails cleanly if the other person got there first — the mint
   * refuses the second swap, which is the whole safety property of ecash.
   */
  const { receive } = useCashuWallet();

  const reclaim = useCallback(
    async (sent: SentToken) => {
      const sats = await receive(sent.token).catch(() => null);

      if (sats === null) {
        toast({
          title: 'Could not take it back',
          description:
            'The mint refused it, which usually means somebody has already redeemed it.',
          variant: 'destructive',
        });
        return;
      }

      if (pubkey) {
        // Kept in the history as what it became rather than deleted
        settleMovement(pubkey, sent.id);
        recordMovement(pubkey, {
          type: 'cashu_receive',
          mint: sent.mint,
          amountSats: sats,
          status: 'settled',
          settledAt: Math.floor(Date.now() / 1000),
        });
      }

      queryClient.invalidateQueries({ queryKey: ['cashu-sent-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['cashu-token-state'] });

      toast({
        title: 'Taken back',
        description: `${sats.toLocaleString()} sats are in your balance again.`,
      });
    },
    [receive, pubkey, queryClient, toast]
  );

  return {
    tokens,
    isLoading: stored.isLoading,
    reclaim,
    mintUrl,
  };
}
