import { useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCode } from '@/components/wallet/QrCode';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';

/**
 * The wallet's identifiers and API keys.
 *
 * LNbits shows these because they are what other software connects with — a
 * point-of-sale, a script, another client. Nothing here is needed to use this
 * app, so the whole card stays shut until asked for, and each secret stays
 * hidden until asked for again.
 */
export function WalletKeys() {
  const { account, instanceUrl } = useLnbitsAuth();
  const { wallet } = useLnbitsWallet();
  const [open, setOpen] = useState(false);

  if (!wallet || !account) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-4 w-4 text-primary" />
          </div>
          Wallet keys
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          For connecting other software to this wallet. You don't need any of
          it to use NostrFeed.
        </p>

        {!open ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Show keys
          </Button>
        ) : (
          <div className="space-y-4">
            {/* An identifier, not a credential: it names the wallet in API
                calls but grants nothing on its own */}
            <Field label="Wallet ID" value={wallet.id} />

            <Secret
              label="Invoice key"
              value={wallet.inkey}
              note="Creates invoices and reads the balance. Cannot spend."
            />

            <Secret
              label="Admin key"
              value={wallet.adminkey}
              note="Spends the balance. Anyone who has it can empty this wallet."
              dangerous
            />

            <WalletLink instanceUrl={instanceUrl} userId={account.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function useCopy() {
  const { toast } = useToast();

  return async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  };
}

function Field({ label, value }: { label: string; value: string }) {
  const copy = useCopy();

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => copy(value, label)}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * A key, hidden until asked for.
 *
 * Concealed by default because these get read over someone's shoulder, or
 * caught by a screen recording, in the one place a person is most likely to be
 * showing their screen to somebody else.
 */
function Secret({
  label,
  value,
  note,
  dangerous,
}: {
  label: string;
  value: string;
  note: string;
  dangerous?: boolean;
}) {
  const copy = useCopy();
  const [shown, setShown] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs">
        {dangerous && <ShieldAlert className="h-3.5 w-3.5 text-destructive" />}
        {label}
      </Label>

      <div className="flex items-center gap-2">
        <Input
          readOnly
          type={shown ? 'text' : 'password'}
          value={value}
          className="font-mono text-xs"
        />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => copy(value, label)}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>

      <p
        className={
          dangerous
            ? 'text-xs font-medium text-destructive'
            : 'text-xs text-muted-foreground'
        }
      >
        {note}
      </p>
    </div>
  );
}

/**
 * The link that opens this wallet on another device.
 *
 * The account id in it is the whole credential — scanning this is signing in,
 * so the code is not drawn until it is asked for. A QR left on screen is
 * readable from across a room, and from any photograph of it.
 */
function WalletLink({
  instanceUrl,
  userId,
}: {
  instanceUrl: string;
  userId: string;
}) {
  const copy = useCopy();
  const [shown, setShown] = useState(false);
  const url = `${instanceUrl}/wallet?usr=${userId}`;

  return (
    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <Label className="flex items-center gap-1.5 text-xs">
        <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
        Wallet link
      </Label>
      <p className="text-xs font-medium text-destructive">
        Opens this wallet with no password. Treat it like the balance itself.
      </p>

      {shown ? (
        <div className="space-y-2">
          <QrCode
            value={url}
            label="QR code that opens this wallet"
            size={168}
          />
          <div className="flex items-center gap-2">
            <Input readOnly value={url} className="font-mono text-xs" />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => copy(url, 'Wallet link')}
              aria-label="Copy wallet link"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShown(false)}>
            <EyeOff className="mr-2 h-3.5 w-3.5" />
            Hide
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShown(true)}>
          <Eye className="mr-2 h-3.5 w-3.5" />
          Reveal link and QR
        </Button>
      )}
    </div>
  );
}
