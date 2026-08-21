import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StandingMarks } from '@/components/VerificationBadge';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import LoginDialog from '@/components/auth/LoginDialog';
import { genUserName } from '@/lib/genUserName';
import { addressDomain } from '@/lib/lightningAddress';
import { setupProgress } from '@/lib/setup';
import { tierOf } from '@/lib/tiers';
import { cn } from '@/lib/utils';

/**
 * The top of the left rail: who you are, or why you would want to be.
 *
 * The rail was fifteen identical grey rows before the first thing anybody
 * could act on. Signed out that is close to hostile — a stranger arrives and
 * is offered Market, P2P and Relay access with exactly the weight given to
 * Home, while the only way in is a small button in the far corner of the
 * header. Signed in it is impersonal in a different way: nothing on screen
 * belongs to the person using it.
 *
 * Both states are answered from data the app has already fetched. The signed-in
 * card reads the same cached kind 0 the header avatar does, so this adds no
 * request to any page it appears on — which is every page, and the reason a
 * fancier card that asked LNbits what somebody owns would be the wrong trade.
 */
export function SideNavIdentity({ compact = false }: { compact?: boolean }) {
  const { user } = useCurrentUser();

  return user ? <SignedIn compact={compact} /> : <SignedOut />;
}

function SignedIn({ compact }: { compact: boolean }) {
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  if (!user) return null;

  const name = metadata?.display_name || metadata?.name || genUserName(user.pubkey);
  const address = metadata?.lud16 || metadata?.lud06;

  /*
   * The name tier only. Relay admission is a cross-origin request per person
   * and this renders on every page — see `StandingMarks`, which is why the
   * pair is a pair rather than a single fused mark.
   */
  const tier = address ? tierOf(address) : null;

  const progress = setupProgress(metadata);

  return (
    <div className="space-y-2">
      <Link
        to="/profile"
        className="press flex items-center gap-2.5 rounded-xl border bg-card/60 p-2 transition-colors hover:border-primary/40 hover:bg-muted/50"
      >
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={metadata?.picture} alt="" className="object-cover" />
          <AvatarFallback className="text-[11px]">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold leading-tight">
            <span className="truncate">{name}</span>
            <StandingMarks
              standing={{ tier }}
              domain={address ? addressDomain(address) : undefined}
              className="[&_svg]:h-3.5 [&_svg]:w-3.5"
            />
          </p>
          {/* The address, because it is the one thing about an account here
              that other clients act on — and the thing people forget they have */}
          <p className="truncate text-[11px] text-muted-foreground">
            {address || 'No zap address yet'}
          </p>
        </div>
      </Link>

      {!progress.complete && !compact && <SetupCard progress={progress} />}
    </div>
  );
}

/**
 * One next step, not a checklist.
 *
 * A four-item to-do list in a nav rail is a second nav rail. This shows the
 * count so somebody can see an end to it, and exactly one thing to press —
 * the rest arrive one at a time as each is finished, which is also the only
 * version that fits above fifteen rows without pushing them off the screen.
 *
 * It removes itself when the last step is done. A permanent "you're all set"
 * card is a row of the rail spent saying nothing.
 */
function SetupCard({
  progress,
}: {
  progress: ReturnType<typeof setupProgress>;
}) {
  const { next, done, total } = progress;
  if (!next) return null;

  return (
    <Link
      to={next.href}
      className="press group block rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Finish setting up
        </p>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>

      {/* Segments rather than a bar: four steps, four marks, and the one
          you just finished is visible rather than a percentage that moved */}
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {progress.steps.map((step) => (
          <span
            key={step.id}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              step.done ? 'bg-primary' : 'bg-primary/20'
            )}
          />
        ))}
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
        <span className="truncate">{next.label}</span>
        <ArrowRight className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </p>
    </Link>
  );
}

/** What the three tiers of this app are worth, in three lines. */
const PITCH = [
  'A lightning address on day one',
  'Your own name, with a ✓',
  'No email, no password',
];

/**
 * The way in, where somebody is already looking.
 *
 * Sign-up lived only in the header, which on a wide screen is diagonally
 * opposite the content somebody is reading. The rail is the one column that is
 * on every page and mostly empty when signed out.
 */
const SignupDialog = lazy(() => import('@/components/auth/SignupDialog'));

function SignedOut() {
  const [signup, setSignup] = useState(false);
  const [login, setLogin] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3.5">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          Join NostrFeed
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nostr, with money built in.
        </p>
      </div>

      <ul className="space-y-1.5">
        {PITCH.map((line) => (
          <li
            key={line}
            className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
          >
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5">
        <Button size="sm" className="w-full" onClick={() => setSignup(true)}>
          Create account
        </Button>
        {/*
          Quieter, and second. Somebody who already has a key knows to look for
          this; somebody who does not is the one this card is for, and two
          buttons of equal weight would make them choose before they know the
          difference.
        */}
        <button
          type="button"
          onClick={() => setLogin(true)}
          className="w-full rounded-lg py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          I already have a key
        </button>
      </div>

      {/* Loaded only when asked for: the signup flow carries key generation
          and an uploader, which no signed-out reader should pay for on arrival */}
      {signup && (
        <Suspense fallback={null}>
          <SignupDialog isOpen onClose={() => setSignup(false)} />
        </Suspense>
      )}

      <LoginDialog
        isOpen={login}
        onClose={() => setLogin(false)}
        onLogin={() => setLogin(false)}
      />
    </div>
  );
}
