// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import { useState } from 'react';
import { ChevronDown, Eye, LogOut, Pencil, UserIcon, UserPlus, UserRound, Wallet, Key } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { RelaySelector } from '@/components/RelaySelector';
import { WalletModal } from '@/components/WalletModal';
import { PrivateKeyDialog } from './PrivateKeyDialog';
import { useLoggedInAccounts, type Account } from '@/hooks/useLoggedInAccounts';
import { useAccountLabels } from '@/hooks/useAccountLabels';
import { useWalletLogout } from '@/hooks/useWalletLogout';
import { accountName, accountSubtitle, MAX_NICKNAME_LENGTH } from '@/lib/accounts';
import { genUserName } from '@/lib/genUserName';

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

/** How this account signs, said in as few words as it takes. */
function methodLabel(account: Account): string | null {
  switch (account.method) {
    case 'read-only':
      return 'Read-only';
    case 'bunker':
      return 'Remote signer';
    case 'extension':
      return 'Extension';
    default:
      return null;
  }
}

export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const { currentUser, otherUsers, setLogin, removeAccount, isReadOnly } =
    useLoggedInAccounts();
  const { rename } = useAccountLabels();
  const logoutWallet = useWalletLogout();

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  if (!currentUser) return null;

  const getDisplayName = (account: Account): string =>
    accountName({
      nickname: account.nickname,
      profileName: account.metadata.name,
      fallback: genUserName(account.pubkey),
    });

  const saveNickname = () => {
    rename(currentUser.pubkey, draft);
    setRenaming(false);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            className='flex max-w-full items-center gap-2 rounded-full p-1 pr-2 text-foreground transition-colors hover:bg-accent'
            aria-label='Account menu'
          >
            <Avatar className='h-8 w-8 shrink-0'>
              <AvatarImage src={currentUser.metadata.picture} alt='' />
              <AvatarFallback className='text-xs'>{getDisplayName(currentUser).charAt(0)}</AvatarFallback>
            </Avatar>
            <span className='hidden min-w-0 flex-1 truncate text-left text-sm font-medium sm:block'>
              {getDisplayName(currentUser)}
            </span>
            <ChevronDown className='hidden h-4 w-4 shrink-0 text-muted-foreground sm:block' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56 p-2 animate-scale-in'>
          {/*
            What kind of session this is, said before anything offers to act.
            A read-only session looks exactly like a signed-in one until you
            try to post, and finding out then is finding out too late.
          */}
          <div className='flex items-center justify-between gap-2 px-2 py-1.5'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{getDisplayName(currentUser)}</p>
              {accountSubtitle({
                nickname: currentUser.nickname,
                profileName: currentUser.metadata.name,
              }) && (
                <p className='truncate text-xs text-muted-foreground'>
                  {currentUser.metadata.name}
                </p>
              )}
            </div>
            {methodLabel(currentUser) && (
              <Badge variant='secondary' className='shrink-0 gap-1 text-[10px]'>
                {isReadOnly && <Eye className='h-3 w-3' />}
                {methodLabel(currentUser)}
              </Badge>
            )}
          </div>

          {isReadOnly && (
            <div className='mb-1 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground'>
              You're browsing someone else's timeline. Nothing here can post,
              zap or follow until you log in with your own key.
            </div>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-md'>
            <Link to={`/${nip19.npubEncode(currentUser.pubkey)}`}>
              <UserRound className='w-4 h-4' />
              <span>View profile</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
            onSelect={() => {
              setDraft(currentUser.nickname ?? '');
              setRenaming(true);
            }}
          >
            <Pencil className='w-4 h-4' />
            <span>Rename this account</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <div className='font-medium text-sm px-2 py-1.5'>Switch Relay</div>
          <RelaySelector className="w-full" />
          {otherUsers.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className='font-medium text-sm px-2 py-1.5'>Switch Account</div>
            </>
          )}
          {otherUsers.map((user) => (
            <DropdownMenuItem
              key={user.id}
              onClick={() => setLogin(user.id)}
              className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
            >
              <Avatar className='w-8 h-8'>
                <AvatarImage src={user.metadata.picture} alt={getDisplayName(user)} />
                <AvatarFallback>{getDisplayName(user)?.charAt(0) || <UserIcon />}</AvatarFallback>
              </Avatar>
              <div className='flex-1 truncate'>
                <p className='text-sm font-medium'>{getDisplayName(user)}</p>
                {accountSubtitle({
                  nickname: user.nickname,
                  profileName: user.metadata.name,
                }) && (
                  <p className='truncate text-xs text-muted-foreground'>
                    {user.metadata.name}
                  </p>
                )}
              </div>
              {user.id === currentUser.id && <div className='w-2 h-2 rounded-full bg-primary'></div>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />

          {/* A read-only session holds no key, so neither of these has
              anything to show or spend */}
          {!isReadOnly && (
            <>
              <WalletModal>
                <DropdownMenuItem
                  className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
                  onSelect={(e) => e.preventDefault()}
                >
                  <Wallet className='w-4 h-4' />
                  <span>Wallet Settings</span>
                </DropdownMenuItem>
              </WalletModal>
              <PrivateKeyDialog>
                <DropdownMenuItem
                  className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
                  onSelect={(e) => e.preventDefault()}
                >
                  <Key className='w-4 h-4' />
                  <span>View Private Key</span>
                </DropdownMenuItem>
              </PrivateKeyDialog>
            </>
          )}

          <DropdownMenuItem
            onClick={onAddAccountClick}
            className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
          >
            <UserPlus className='w-4 h-4' />
            <span>{isReadOnly ? 'Log in with your key' : 'Add another account'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              // The wallet is reached by proving ownership of this key, so it
              // goes when the key does. Its pubkey is read before the login is
              // removed, since afterwards there is nothing left to identify it.
              const { pubkey, id } = currentUser;
              void logoutWallet(pubkey).finally(() => removeAccount(id));
            }}
            className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-destructive focus:text-destructive'
          >
            <LogOut className='w-4 h-4' />
            <span>{isReadOnly ? 'Stop browsing' : 'Log out'}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Rename this account</DialogTitle>
            <DialogDescription>
              A private name, so you can tell your accounts apart in this menu.
              It stays on this device and is never published.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-1.5'>
            <Label htmlFor='account-nickname'>Name</Label>
            <Input
              id='account-nickname'
              value={draft}
              maxLength={MAX_NICKNAME_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveNickname();
              }}
              placeholder={currentUser.metadata.name ?? 'Main, Alt, Work…'}
              autoFocus
            />
            <p className='text-xs text-muted-foreground'>
              Leave it empty to go back to the name on your profile.
            </p>
          </div>

          <DialogFooter>
            <Button variant='ghost' onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button onClick={saveNickname}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
