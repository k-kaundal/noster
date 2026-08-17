import { Card, CardContent } from '@/components/ui/card';
import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import { Skeleton } from '@/components/ui/skeleton';
import { useNip05Pubkey } from '@/hooks/useNip05Pubkey';
import { useSeo } from '@/hooks/useSeo';
import { formatHandle, type Handle } from '@/lib/nip05Lookup';

/**
 * A profile reached by name rather than by key.
 *
 * The address someone can put in a bio on another site, say out loud, or print
 * — which an `npub` is not. See `lib/nip05Lookup`.
 */
export function VanityProfile({ handle }: { handle: Handle }) {
  const { data, isLoading, isError } = useNip05Pubkey(handle);

  useSeo({
    title: formatHandle(handle),
    description: `${formatHandle(handle)} on Nostr.`,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  /**
   * A name nobody claims is genuinely not found, and says so rather than
   * showing an empty profile.
   *
   * Distinguished from a NIP-19 identifier that will not decode only in the
   * wording: both are 404s, but somebody who typed a name wants to know the
   * name is wrong, not that an identifier is malformed.
   */
  if (isError || !data) {
    return (
      <Layout>
        <div className="mx-auto w-full max-w-lg px-4 py-16">
          <Card className="border-dashed">
            <CardContent className="space-y-2 px-8 py-12 text-center">
              <p className="font-medium">Nobody here goes by that name</p>
              <p className="text-sm text-muted-foreground">
                No account is registered as{' '}
                <span className="font-mono">{formatHandle(handle)}</span>.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Profile pubkey={data.pubkey} />
    </Layout>
  );
}

export default VanityProfile;
