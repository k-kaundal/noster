import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, ShieldAlert, Smartphone } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCode } from '@/components/wallet/QrCode';
import { useToast } from '@/hooks/useToast';
import { encryptKey, keyQrValue } from '@/lib/keyTransfer';

/**
 * How long a key stays on screen before it hides itself.
 *
 * A code left up is readable across a room, by a camera on a shelf, and by
 * anyone who walks past afterwards. Long enough to point a phone at, short
 * enough that walking away does not leave the account on display.
 */
const VISIBLE_MS = 45_000;

/**
 * Signing in on another device by scanning.
 *
 * The honest version of this feature: a Nostr key is the account, so a QR of
 * one is the account in a form a camera can take from across a room. Two ways
 * out, and the encrypted one is first because it is the one that survives
 * being photographed.
 */
export function KeyTransfer({ nsec }: { nsec: string }) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Sign in on another device</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Scan with another Nostr app to sign in there as you. Whoever scans
            it becomes you — there is no undo and no way to change the key.
          </p>
        </div>
      </div>

      <Tabs defaultValue="encrypted">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="encrypted">
            <Lock className="mr-1.5 h-3 w-3" />
            Protected
          </TabsTrigger>
          <TabsTrigger value="plain">Plain key</TabsTrigger>
        </TabsList>

        <TabsContent value="encrypted" className="pt-3">
          <EncryptedTransfer nsec={nsec} />
        </TabsContent>

        <TabsContent value="plain" className="pt-3">
          <PlainTransfer nsec={nsec} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Shows a code, and takes it away again.
 *
 * The countdown is the feature. Everything else here is a reveal button, which
 * only protects the moment before it is pressed — this protects the ten
 * minutes afterwards, when the person has already stopped thinking about it.
 */
function TimedCode({
  value,
  label,
  caption,
  onExpire,
}: {
  value: string;
  label: string;
  caption: string;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState(Math.round(VISIBLE_MS / 1000));
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((seconds) => {
        if (seconds <= 1) {
          clearInterval(timer);
          expire.current();
          return 0;
        }

        return seconds - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /**
   * Hidden the moment the tab stops being looked at.
   *
   * Switching away is the shape of starting a screen share, answering a call,
   * or handing the laptop over — all of which end with the key on a screen
   * somebody else is watching.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') expire.current();
    };

    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onHidden);

    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', onHidden);
    };
  }, []);

  return (
    <div className="space-y-2">
      <QrCode value={keyQrValue(value)} label={label} size={196} />

      <p className="text-center text-xs text-muted-foreground">{caption}</p>

      <div className="flex items-center justify-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          Hiding in {remaining}s
        </span>
        <Button variant="ghost" size="sm" onClick={() => expire.current()}>
          <EyeOff className="mr-1.5 h-3.5 w-3.5" />
          Hide now
        </Button>
      </div>
    </div>
  );
}

/**
 * A key wrapped in a passphrase before it is drawn.
 *
 * What makes this safe to hold up in a room: a photograph of the code is
 * worthless to whoever took it. The passphrase travels by being spoken, or
 * being already known, and never appears on the screen beside the code.
 */
function EncryptedTransfer({ nsec }: { nsec: string }) {
  const { toast } = useToast();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [encrypted, setEncrypted] = useState('');

  const build = useCallback(() => {
    setBusy(true);

    // Deferred a frame: NIP-49 runs scrypt, which blocks for a second or two,
    // and a button that freezes before it responds reads as a broken one
    setTimeout(() => {
      try {
        setEncrypted(encryptKey(nsec, passphrase));
        setPassphrase('');
      } catch (error) {
        toast({
          title: 'Could not protect the key',
          description: (error as Error).message,
          variant: 'destructive',
        });
      } finally {
        setBusy(false);
      }
    }, 30);
  }, [nsec, passphrase, toast]);

  if (encrypted) {
    return (
      <TimedCode
        value={encrypted}
        label="QR code for your passphrase-protected Nostr key"
        caption="Scan this, then enter the passphrase on the other device."
        onExpire={() => setEncrypted('')}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="transfer-passphrase" className="text-xs">
        Passphrase
      </Label>
      <Input
        id="transfer-passphrase"
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && passphrase.length >= 8) build();
        }}
        placeholder="At least 8 characters"
        autoComplete="new-password"
      />

      <p className="text-xs leading-relaxed text-muted-foreground">
        You'll type this again on the other device. Nothing stores it — forget
        it and the code is scrap, so use one you'll still have in a minute.
      </p>

      <Button
        size="sm"
        className="w-full"
        onClick={build}
        disabled={passphrase.length < 8 || busy}
      >
        {busy ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Lock className="mr-2 h-3.5 w-3.5" />
        )}
        {busy ? 'Protecting…' : 'Make a protected code'}
      </Button>
    </div>
  );
}

/**
 * The raw key, for clients that cannot read an encrypted one.
 *
 * Kept because it is what actually works everywhere, and hidden behind a
 * statement of the consequence rather than a warning triangle — someone who
 * has read "anyone who photographs this owns your account" and pressed the
 * button anyway has made a decision, which is all that can be asked.
 */
function PlainTransfer({ nsec }: { nsec: string }) {
  const [shown, setShown] = useState(false);

  if (shown) {
    return (
      <TimedCode
        value={nsec}
        label="QR code for your Nostr secret key"
        caption="Works in any Nostr app. Nothing protects it but the screen."
        onExpire={() => setShown(false)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2.5">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <p className="text-xs leading-relaxed text-destructive">
          This code is your account in plain form. A photograph of it, a screen
          recording, or somebody across the room with a phone is enough. There
          is no changing the key afterwards.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShown(true)}
      >
        <Eye className="mr-2 h-3.5 w-3.5" />
        Show it anyway
      </Button>
    </div>
  );
}
