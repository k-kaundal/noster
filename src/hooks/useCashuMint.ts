import { useQuery } from '@tanstack/react-query';
import type { GetInfoResponse, SwapMethod } from '@cashu/cashu-ts';
import {
  CASHU_MINT_URL,
  activeInputFeePpk,
  fetchMintInfo,
  inputFeeSats,
  loadWallet,
  type KeysetSummary,
} from '@/lib/cashu';

export interface MintLimits {
  /** Smallest deposit the mint will quote, in sats. */
  minSats?: number;
  /** Largest deposit the mint will quote, in sats. */
  maxSats?: number;
}

export interface MintSummary {
  url: string;
  name: string;
  version: string;
  description?: string;
  longDescription?: string;
  iconUrl?: string;
  /** Message of the day, if the operator has set one. */
  motd?: string;
  contact: Array<{ method: string; info: string }>;
  /** Deposits are open. NUT-04 can be switched off while withdrawals stay on. */
  canDeposit: boolean;
  /** Withdrawals to lightning are open (NUT-05). */
  canWithdraw: boolean;
  deposit: MintLimits;
  /**
   * NUT-02 input fee on the active keyset, in parts per thousand.
   *
   * Charged per proof spent, so it applies to sending, receiving and paying —
   * not to the balance sitting still. Shown because a wallet whose balance
   * drops for invisible reasons reads as broken.
   */
  inputFeePpk: number;
  /** What that fee costs for a typical few-proof payment, in sats. */
  typicalFeeSats: number;
  info: GetInfoResponse;
}

function bolt11Sats(methods: SwapMethod[] | undefined): MintLimits {
  const method = methods?.find(
    (entry) => entry.method === 'bolt11' && entry.unit === 'sat'
  );

  if (!method) return {};

  return {
    minSats: toSats(method.min_amount),
    maxSats: toSats(method.max_amount),
  };
}

function toSats(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  // Amounts arrive as `Amount` objects, plain numbers or decimal strings
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * What the mint says about itself (NUT-06).
 *
 * Worth showing rather than hiding: a mint holds bearer money, so who runs it,
 * what version it is on and how to contact them is the entire basis for
 * deciding to keep sats there. The notice board (`motd`) is where operators
 * announce planned downtime, which is exactly when someone should not deposit.
 */
export function useCashuMint(mintUrl: string = CASHU_MINT_URL) {
  const query = useQuery<MintSummary>({
    queryKey: ['cashu-mint-info', mintUrl],
    queryFn: async () => {
      const info = await fetchMintInfo(mintUrl);
      const nut4 = info.nuts?.['4'];
      const nut5 = info.nuts?.['5'];

      /**
       * Keysets come from the loaded wallet rather than a second request, and
       * a mint that will not load must still describe itself — the fee is
       * worth knowing but not worth hiding the rest of the card over.
       */
      let inputFeePpk = 0;
      try {
        const wallet = await loadWallet(mintUrl);
        const keysets = wallet.keyChain.getKeysets() as KeysetSummary[];
        inputFeePpk = activeInputFeePpk(keysets ?? []);
      } catch {
        // Left at zero, which reads as "no fee shown" rather than a wrong one
      }

      return {
        url: mintUrl,
        name: info.name || mintUrl,
        version: info.version || '',
        description: info.description,
        longDescription: info.description_long,
        iconUrl: info.icon_url,
        motd: info.motd,
        contact: (info.contact ?? []).filter(
          (entry): entry is { method: string; info: string } =>
            !!entry?.method && !!entry?.info
        ),
        canDeposit: !!nut4 && !nut4.disabled,
        canWithdraw: !!nut5 && !nut5.disabled,
        deposit: bolt11Sats(nut4?.methods),
        inputFeePpk,
        // Three proofs is what a typical amount decomposes into
        typicalFeeSats: inputFeeSats(3, inputFeePpk),
        info,
      };
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    mint: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
