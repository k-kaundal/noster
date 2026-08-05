// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import { ChevronDown, LogOut, UserIcon, UserPlus, UserRound, Wallet } from 'lucide-react';
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
import { RelaySelector } from '@/components/RelaySelector';
import { WalletModal } from '@/components/WalletModal';
import { useLoggedInAccounts, type Account } from '@/hooks/useLoggedInAccounts';
import { genUserName } from '@/lib/genUserName';

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const { currentUser, otherUsers, setLogin, removeLogin } = useLoggedInAccounts();

  if (!currentUser) return null;

  const getDisplayName = (account: Account): string => {
    return account.metadata.name ?? genUserName(account.pubkey);
  }

  return (
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
        <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-md'>
          <Link to={`/${nip19.npubEncode(currentUser.pubkey)}`}>
            <UserRound className='w-4 h-4' />
            <span>View profile</span>
          </Link>
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
            </div>
            {user.id === currentUser.id && <div className='w-2 h-2 rounded-full bg-primary'></div>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <WalletModal>
          <DropdownMenuItem
            className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
            onSelect={(e) => e.preventDefault()}
          >
            <Wallet className='w-4 h-4' />
            <span>Wallet Settings</span>
          </DropdownMenuItem>
        </WalletModal>
        <DropdownMenuItem
          onClick={onAddAccountClick}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
        >
          <UserPlus className='w-4 h-4' />
          <span>Add another account</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => removeLogin(currentUser.id)}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-destructive focus:text-destructive'
        >
          <LogOut className='w-4 h-4' />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}