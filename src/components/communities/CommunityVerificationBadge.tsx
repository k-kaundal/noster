import { CheckCircle } from 'lucide-react';
import type { Community } from '@/lib/community';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface CommunityVerificationBadgeProps {
  community: Community;
}

/**
 * Shows verification status of a community
 * Based on: relay health, moderator NIP-05, community age
 */
export function CommunityVerificationBadge({
  community,
}: CommunityVerificationBadgeProps) {
  // Check if community is established (older than 3 months)
  const communityAge = Math.floor((Date.now() / 1000 - community.createdAt) / 86400);
  const isEstablished = communityAge > 90;

  // Has multiple moderators
  const hasMultipleModerators = community.moderators.length > 1;

  // Has configured relays
  const hasRelays = community.relays.length > 0;

  // Calculate verification score
  let verificationLevel: 'unverified' | 'basic' | 'verified' | 'established' = 'unverified';
  const verificationReasons: string[] = [];

  if (isEstablished) {
    verificationLevel = 'established';
    verificationReasons.push(`Established for ${communityAge} days`);
  } else if (hasMultipleModerators && hasRelays) {
    verificationLevel = 'verified';
    verificationReasons.push(`${community.moderators.length} moderators`);
    verificationReasons.push(`${community.relays.length} relays configured`);
  } else if (hasMultipleModerators || hasRelays) {
    verificationLevel = 'basic';
    if (hasMultipleModerators) {
      verificationReasons.push(`${community.moderators.length} moderators`);
    }
    if (hasRelays) {
      verificationReasons.push(`${community.relays.length} relay${community.relays.length !== 1 ? 's' : ''}`);
    }
  }

  if (verificationLevel === 'unverified') {
    return null;
  }

  const badgeConfig = {
    established: {
      color: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
      label: 'Established',
      description: 'This community has been active for over 90 days with multiple moderators',
    },
    verified: {
      color: 'bg-green-500/20 text-green-700 dark:text-green-400',
      label: 'Verified',
      description: 'Community has multiple moderators and configured relays',
    },
    basic: {
      color: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
      label: 'Active',
      description: 'Community is actively maintained',
    },
  };

  const config = badgeConfig[verificationLevel];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={`${config.color} gap-1 cursor-help`}>
          <CheckCircle className="h-3 w-3" />
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1 text-sm">
          <p className="font-medium">{config.description}</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {verificationReasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
