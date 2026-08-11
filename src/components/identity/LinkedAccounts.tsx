import { ExternalLink, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useExternalIdentities } from '@/hooks/useExternalIdentities';
import { platformSpec, proofUrl, type IdentityClaim } from '@/lib/nip39';
import { cn } from '@/lib/utils';

/**
 * The accounts a profile claims elsewhere, per NIP-39.
 *
 * Deliberately not a checkmark. This client does not fetch the Gist or the
 * tweet — it cannot, from a browser, for most of these platforms — so every
 * one of these is the profile's own word about itself. A verification mark
 * would say something nobody here checked, on exactly the surface where
 * impersonation is the point. What it offers instead is the proof link, and
 * wording that puts the checking where it belongs.
 */
export function LinkedAccounts({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { data } = useExternalIdentities(pubkey);
  const claims = data?.claims ?? [];

  if (!claims.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {claims.map((claim) => (
        <ClaimChip key={`${claim.platform}:${claim.identity}`} claim={claim} />
      ))}
    </div>
  );
}

function ClaimChip({ claim }: { claim: IdentityClaim }) {
  const spec = platformSpec(claim.platform);
  const url = proofUrl(claim);
  const label = spec?.label ?? claim.platform;

  const chip = (
    <Badge variant="outline" className="gap-1 font-normal">
      <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">
        {label} · {claim.identity}
      </span>
      {url && <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />}
    </Badge>
  );

  if (!url) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{chip}</span>
        </TooltipTrigger>
        <TooltipContent>
          Claimed, with a proof this app doesn't know how to link to.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-opacity hover:opacity-80"
        >
          {chip}
        </a>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        This profile says it owns {label} {claim.identity}. Nobody here checked
        — open the proof to see whether that account names this key back.
      </TooltipContent>
    </Tooltip>
  );
}
