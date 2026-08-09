import { useState } from 'react';
import { KeyRound, Link2, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { cn } from '@/lib/utils';

/**
 * The way back into a wallet that already exists.
 *
 * In a dialog rather than inline, because it is the rarer path and unfolding
 * two credential forms under the main offer buries the button most people came
 * for. The link tab leads: an account made before this app usually has no
 * password at all, and the URL it was created with is the only way in.
 */
export function ExistingWalletSignIn({ className }: { className?: string }) {
  const {
    connectWithPassword,
    isConnectingWithPassword,
    connectWithLink,
    isConnectingWithLink,
  } = useLnbitsAuth();

  const [open, setOpen] = useState(false);
  const [walletLink, setWalletLink] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const close = () => {
    setOpen(false);
    setPassword('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('gap-2', className)}>
          <LogIn className="h-4 w-4" />
          I already have a wallet
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to your wallet</DialogTitle>
          <DialogDescription>
            This opens whichever account the details belong to. If it isn't
            linked to the Nostr key you're signed in with, the wallet page will
            say so and offer to link them.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link">
          <TabsList className="w-full">
            <TabsTrigger value="link" className="flex-1">
              Wallet link
            </TabsTrigger>
            <TabsTrigger value="password" className="flex-1">
              Password
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-3 pt-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connectWithLink(walletLink).then(() => {
                  setWalletLink('');
                  close();
                }, () => {
                  // useLnbitsAuth reports the reason; the field stays to retry
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="wallet-link">Your wallet address</Label>
                <Input
                  id="wallet-link"
                  value={walletLink}
                  onChange={(event) => setWalletLink(event.target.value)}
                  placeholder="https://…/wallet?usr=…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the whole address. Only the account id inside it is
                  used, and it never leaves this browser.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isConnectingWithLink || !walletLink.trim()}
              >
                {isConnectingWithLink ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Sign in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="password" className="space-y-3 pt-4">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connectWithPassword({
                  username: username.trim(),
                  password,
                }).then(close, () => {
                  // Same here: the form stays open so it can be corrected
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="wallet-username">Username</Label>
                <Input
                  id="wallet-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="satoshi"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wallet-password">Password</Label>
                <Input
                  id="wallet-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  isConnectingWithPassword || !username.trim() || !password
                }
              >
                {isConnectingWithPassword ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Sign in
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
