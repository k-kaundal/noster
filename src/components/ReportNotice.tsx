import { useState } from 'react';
import { Flag, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFriendReports } from '@/hooks/useFriendReports';
import { describeReports, REPORT_TYPES } from '@/lib/reports';
import { cn } from '@/lib/utils';

const TYPE_LABELS = new Map(
  REPORT_TYPES.map((entry) => [entry.value, entry.label])
);

/**
 * What the people you follow have said about an account.
 *
 * Shown rather than acted on. NIP-56 is clear that reports are gameable, and
 * the gap between "some people you follow flagged this" and "this account is
 * bad" is exactly the judgement a reader should be making instead of the app —
 * so this states the count, names who, and does nothing else. Hiding the
 * account on the same evidence would turn a following list into a mob.
 */
export function ReportNotice({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const reports = useFriendReports();
  const [open, setOpen] = useState(false);

  const summary = reports.forPubkey(pubkey);
  if (!reports.warns(pubkey) || !summary) return null;

  const breakdown = Object.entries(summary.counts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${TYPE_LABELS.get(type as never) ?? type}: ${count}`);

  return (
    <div
      className={cn(
        'rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm',
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <Flag className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />

        <div className="min-w-0 flex-1 space-y-1">
          <p>{describeReports(summary)}</p>

          <p className="text-xs text-muted-foreground">
            Reports are public and easy to file. This is what people you follow
            have said, not a verdict.
          </p>

          {(breakdown.length > 1 || summary.notes.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto gap-1 px-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={() => setOpen(!open)}
            >
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  open && 'rotate-180'
                )}
              />
              {open ? 'Hide details' : 'Details'}
            </Button>
          )}

          {open && (
            <div className="space-y-1.5 pt-1 text-xs text-muted-foreground">
              <p>{breakdown.join(' · ')}</p>

              {/*
                The reporters' own words, which are often the only thing that
                distinguishes a considered report from a pile-on.
              */}
              {summary.notes.map((note, index) => (
                <p key={index} className="border-l-2 border-border pl-2 italic">
                  {note}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
