import { useState } from 'react';
import { Eye, EyeOff, Copy, AlertTriangle } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';
import { nip19 } from 'nostr-tools';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';

interface PrivateKeyDialogProps {
  children?: React.ReactNode;
}

export function PrivateKeyDialog({ children }: PrivateKeyDialogProps) {
  const { logins } = useNostrLogin();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentLogin = logins[0];

  if (!currentLogin) return null;

  // Only show for nsec logins (user has the secret key)
  const isNsecLogin = currentLogin.type === 'nsec';
  if (!isNsecLogin) return null;

  // An nsec login stores the key under `data`; a signer-backed login has no key
  // here at all, which is why the type is checked before reading it
  const { data } = currentLogin as { data?: { nsec?: string } };
  const nsec = data?.nsec || '';

  if (!nsec) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      toast({
        title: 'Copied',
        description: 'Private key copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            Show Private Key
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Your Private Key
          </DialogTitle>
          <DialogDescription>
            This is your secret key. Never share it with anyone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Security Warning */}
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              ⚠️ <strong>Never share your private key.</strong> Anyone with this key can access your account and steal your funds. Keep it safe and secure.
            </p>
          </div>

          {/* Private Key Display */}
          <div className="space-y-2">
            <Label>Private Key (nsec format)</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={nsec}
                readOnly
                className="font-mono text-xs pr-20"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCopy}
                  aria-label="Copy key"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {copied && (
              <p className="text-xs text-green-600 dark:text-green-400">
                ✓ Copied to clipboard
              </p>
            )}
          </div>

          {/* Additional Info */}
          <div className="space-y-2">
            <Label>Public Key (npub format)</Label>
            <Input
              type="text"
              value={nip19.npubEncode(currentLogin.pubkey)}
              readOnly
              className="font-mono text-xs"
            />
          </div>

          {/* Hex Format */}
          <div className="space-y-2">
            <Label>Public Key (hex format)</Label>
            <Input
              type="text"
              value={currentLogin.pubkey}
              readOnly
              className="font-mono text-xs break-all"
            />
          </div>

          {/* Close Button */}
          <Button
            onClick={() => setIsOpen(false)}
            className="w-full"
            variant="outline"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
