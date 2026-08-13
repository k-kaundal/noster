import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { usePayAnyWallet } from '@/hooks/usePayAnyWallet';
import { useZapPrefs } from '@/hooks/useZapPrefs';
import { cn } from '@/lib/utils';
import {
  DEFAULT_ZAP_SATS,
  MAX_ONE_TAP_SATS,
  MESSAGE_PRESETS,
  MIN_ZAP_SATS,
} from '@/lib/zapPrefs';

/** The amounts worth one tap. Bigger ones belong in the dialog. */
const AMOUNT_PRESETS = [21, 50, 100, 210, 500, 1000];

/**
 * Deciding once what a zap is, so it does not have to be decided every time.
 *
 * The dialog is not going anywhere — it is the right flow when the amount is
 * the point. This screen is for the other case, which is most of them: the
 * same small amount, sent because a post was good. Set it here and ⚡ pays it
 * directly.
 */
export function ZapSettings() {
  const { prefs, update } = useZapPrefs();
  const { wallets, balanceSats, hasNostrFeedWallet } = usePayAnyWallet();

  const hasWallet = wallets.length > 0;
  const tooLow = hasNostrFeedWallet && balanceSats < prefs.amount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Zapping
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="one-tap" className="text-sm font-medium">
              Send instantly
            </Label>
            <p className="text-xs text-muted-foreground">
              ⚡ pays the amount below on a single tap, instead of opening the
              dialog. Hold the button — or right-click it — to open the dialog
              and choose. Turn this off to be asked every time.
            </p>
          </div>

          <Switch
            id="one-tap"
            checked={prefs.oneTap}
            onCheckedChange={(oneTap) => update({ oneTap })}
          />
        </div>

        {/*
          Shown rather than hidden behind the toggle. Somebody turning this on
          with no wallet connected would otherwise flip a switch, see nothing
          change, and have no idea why — the answer belongs where the question
          is asked.
        */}
        {prefs.oneTap && !hasWallet && (
          <WalletNotice>
            Nothing is connected to send from, so ⚡ still opens the dialog —
            where you can pay the invoice from any wallet.
          </WalletNotice>
        )}

        {prefs.oneTap && hasWallet && tooLow && (
          <WalletNotice>
            Your balance is under {prefs.amount.toLocaleString()} sats, so ⚡
            opens the dialog until you top up.
          </WalletNotice>
        )}

        <AmountField
          amount={prefs.amount}
          onChange={(amount) => update({ amount })}
        />

        <MessageField
          message={prefs.message}
          onChange={(message) => update({ message })}
        />
      </CardContent>
    </Card>
  );
}

function WalletNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-3">
      <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{children}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/wallet">Open my wallet</Link>
        </Button>
      </div>
    </div>
  );
}

function AmountField({
  amount,
  onChange,
}: {
  amount: number;
  onChange: (amount: number) => void;
}) {
  /*
   * Kept as text while being typed. Parsing every keystroke into the stored
   * number turns a half-typed "1" on the way to "100" into a saved setting of
   * one sat, and clearing the field to start again into the default.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(amount);

  const commit = (raw: string) => {
    const parsed = Math.floor(Number(raw));
    const usable = Number.isFinite(parsed) && parsed >= MIN_ZAP_SATS;

    onChange(usable ? Math.min(parsed, MAX_ONE_TAP_SATS) : DEFAULT_ZAP_SATS);
    setDraft(null);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="zap-amount">Default amount</Label>

      <div className="flex flex-wrap gap-2">
        {AMOUNT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setDraft(null);
              onChange(preset);
            }}
            className={cn(
              'press rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors',
              amount === preset
                ? 'border-zap bg-zap/10 text-zap'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {preset.toLocaleString()}
          </button>
        ))}
      </div>

      <div className="relative">
        <Input
          id="zap-amount"
          type="number"
          inputMode="numeric"
          min={MIN_ZAP_SATS}
          max={MAX_ONE_TAP_SATS}
          value={shown}
          onChange={(field) => setDraft(field.target.value)}
          onBlur={(field) => commit(field.target.value)}
          onKeyDown={(key) => {
            if (key.key === 'Enter') key.currentTarget.blur();
          }}
          className="pr-12 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          sats
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Sent by ⚡, and the amount the dialog opens on. Anything over{' '}
        {MAX_ONE_TAP_SATS.toLocaleString()} sats is confirmed first — a mis-tap
        on a phone should not cost that much.
      </p>
    </div>
  );
}

function MessageField({
  message,
  onChange,
}: {
  message: string;
  onChange: (message: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="zap-message">Default message</Label>

      {/*
        Presets first, because most people will pick one rather than write
        one. They are short and specific on purpose: "thanks" attached to
        everything says nothing, while "this helped" is a fact about the post.
      */}
      <div className="flex flex-wrap gap-2">
        {MESSAGE_PRESETS.map((preset) => {
          const active = message === preset;

          return (
            <button
              key={preset || 'none'}
              type="button"
              onClick={() => onChange(preset)}
              className={cn(
                'press flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-zap bg-zap/10 text-zap'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {active && <Check className="h-3 w-3" />}
              {preset || 'No message'}
            </button>
          );
        })}
      </div>

      <Textarea
        id="zap-message"
        value={message}
        onChange={(field) => onChange(field.target.value.slice(0, 200))}
        placeholder="Or write your own"
        rows={2}
        className="resize-none"
      />

      <p className="text-xs text-muted-foreground">
        Goes out with every zap, and is public — it appears on the receipt
        anyone can read. The dialog lets you change it for a single zap.
      </p>
    </div>
  );
}
