import { Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/hooks/useIdentity';

interface ProfileZapAddressProps {
  /** What the profile currently advertises, which is where money goes. */
  published?: string;
}

/**
 * The address you are actually paid at, on your own profile.
 *
 * A profile advertises `lud16` and nothing else, so that one string is where
 * every other client sends money — including when it names an address you
 * stopped using. Somebody who took the assigned address, bought a name later,
 * and never pressed publish is looking at a profile quietly offering strangers
 * the old one, with nothing on the page to say so. The wallet knows; the page
 * they were reading did not.
 *
 * Rendered only for the person it belongs to, and only when the two disagree.
 * The row above already prints the published address, and that remains the
 * honest answer for every other reader — and for this one too, whenever it is
 * current. Naming the held address up there instead would be a page claiming
 * zaps arrive somewhere they do not.
 */
export function ProfileZapAddress({ published }: ProfileZapAddressProps) {
  const { status, address, publish, isPublishing, isLoading } = useIdentity();

  /*
   * `unpublished` is the whole test, and it is deliberately narrow. It is
   * false when the profile is already current, and false when the profile
   * points at a wallet from somewhere else — an address somebody chose is not
   * a mistake for us to offer to overwrite.
   */
  if (isLoading || !address || !status.unpublished.includes('lud16')) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-3">
      <p className="text-sm text-warning-strong">
        {published ? (
          <>
            Your profile sends zaps to{' '}
            <span className="break-all font-mono">{published}</span>.
          </>
        ) : (
          <>Your profile advertises no zap address yet.</>
        )}
      </p>

      {/* The thing they came here to see, printed rather than described */}
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <Zap className="h-3.5 w-3.5 shrink-0 text-zap" />
        <span className="truncate font-mono">{address}</span>
      </p>

      <p className="text-xs text-muted-foreground">
        {published
          ? 'This is the address you hold here. Publish it and zaps from every other client arrive there instead.'
          : 'This is the address you hold here. Publish it so anyone on Nostr can pay you.'}
      </p>

      <Button
        size="sm"
        onClick={() => void publish().catch(() => {})}
        disabled={isPublishing}
      >
        {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Publish it
      </Button>
    </div>
  );
}
