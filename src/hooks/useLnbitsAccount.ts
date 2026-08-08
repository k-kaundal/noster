import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useToast } from '@/hooks/useToast';
import { lnbitsRequest, type LnbitsUser } from '@/lib/lnbits';

/**
 * Editing the wallet account: name, password, notification email.
 *
 * Signing in with a Nostr key is enough to use the wallet, but it is the only
 * way in — lose the signer and the balance is unreachable. A password is a
 * second door, and an email is somewhere a payment notice can land when the
 * app is closed. Both are optional, which is why neither is asked for up
 * front.
 */
export function useLnbitsAccount() {
  const { account, token } = useLnbitsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['lnbits-account'] });

  const updateProfile = useMutation({
    mutationFn: async ({
      username,
      email,
    }: {
      username: string;
      /** Where payment notices go. Not the account's login email. */
      email?: string;
    }) => {
      if (!account) throw new Error('Connect your wallet first');

      return lnbitsRequest<LnbitsUser>('/api/v1/auth', {
        method: 'PATCH',
        token,
        body: {
          user_id: account.id,
          username,
          extra: {
            ...account.extra,
            notifications: {
              ...account.extra?.notifications,
              email_address: email || undefined,
            },
          },
        },
      });
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Account updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update your account',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const setPassword = useMutation({
    mutationFn: async ({
      username,
      password,
      passwordRepeat,
      currentPassword,
    }: {
      username: string;
      password: string;
      passwordRepeat: string;
      /** Required only when changing one that already exists. */
      currentPassword?: string;
    }) => {
      if (!account) throw new Error('Connect your wallet first');

      return lnbitsRequest<LnbitsUser>('/api/v1/auth/password', {
        method: 'PUT',
        token,
        body: {
          user_id: account.id,
          username,
          password,
          password_repeat: passwordRepeat,
          password_old: currentPassword || undefined,
        },
      });
    },
    onSuccess: () => {
      refresh();
      toast({
        title: 'Password set',
        description: 'You can now sign in with a username and password too.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not set the password',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Points the account at whichever Nostr key is signed in now.
   *
   * Needed after switching keys: the wallet stays bound to the pubkey it was
   * created with, so signing in with a new key would otherwise open a
   * different, empty account.
   */
  const linkPubkey = useMutation({
    mutationFn: async (pubkey: string) => {
      if (!account) throw new Error('Connect your wallet first');

      return lnbitsRequest<LnbitsUser>('/api/v1/auth/pubkey', {
        method: 'PUT',
        token,
        body: { user_id: account.id, pubkey },
      });
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Nostr key linked' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not link that key',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    account,
    hasPassword: !!account?.has_password,
    notificationEmail: account?.extra?.notifications?.email_address ?? '',
    updateProfile: updateProfile.mutateAsync,
    isUpdating: updateProfile.isPending,
    setPassword: setPassword.mutateAsync,
    isSettingPassword: setPassword.isPending,
    linkPubkey: linkPubkey.mutateAsync,
    isLinking: linkPubkey.isPending,
  };
}
