// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import { Suspense, lazy, useState } from 'react';
import { User, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { AccountSwitcher } from './AccountSwitcher';
import { useIdlePrefetch, useOnceOpened } from '@/hooks/useDeferredDialog';
import { cn } from '@/lib/utils';

/**
 * Both dialogs sit in the header on every page and open on a click. Deferred
 * so signing in costs nothing until someone signs in, and prefetched on idle
 * so the click still opens instantly.
 */
const loadLogin = () => import('./LoginDialog');
const loadSignup = () => import('./SignupDialog');
const LoginDialog = lazy(loadLogin);
const SignupDialog = lazy(loadSignup);

/**
 * Opened the moment signup finishes, so a new account never lands on an empty
 * Following tab wondering what it just joined.
 */
const WelcomeFollows = lazy(() =>
  import('./WelcomeFollows').then((m) => ({ default: m.WelcomeFollows }))
);

export interface LoginAreaProps {
  className?: string;
}

export function LoginArea({ className }: LoginAreaProps) {
  const { currentUser, isReadOnly } = useLoggedInAccounts();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const loginMounted = useOnceOpened(loginDialogOpen);
  const signupMounted = useOnceOpened(signupDialogOpen);
  const welcomeMounted = useOnceOpened(welcomeOpen);

  useIdlePrefetch(loadLogin);
  useIdlePrefetch(loadSignup);

  const handleLogin = () => {
    setLoginDialogOpen(false);
    setSignupDialogOpen(false);
  };

  return (
    <div className={cn("inline-flex items-center justify-center", className)}>
      {currentUser ? (
        <div className="flex items-center gap-2">
          <AccountSwitcher onAddAccountClick={() => setLoginDialogOpen(true)} />
          {/* Browsing as someone is not being them, and the way out of it
              should not be hidden inside a menu that looks like an account */}
          {isReadOnly && (
            <Button
              size="sm"
              onClick={() => setLoginDialogOpen(true)}
              className="rounded-full font-medium"
            >
              <span className="truncate">Log in</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="flex w-full items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={() => setLoginDialogOpen(true)}
            className='flex items-center gap-2 rounded-full font-medium'
          >
            <User className='w-4 h-4' />
            <span className='truncate'>Log in</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setSignupDialogOpen(true)}
            variant="outline"
            className="hidden items-center gap-2 rounded-full font-medium sm:flex"
          >
            <UserPlus className="w-4 h-4" />
            <span>Sign up</span>
          </Button>
        </div>
      )}

      <Suspense fallback={null}>
        {loginMounted && (
          <LoginDialog
            isOpen={loginDialogOpen}
            onClose={() => setLoginDialogOpen(false)}
            onLogin={handleLogin}
            onSignup={() => setSignupDialogOpen(true)}
          />
        )}

        {signupMounted && (
          <SignupDialog
            isOpen={signupDialogOpen}
            onClose={() => setSignupDialogOpen(false)}
            onComplete={() => setWelcomeOpen(true)}
          />
        )}

        {welcomeMounted && (
          <WelcomeFollows open={welcomeOpen} onOpenChange={setWelcomeOpen} />
        )}
      </Suspense>
    </div>
  );
}