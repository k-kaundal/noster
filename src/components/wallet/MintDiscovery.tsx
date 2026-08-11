import { useState } from 'react';
import { Landmark, ShieldCheck, ThumbsUp, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { AvatarStack } from '@/components/AvatarStack';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMintDiscovery, useRecommendMint } from '@/hooks/useMintDiscovery';
import { useCashuMint } from '@/hooks/useCashuMint';
import { CASHU_MINT_KIND, mintDisplayName, type RankedMint } from '@/lib/nip87';
import { mintHost } from '@/lib/cashu';

/**
 * Choosing a mint, and vouching for one.
 *
 * The list is only ever what people you follow keep money at. A mint is a
 * custodian: it holds the sats behind every proof in the wallet, and there is
 * nothing in a browser that can tell an honest one from a mint that will be
 * gone next month. Ranking self-published announcements would present that
 * question as if it had an answer.
 */
export function MintDiscovery({
  currentMintUrl,
  onChoose,
}: {
  currentMintUrl?: string;
  onChoose?: (url: string) => void;
}) {
  const { user } = useCurrentUser();
  const { data: mints, isLoading } = useMintDiscovery();

  if (!user) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          Mints your follows use
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A mint holds the money behind your ecash. Nothing here checks whether
          one is trustworthy — this is only who among the people you follow has
          said they keep funds at it.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </>
        ) : mints?.length ? (
          mints.map((ranked) => (
            <MintRow
              key={`${ranked.announcement.event.pubkey}:${ranked.announcement.id}`}
              ranked={ranked}
              isCurrent={ranked.announcement.urls.some(
                (url) => mintHost(url) === mintHost(currentMintUrl ?? '')
              )}
              onChoose={onChoose}
            />
          ))
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nobody you follow has recommended a mint. There is no safe way for
            this app to suggest one instead — a list of mints that announced
            themselves is a list of whoever published most, which says nothing
            about who will still be holding your money next year. Ask someone
            you trust which mint they use.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MintRow({
  ranked,
  isCurrent,
  onChoose,
}: {
  ranked: RankedMint;
  isCurrent: boolean;
  onChoose?: (url: string) => void;
}) {
  const { announcement, recommenders, reviews } = ranked;
  const [url] = announcement.urls;
  const name = mintDisplayName(announcement);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{name}</span>
            {isCurrent && (
              <Badge variant="secondary" className="text-[10px]">
                Yours
              </Badge>
            )}
            {/*
              A testnet mint issues ecash backed by nothing. Worth a loud label
              rather than a quiet field, since the wallet UI is otherwise
              identical to the real thing.
            */}
            {announcement.network && announcement.network !== 'mainnet' && (
              <Badge variant="outline" className="text-[10px] text-warning-strong">
                {announcement.network} — not real money
              </Badge>
            )}
          </div>

          <p className="truncate font-mono text-xs text-muted-foreground">
            {url}
          </p>

          {announcement.metadata?.about && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {announcement.metadata.about}
            </p>
          )}
        </div>

        {onChoose && !isCurrent && (
          <Button size="sm" variant="outline" onClick={() => onChoose(url)}>
            Use
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AvatarStack pubkeys={recommenders.slice(0, 5)} className="shrink-0" />
        <span className="text-xs text-muted-foreground">
          {recommenders.length === 1
            ? '1 person you follow'
            : `${recommenders.length} people you follow`}
        </span>

        {announcement.nuts.length > 0 && (
          <Badge variant="outline" className="ml-auto gap-1 text-[10px] font-normal">
            <ShieldCheck className="h-3 w-3" />
            {announcement.nuts.length} NUTs
          </Badge>
        )}
      </div>

      {reviews.slice(0, 2).map((review) => (
        <p
          key={review.event.id}
          className="border-l-2 pl-2 text-xs italic text-muted-foreground"
        >
          {review.review}
        </p>
      ))}
    </div>
  );
}

/**
 * Vouching for the mint you actually use.
 *
 * The `d` has to be the mint's own pubkey from `/v1/info`, not its URL — that
 * is what makes two recommendations of the same mint agree, and what lets a
 * reader find the operator's announcement. A mint that does not report one
 * cannot be recommended, which is said plainly rather than papered over with a
 * URL that would not match anybody else's.
 */
export function RecommendMint({ mintUrl }: { mintUrl?: string }) {
  const { user } = useCurrentUser();
  const { mint } = useCashuMint(mintUrl);
  const { mutateAsync: recommend, isPending } = useRecommendMint();
  const [review, setReview] = useState('');

  if (!user || !mintUrl) return null;

  const target = mint?.info?.pubkey;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ThumbsUp className="h-4 w-4 text-primary" />
          </div>
          Recommend this mint
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tells the people who follow you that you keep money at{' '}
          {mintHost(mintUrl)}. Public and replaceable — recommend it again to
          change what you said, and only ever one recommendation per mint.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {target ? (
          <>
            <Textarea
              value={review}
              onChange={(changed) => setReview(changed.target.value)}
              placeholder="Optional — how long you've used it, whether withdrawals work."
              rows={2}
              className="text-sm"
            />

            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                recommend({
                  target,
                  kind: CASHU_MINT_KIND,
                  urls: [mintUrl],
                  review,
                }).then(() => setReview(''))
              }
            >
              {isPending ? 'Publishing…' : 'Publish recommendation'}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This mint doesn't report a pubkey from its info endpoint, so a
            recommendation would have nothing to point at that anyone else
            could match.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
