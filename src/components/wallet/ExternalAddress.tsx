import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import { useIdentity } from '@/hooks/useIdentity';
import { useAddressCheck } from '@/hooks/useAddressCheck';
import { parseLightningAddress } from '@/lib/lightningAddress';

/**
 * Being paid at an address held somewhere else.
 *
 * Plenty of people arrive with a lightning address already — bought with a
 * domain, included with a wallet, part of a service they pay for — and have no
 * intention of moving off it. The app assumed otherwise: the only address it
 * would put on a profile was one it had issued, and the profile field where
 * you could type your own was an unchecked text box in a settings form.
 *
 * Unchecked is the problem. A lightning address is a string until someone
 * tries to pay it, so a typo fails silently and permanently — the zap button
 * keeps looking like it works, payers blame their own wallet, and the person
 * being paid finds out weeks later. So it is fetched and confirmed before it
 * can be published.
 */
export function ExternalAddress() {
  const { status, lightning } = useIdentity();

  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * Checked as they stop typing, not on every keystroke: each check is a
   * request to somebody else's server, and half a domain name is never going
   * to resolve.
   */
  const debounced = useDebounce(input, 600);
  // Only once typing has settled: mid-word, the address is always wrong and
  // checking it would report a failure the person is in the middle of fixing
  const check = useAddressCheck(debounced, debounced === input);

  const parsed = parseLightningAddress(input);
  const ready = check.status === 'ok' && !!parsed.address;

  const use = async () => {
    if (!parsed.address) return;

    setSaving(true);
    try {
      await lightning.setProfileAddress(parsed.address.address);
      setInput('');
    } catch {
      // Already reported by the mutation
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          An address from somewhere else
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Already have one from another wallet or provider? Point your zaps at
          it instead. Nothing here has to be used.
        </p>
      </div>

      {/* Where money is currently going, when it is not going to us */}
      {status.external && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <Zap className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{status.external}</p>
            <p className="text-xs text-muted-foreground">
              Your profile sends zaps here.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            Elsewhere
          </Badge>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && ready) void use();
          }}
          placeholder="you@getalby.com"
          aria-label="Lightning address from another provider"
          autoComplete="off"
        />
        <Button onClick={() => void use()} disabled={!ready || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Use it
        </Button>
      </div>

      {check.status === 'checking' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking that address answers…
        </p>
      )}

      {(check.status === 'invalid' || check.status === 'unreachable') && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{check.reason}</span>
        </p>
      )}

      {check.status === 'ok' && (
        <div className="space-y-1.5 rounded-lg border border-success/40 bg-success/5 p-3">
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="h-3 w-3 shrink-0" />
            That address answers and can be paid.
          </p>

          {/*
            The part people are caught out by. A provider can serve LNURL-pay
            perfectly and be unable to produce NIP-57 receipts, in which case
            ordinary payments arrive and zaps fail — and the failure looks
            like a bug in whichever client tried.
          */}
          {check.zaps ? (
            <p className="text-xs text-muted-foreground">
              It supports Nostr zaps, so zaps from any client will work.
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-warning-strong">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                It takes payments but does not support Nostr zaps, so zaps from
                other clients will fail. Ask your provider for zap support, or
                use an address from here instead.
              </span>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Accepts {check.minSats.toLocaleString()}–
            {check.maxSats.toLocaleString()} sats.
          </p>
        </div>
      )}

      {status.external && (
        <a
          href={`https://${status.external.split('@')[1]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Managed at {status.external.split('@')[1]}
        </a>
      )}
    </div>
  );
}
