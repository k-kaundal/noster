import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, Loader2, Target, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCreateZapGoal } from '@/hooks/useZapGoal';
import { useFiat } from '@/hooks/useFiat';
import { useRelays } from '@/hooks/useRelays';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { HIDE_FIAT, formatFiat, satsToFiat } from '@/lib/currency';
import { relayDisplayName } from '@/lib/relay';
import { cn } from '@/lib/utils';

/** Round numbers people actually raise for, in sats. */
const TARGET_PRESETS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

/**
 * Setting up a fundraising goal.
 *
 * Two things about NIP-75 decide the shape of this form, and both are places
 * where a goal silently fails rather than visibly breaking.
 *
 * The target is stored in millisats and nobody thinks in millisats, so this
 * asks for sats and multiplies on the way out. Getting that backwards makes a
 * goal a thousand times too small — and it looks perfectly reasonable until
 * the first zap fills it.
 *
 * The relays are not a preference. A goal names where its zap receipts are
 * published and tallied from, so money sent to a goal listing relays its
 * author does not write to lands somewhere the progress bar never looks. They
 * are shown rather than hidden for that reason.
 */
export function ZapGoalEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey);
  const { toast } = useToast();
  const { writeUrls } = useRelays();
  const { currency, rate } = useFiat();
  const { mutateAsync: createGoal, isPending } = useCreateZapGoal();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('');
  const [summary, setSummary] = useState('');
  const [image, setImage] = useState('');
  const [deadline, setDeadline] = useState('');

  const targetSats = Number.parseInt(target, 10);
  const targetIsUsable = Number.isFinite(targetSats) && targetSats > 0;

  /**
   * Whether anybody could fund this at all.
   *
   * A goal is funded by zapping the goal event, which needs the author to have
   * a lightning address on their profile. Without one the goal publishes fine,
   * appears fine, and cannot take a single sat — so it is worth saying before
   * somebody writes one rather than after.
   */
  const metadata = author.data?.metadata;
  const payable = !!(metadata?.lud16 || metadata?.lud06);

  const fiat = useMemo(() => {
    if (!targetIsUsable || !rate || currency === HIDE_FIAT) return null;
    return formatFiat(satsToFiat(targetSats, rate), rate.currency);
  }, [currency, rate, targetIsUsable, targetSats]);

  const reset = () => {
    setDescription('');
    setTarget('');
    setSummary('');
    setImage('');
    setDeadline('');
  };

  const handleUpload = async (file: File) => {
    try {
      const [[, url]] = await uploadFile(file);
      setImage(url);
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error)?.message,
        variant: 'destructive',
      });
    }
  };

  const submit = async () => {
    if (!description.trim()) {
      toast({
        title: 'Say what it is for',
        description: 'People fund a reason, not a number.',
        variant: 'destructive',
      });
      return;
    }

    if (!targetIsUsable) {
      toast({ title: 'Set a target above zero', variant: 'destructive' });
      return;
    }

    /*
     * End of the chosen day, not its midnight. A deadline of "the 20th" that
     * stopped counting at 00:00 on the 20th would reject every zap sent on
     * the day somebody picked.
     */
    let closedAt: number | undefined;

    if (deadline) {
      const end = new Date(`${deadline}T23:59:59`);
      if (!Number.isNaN(end.getTime())) {
        closedAt = Math.floor(end.getTime() / 1000);
      }
    }

    try {
      await createGoal({
        description: description.trim(),
        // Sats in, millisats out — the tag's unit, not the reader's
        amountMsat: targetSats * 1000,
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        closedAt,
      });

      reset();
      onOpenChange(false);
    } catch {
      // `useCreateZapGoal` has already said what went wrong
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            New zap goal
          </DialogTitle>
          <DialogDescription>
            A target anyone can put sats toward by zapping it. The bar fills as
            zaps arrive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!payable && (
            <p className="rounded-lg border border-dashed bg-warning/10 p-3 text-xs text-muted-foreground">
              You have no lightning address on your profile, so nobody can zap
              this goal.{' '}
              <Link to="/wallet" className="font-medium underline">
                Set one up
              </Link>{' '}
              first, or the goal will publish and take nothing.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="goal-description">What is it for?</Label>
            <Textarea
              id="goal-description"
              value={description}
              onChange={(field) => setDescription(field.target.value)}
              placeholder="A new microphone, so the podcast stops sounding like a tunnel."
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This is what people read before deciding. Be specific — a reason
              raises more than a number.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-target">Target</Label>

            <div className="flex flex-wrap gap-2">
              {TARGET_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTarget(String(preset))}
                  className={cn(
                    'press rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors',
                    targetSats === preset
                      ? 'border-zap bg-zap/10 text-zap'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {preset.toLocaleString()}
                </button>
              ))}
            </div>

            <div className="relative">
              <Input
                id="goal-target"
                type="number"
                inputMode="numeric"
                min={1}
                value={target}
                onChange={(field) => setTarget(field.target.value)}
                placeholder="100000"
                className="pr-12 tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                sats
              </span>
            </div>

            {/*
              The fiat figure is the sanity check. A target typed with one zero
              too many is invisible in sats and obvious in pounds.
            */}
            {fiat && (
              <p className="text-xs text-muted-foreground">
                About {fiat} at today's price.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-summary">Short summary (optional)</Label>
            <Input
              id="goal-summary"
              value={summary}
              onChange={(field) => setSummary(field.target.value)}
              placeholder="New mic fund"
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label>Picture (optional)</Label>

            {image ? (
              <div className="space-y-2">
                <img
                  src={image}
                  alt=""
                  className="max-h-40 w-full rounded-lg border object-cover"
                />
                <Button variant="outline" size="sm" onClick={() => setImage('')}>
                  Remove
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-muted/50">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                {isUploading ? 'Uploading…' : 'Add a picture'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(field) => {
                    const file = field.target.files?.[0];
                    if (file) void handleUpload(file);
                  }}
                />
              </label>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-deadline">Deadline (optional)</Label>
            <Input
              id="goal-deadline"
              type="date"
              value={deadline}
              onChange={(field) => setDeadline(field.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Zaps that arrive after this stop counting. Leave it empty to keep
              the goal open.
            </p>
          </div>

          {/*
            Shown, not buried. These are where every zap toward this goal gets
            published and where anyone tallying it will look — a goal naming
            relays its author does not write to counts nothing, however many
            people zap it.
          */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Zap className="h-3.5 w-3.5 text-zap" />
              Zaps counted from
            </p>

            {writeUrls.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {writeUrls.map(relayDisplayName).join(', ')}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                You have no write relays configured, so this goal has nowhere
                to count zaps from.{' '}
                <Link to="/relays" className="font-medium underline">
                  Add one
                </Link>
                .
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={isPending || isUploading || !writeUrls.length}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
