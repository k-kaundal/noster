import { Construction } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * A page whose design exists and whose feature does not.
 *
 * These screens shipped filled with invented content — bounties with named
 * winners, sats drops with claim counts, memberships with subscriber numbers —
 * and nothing on them said so. On a site that moves money that is not a
 * placeholder, it is a claim: a visitor reading "5,000 sats, 87 already
 * claimed" has been told something untrue about money, and the fact that the
 * buttons did nothing only becomes apparent after they press one.
 *
 * So the fabrications are gone and the layout stays. What is left says what
 * the page is for and that it does not work yet, which is the whole of what
 * this app currently knows.
 *
 * Every page using this is also `noindex`, so a search engine is not offering
 * a stranger a bounty board that has never had a bounty on it.
 */
export function NotBuiltYet({
  what,
  plan,
}: {
  /** What the feature is, in one sentence. */
  what: string;
  /** What has to exist before it can work. Concrete, not a roadmap. */
  plan?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 px-8 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
          <Construction className="h-5 w-5 text-muted-foreground" />
        </span>

        <div className="max-w-md space-y-2">
          <p className="text-sm font-medium">Not built yet</p>
          <p className="text-sm text-muted-foreground">{what}</p>
          {plan && (
            <p className="text-xs text-muted-foreground/80">{plan}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
