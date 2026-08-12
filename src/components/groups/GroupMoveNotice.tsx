import { ArrowRight, GitFork } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { GroupMoveReport } from '@/lib/nip29';

/**
 * The group may have moved, or split.
 *
 * NIP-29 asks clients to notice when a group's admins start pointing at a
 * different relay and to "notify the user that the group may have moved or
 * been forked". Both words matter, and no amount of tag reading tells them
 * apart: a migration and a fork look identical on the wire — the same id, a
 * different relay — and differ only in whether the community agreed to it.
 *
 * So this offers the destination and says plainly that it might be either.
 * Switching automatically would silently move somebody into the breakaway
 * half of an argument they do not know is happening.
 */
export function GroupMoveNotice({
  report,
  onSwitch,
}: {
  report: GroupMoveReport;
  onSwitch: (relay: string) => void;
}) {
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-2.5">
          <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />

          <div className="space-y-1">
            <p className="text-sm font-medium">
              This group may have moved
            </p>
            <p className="text-sm text-muted-foreground">
              Admins now list it on{' '}
              {report.candidates.length === 1
                ? 'another relay'
                : `${report.candidates.length} other relays`}
              . That can mean the group migrated, or that it forked and the
              same name now belongs to two communities.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          {report.candidates.map((candidate) => (
            <div
              key={candidate.relay}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">
                  {candidate.relay.replace(/^wss:\/\//, '')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {candidate.vouchedBy.length} admin
                  {candidate.vouchedBy.length === 1 ? '' : 's'} point here
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => onSwitch(candidate.relay)}
              >
                Look there
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
