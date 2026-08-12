import { useMemo, useState } from 'react';
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
import {
  PROFILE_ONLY_TYPES,
  REPORT_TYPES,
  reportableBlobs,
  type ReportType,
} from '@/lib/reports';

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
  /** Index into `blobs`, or -1 for the whole note. */
  const [blobIndex, setBlobIndex] = useState(-1);

  const blobs = useMemo(() => (event ? reportableBlobs(event) : []), [event]);

  /**
   * Impersonation is about an account, not a post, and offering it while a
   * note is selected produces a report that reads as "this note is pretending
   * to be someone". The option stays, it just stops being attached to the
   * note.
   */
  const options = REPORT_TYPES.filter(
    (option) => !event || !PROFILE_ONLY_TYPES.has(option.value)
  );

  /**
   * The same dialog is reused for a profile and for a note, so a type chosen
   * while looking at a profile can outlive the option that offered it. Falling
   * back keeps the group from rendering with nothing selected and a Send
   * button that would publish the vanished choice anyway.
   */
  const selected = options.some((option) => option.value === type)
    ? type
    : 'spam';

  const submit = async () => {
    await report({
      pubkey,
      eventId: event?.id,
      kind: event?.kind,
      type: selected,
      reason,
      blob: blobIndex >= 0 ? blobs[blobIndex] : undefined,
    });

    // Reporting rarely means "and keep showing me this"
    if (alsoMute && !isUserMuted(pubkey)) {
      await muteUser(pubkey);
    }

    onOpenChange(false);
    setReason('');
    setBlobIndex(-1);
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
            value={selected}
            onValueChange={(value) => setType(value as ReportType)}
            className="gap-2"
          >
            {options.map((option) => (
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

          {/*
            Naming the file rather than the note. A post can carry one bad
            image among several, and a report that says which one is the
            difference between a moderator removing a file and removing a
            person.
          */}
          {blobs.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm">What are you reporting?</Label>
              <RadioGroup
                value={String(blobIndex)}
                onValueChange={(value) => setBlobIndex(Number(value))}
                className="gap-1.5"
              >
                <Label
                  htmlFor="report-blob-all"
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-2 font-normal transition-colors hover:bg-accent/60 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
                >
                  <RadioGroupItem id="report-blob-all" value="-1" />
                  <span className="text-sm">The whole post</span>
                </Label>

                {blobs.map((blob, index) => (
                  <Label
                    key={blob.hash}
                    htmlFor={`report-blob-${blob.hash}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-2 font-normal transition-colors hover:bg-accent/60 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
                  >
                    <RadioGroupItem
                      id={`report-blob-${blob.hash}`}
                      value={String(index)}
                    />
                    {blob.url && (
                      <img
                        src={blob.url}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm">
                        {blobs.length === 1 ? 'The attached file' : `File ${index + 1}`}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {blob.hash.slice(0, 16)}…
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
          )}

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
