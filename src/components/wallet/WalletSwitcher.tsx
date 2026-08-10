import { useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { msatToSat } from '@/lib/lnbits';
import { cn } from '@/lib/utils';

/**
 * Choosing which wallet the page is about.
 *
 * An LNbits account can hold several — one for spending, one for a shop, one
 * kept apart — and this app used to show whichever the server listed first,
 * with no sign the others existed. Hidden money is worse than no money: the
 * balance is right there and the person is told they have nothing.
 *
 * Shown even with one wallet, because it is also where a second one gets
 * made — a switcher that appears only once you already have two is no help to
 * anyone who has one.
 */
export function WalletSwitcher({ className }: { className?: string }) {
  const {
    wallets,
    activeWalletId,
    selectWallet,
    totalBalanceSats,
    createWallet,
    isCreatingWallet,
  } = useLnbitsWallet();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const active = wallets.find((entry) => entry.id === activeWalletId);
  if (!active) return null;

  const create = async () => {
    await createWallet(name.trim() || 'New wallet');
    setName('');
    setCreating(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1.5 px-2 text-xs', className)}
          >
            <Wallet className="h-3.5 w-3.5" />
            <span className="max-w-32 truncate">{active.name}</span>
            <ChevronsUpDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="flex items-baseline justify-between gap-2">
            <span>Wallets</span>
            {wallets.length > 1 && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {totalBalanceSats.toLocaleString()} total
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {wallets.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onSelect={() => selectWallet(entry.id)}
              className="gap-2"
            >
              <Check
                className={cn(
                  'h-4 w-4 shrink-0',
                  entry.id === activeWalletId ? 'opacity-100' : 'opacity-0'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {msatToSat(entry.balance_msat).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New wallet
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New wallet</DialogTitle>
            <DialogDescription>
              A separate balance on the same account, with its own keys and its
              own lightning addresses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="wallet-name">Name</Label>
            <Input
              id="wallet-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
              placeholder="Spending, Shop, Savings…"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={isCreatingWallet}>
              {isCreatingWallet && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
