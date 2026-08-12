import { useState } from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AvatarRing } from '@/components/AvatarRing';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { tierOf, describeTier, type NameTier } from '@/lib/tiers';
import {
  RING_FIELD,
  RING_STYLES,
  canWear,
  readRingChoice,
  type RingId,
  type RingStyle,
} from '@/lib/avatarRing';
import { cn } from '@/lib/utils';

/**
 * Choosing the ring around your own avatar.
 *
 * Locked styles are shown rather than hidden. Somebody on the free tier who
 * cannot see what the paid ones look like has no reason to want one, and a
 * picker that grows mysteriously after a purchase is worse than one that was
 * honest about what was behind the door.
 */
export function AvatarRingPicker() {
  const { user, metadata } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const [saving, setSaving] = useState<RingId | null>(null);

  const record = metadata as Record<string, unknown> | undefined;
  const current = readRingChoice(record);

  const lud16 = typeof record?.lud16 === 'string' ? record.lud16 : undefined;
  const tier: NameTier | null = lud16 ? tierOf(lud16) : null;

  if (!user) return null;

  const displayName =
    (typeof record?.display_name === 'string' && record.display_name) ||
    (typeof record?.name === 'string' && record.name) ||
    genUserName(user.pubkey);

  const picture = typeof record?.picture === 'string' ? record.picture : undefined;

  const choose = async (style: RingStyle) => {
    if (style.id === current) return;

    setSaving(style.id);

    try {
      /**
       * Everything already in the profile, plus this one field. Publishing
       * only the ring would replace the whole kind 0 with a profile
       * containing nothing else — name, picture and lightning address gone.
       */
      const next: Record<string, unknown> = { ...(record ?? {}) };

      if (style.id === 'none') delete next[RING_FIELD];
      else next[RING_FIELD] = style.id;

      await publishEvent({ kind: 0, content: JSON.stringify(next) });

      toast({
        title: style.id === 'none' ? 'Ring removed' : `${style.label} it is`,
      });
    } catch (error) {
      toast({
        title: 'Could not save that',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-sm">Avatar ring</Label>
        <span className="text-xs text-muted-foreground">
          {tier ? describeTier(tier).label : 'No address yet'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
        {RING_STYLES.map((style) => {
          const allowed = canWear(style, tier);
          const active = style.id === current;

          return (
            <button
              key={style.id}
              type="button"
              disabled={!allowed || saving !== null}
              onClick={() => choose(style)}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors',
                active && 'border-primary bg-primary/5',
                allowed
                  ? 'hover:bg-accent/60'
                  : 'cursor-not-allowed opacity-55'
              )}
            >
              <span className="relative">
                {/*
                  A live preview of the real thing, not a swatch. The ring is
                  motion — a still square cannot show whether somebody wants
                  it.
                */}
                <AvatarRing preview={style.id === 'none' ? null : style}>
                  <Avatar className="h-11 w-11">
                    <AvatarImage src={picture} alt="" />
                    <AvatarFallback className="text-xs">
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </AvatarRing>

                {saving === style.id && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                )}
              </span>

              <span className="flex items-center gap-1 text-xs font-medium">
                {!allowed && <Lock className="h-3 w-3" />}
                {active && <Check className="h-3 w-3 text-primary" />}
                {style.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {RING_STYLES.find((style) => style.id === current)?.blurb}
      </p>

      {/*
        Only when something is actually locked. A pitch shown to somebody who
        already holds the top tier is an advert for what they bought.
      */}
      {RING_STYLES.some((style) => !canWear(style, tier)) && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <p>
            The locked ones come with a name of your own.{' '}
            <Button asChild variant="link" className="h-auto p-0 text-xs">
              <Link to="/premium">See what that costs</Link>
            </Button>
          </p>
        </div>
      )}
    </div>
  );
}
