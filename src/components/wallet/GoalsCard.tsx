import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Plus, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ZapGoalEditor } from '@/components/ZapGoalEditor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useZapGoals } from '@/hooks/useZapGoal';
import { formatSats } from '@/lib/zap';

/**
 * Your fundraising goals, beside the wallet the money arrives in.
 *
 * A goal is a one-off ask — a microphone, a flight, a month of hosting — where
 * a subscription tier is a standing one, so the two sit next to each other and
 * neither pretends to be the other.
 */
export function GoalsCard() {
  const { user } = useCurrentUser();
  const { data: goals, isLoading } = useZapGoals(user?.pubkey);
  const [composing, setComposing] = useState(false);

  if (!user) return null;

  const now = Date.now() / 1000;
  const open = (goals ?? []).filter(
    (goal) => !goal.closedAt || goal.closedAt > now
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4" />
          Goals
        </CardTitle>

        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New goal
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? null : open.length ? (
          open.map((goal) => (
            <Link
              key={goal.event.id}
              /*
               * Encoded, because the router decodes NIP-19 and a bare hex id
               * is not one — it would fall through to the 404 rather than
               * opening the goal.
               */
              to={`/${nip19.neventEncode({
                id: goal.event.id,
                author: goal.event.pubkey,
                kind: goal.event.kind,
                relays: goal.relays.slice(0, 2),
              })}`}
              className="block space-y-1.5 rounded-lg border p-3 transition-colors active:bg-accent lg:hover:bg-accent/50"
            >
              <p className="line-clamp-1 text-sm font-medium">
                {goal.summary || goal.description || 'Untitled goal'}
              </p>

              {/*
                Zero rather than the live tally. Reading the real total means
                querying the goal's own relays per goal, which is what the goal
                page is for — this is a list of what exists, and the bar is the
                target it is aiming at.
              */}
              <Progress value={0} className="h-1.5" />

              <p className="text-xs text-muted-foreground">
                Target {formatSats(Math.round(goal.amountMsat / 1000))} sats
                {goal.closedAt
                  ? ` · until ${new Date(goal.closedAt * 1000).toLocaleDateString()}`
                  : ''}
              </p>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No open goals. Set a target — a microphone, a flight, a month of
            hosting — and people can zap toward it.
          </p>
        )}
      </CardContent>

      {composing && (
        <ZapGoalEditor open={composing} onOpenChange={setComposing} />
      )}
    </Card>
  );
}
