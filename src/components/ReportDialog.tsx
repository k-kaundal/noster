import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Flag, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useReport } from '@/hooks/useReport';
import { useMuteList } from '@/hooks/useMuteList';
import { REPORT_TYPES, type ReportType } from '@/lib/reactions';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who is being reported. */
  pubkey: string;
  displayName: string;
  /** The note that prompted it, when there is one. */
  event?: NostrEvent;
}

export function ReportDialog({
  open,
  onOpenChange,
  pubkey,
  displayName,
  event,
}: ReportDialogProps) {
  const { report, isReporting } = useReport();
  const { muteUser, isUserMuted } = useMuteList();

  const [type, setType] = useState<ReportType>('spam');
  const [reason, setReason] = useState('');
  const [alsoMute, setAlsoMute] = useState(true);

  const submit = async () => {
    await report({
      pubkey,
      eventId: event?.id,
      kind: event?.kind,
      type,
      reason,
    });

    // Reporting rarely means "and keep showing me this"
    if (alsoMute && !isUserMuted(pubkey)) {
      await muteUser(pubkey);
    }

    onOpenChange(false);
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Report {displayName}
          </DialogTitle>
          <DialogDescription>
            Reports are public Nostr events. There is no central moderator —
            relays and other clients decide what to do with them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup
            value={type}
            onValueChange={(value) => setType(value as ReportType)}
            className="gap-2"
          >
            {REPORT_TYPES.map((option) => (
              <Label
                key={option.value}
                htmlFor={`report-${option.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 font-normal transition-colors hover:bg-accent/60 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem
                  id={`report-${option.value}`}
                  value={option.value}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          <div className="space-y-1.5">
            <Label htmlFor="report-reason" className="text-sm">
              Anything to add? (optional)
            </Label>
            <Textarea
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Context that would help someone reviewing this."
              rows={2}
              className="resize-none"
            />
          </div>

          <Label className="flex cursor-pointer items-center gap-2.5 text-sm font-normal">
            <Checkbox
              checked={alsoMute}
              onCheckedChange={(checked) => setAlsoMute(checked === true)}
            />
            Also mute {displayName}, so they leave your feed
          </Label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={isReporting}
          >
            {isReporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
