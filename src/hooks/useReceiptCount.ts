import { useQuery } from '@tanstack/react-query';

import { useRelayCapabilities } from '@/hooks/useRelayCapabilities';
import { countEvents } from '@/lib/relayCount';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';

/**
 * How many zap receipts the relay says it holds for something.
 *
 * The second opinion. This app can already say how many receipts it counted
 * and how many it refused, and neither answers the question people actually
 * ask — "I paid, and it is not showing." A refusal and a receipt that never
 * arrived look identical from inside the app, and they have entirely different
 * causes: one is a validation bug, the other is a relay that was not asked or
 * did not answer in time.
 *
 * NIP-45 settles it in one frame. The relay is asked only when it has said it
 * implements COUNT, and only from screens showing a single item — never from a
 * feed, where this would mean a socket per row.
 */
export function useReceiptCount(
  target: { eventId?: string; address?: string } | undefined,
  enabled = true
) {
  const { countUrl } = useRelayCapabilities();

  const key = target?.address ?? target?.eventId;

  return useQuery({
    queryKey: ['receipt-count', key, countUrl],
    queryFn: ({ signal }) =>
      countEvents(
        countUrl!,
        [
          target!.address
            ? { kinds: [ZAP_RECEIPT_KIND], '#a': [target!.address] }
            : { kinds: [ZAP_RECEIPT_KIND], '#e': [target!.eventId!] },
        ],
        { signal }
      ),
    enabled: enabled && !!key && !!countUrl,
    retry: false,
    staleTime: 60 * 1000,
  });
}
