import { useState } from 'react';
import { KeyRound, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { cn } from '@/lib/utils';

/**
 * The second way into the wallet, for devices without a Nostr signer.
 *
 * Folded away behind a link rather than shown beside the Nostr button. Almost
 * everyone here signs with their key; a username and password field presented
 * as an equal option invites people to create credentials they don't need.
 */
export function PasswordSignIn({ className }: { className?: string }) {
  const {
    connectWithPassword,
    isConnectingWithPassword,
    connectWithLink,
    isConnectingWithLink,
  } = useLnbitsAuth();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [walletLink, setWalletLink] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline',
          className
        )}
      >
        Already have a wallet? Sign in to it
      </button>
    );
  }

  return (
    <form
      className={cn('space-y-3 rounded-xl border p-4 text-left', className)}
      onSubmit={(event) => {
        event.preventDefault();
        void connectWithPassword({ username: username.trim(), password }).then(
          () => {
            setPassword('');
            setOpen(false);
          },
          () => {
            // useLnbitsAuth reports the reason; the form stays open to retry
          }
        );
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="wallet-username" className="text-xs">
          Username
        </Label>
        <Input
          id="wallet-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          placeholder="satoshi"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wallet-password" className="text-xs">
          Password
        </Label>
        <Input
          id="wallet-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={isConnectingWithPassword || !username.trim() || !password}
        >
          {isConnectingWithPassword ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <KeyRound className="mr-2 h-3.5 w-3.5" />
          )}
          Sign in
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        This opens the wallet on whichever account those credentials belong to.
        If it isn't linked to the Nostr key you're signed in with, the wallet
        page will say so.
      </p>

      {/* An account made before this app existed usually has no password at
          all — the link it was created with is the only credential there is */}
      <div className="space-y-1.5 border-t pt-3">
        <Label htmlFor="wallet-link" className="text-xs">
          No password? Paste your wallet link
        </Label>
        <Input
          id="wallet-link"
          value={walletLink}
          onChange={(event) => setWalletLink(event.target.value)}
          placeholder="https://…/wallet?usr=…"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isConnectingWithLink || !walletLink.trim()}
          onClick={() => {
            void connectWithLink(walletLink).then(
              () => {
                setWalletLink('');
                setOpen(false);
              },
              () => {
                // useLnbitsAuth reports the reason; the field stays for a retry
              }
            );
          }}
        >
          {isConnectingWithLink ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Link2 className="mr-2 h-3.5 w-3.5" />
          )}
          Sign in with link
        </Button>
        <p className="text-xs text-muted-foreground">
          The whole address is fine — only the account id in it is used, and it
          is never stored anywhere but this browser.
        </p>
      </div>
    </form>
  );
}
