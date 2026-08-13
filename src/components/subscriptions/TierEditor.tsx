import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  usePublishTier,
  useRetireTier,
  useSubscribers,
  useTiers,
} from '@/hooks/useSubscriptions';
import { slugify } from '@/lib/article';
import { describeCadence, type Cadence, type Tier } from '@/lib/subscription';

/**
 * Offering recurring support, for the person being supported.
 *
 * A tier is an addressable event, so publishing one with an identifier that
 * already exists replaces it rather than adding a second — which is how a
 * price is changed, and why the identifier is derived from the title once and
 * then left alone.
 */
export function TierEditor() {
  const { user } = useCurrentUser();
  const { tiers } = useTiers(user?.pubkey);

  const [adding, setAdding] = useState(false);

  if (!user) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Subscription tiers</h2>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            New tier
          </Button>
        )}
      </div>

      {adding && <TierForm onDone={() => setAdding(false)} />}

      {tiers.length > 0 ? (
        <div className="space-y-2">
          {tiers.map((tier) => (
            <ExistingTier key={tier.slug} tier={tier} />
          ))}
        </div>
      ) : (
        !adding && (
          <p className="text-sm text-muted-foreground">
            No tiers yet. A tier is what somebody pays for, once a period —
            name it, price it, and say what it includes.
          </p>
        )
      )}
    </section>
  );
}

function ExistingTier({ tier }: { tier: Tier }) {
  const { active, subscribers } = useSubscribers(tier);
  const { mutateAsync: retire, isPending } = useRetireTier();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <TierForm tier={tier} onDone={() => setEditing(false)} />;
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{tier.title}</p>
          <p className="text-xs text-muted-foreground">
            {tier.amount.toLocaleString()} sats / {describeCadence(tier.cadence)}
            {' · '}
            {/* Counted from receipts, so it is what people actually paid
                rather than what a database was told */}
            {active.length} active
            {subscribers.length > active.length &&
              ` · ${subscribers.length - active.length} lapsed`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={isPending}
            onClick={() => void retire(tier).catch(() => {})}
            aria-label={`Withdraw ${tier.title}`}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TierForm({ tier, onDone }: { tier?: Tier; onDone: () => void }) {
  const { mutateAsync: publish, isPending } = usePublishTier();

  const [title, setTitle] = useState(tier?.title ?? '');
  const [amount, setAmount] = useState(String(tier?.amount ?? 5000));
  const [cadence, setCadence] = useState<Cadence>(tier?.cadence ?? 'monthly');
  const [description, setDescription] = useState(tier?.description ?? '');
  const [perks, setPerks] = useState((tier?.perks ?? []).join('\n'));

  const sats = Number(amount);
  const valid = !!title.trim() && Number.isInteger(sats) && sats > 0;

  const submit = async () => {
    if (!valid) return;

    await publish({
      // An existing tier keeps its identifier, or editing it would publish a
      // second tier rather than replacing the first
      slug: tier?.slug ?? slugify(title) ?? String(Date.now()),
      title: title.trim(),
      amount: sats,
      cadence,
      description: description.trim(),
      perks: perks.split('\n'),
    }).catch(() => {});

    onDone();
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tier-title">Name</Label>
            <Input
              id="tier-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Gold"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tier-amount">Sats per period</Label>
            <div className="flex gap-2">
              <Input
                id="tier-amount"
                value={amount}
                onChange={(event) =>
                  setAmount(event.target.value.replace(/[^\d]/g, ''))
                }
                inputMode="numeric"
                className="tabular"
              />
              <Select
                value={cadence}
                onValueChange={(value) => setCadence(value as Cadence)}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">weekly</SelectItem>
                  <SelectItem value="monthly">monthly</SelectItem>
                  <SelectItem value="yearly">yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tier-description">What it is</Label>
          <Textarea
            id="tier-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Everything, a week early."
            className="min-h-[70px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tier-perks">What it includes, one per line</Label>
          <Textarea
            id="tier-perks"
            value={perks}
            onChange={(event) => setPerks(event.target.value)}
            placeholder={'Early access\nDirect messages'}
            className="min-h-[70px]"
          />
        </div>

        {/* Said to the creator too: a tier they describe as automatic is a
            promise this cannot keep on their behalf */}
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Supporters pay one period at a time. Nothing charges them
          automatically — no wallet on Nostr takes a standing order — so
          describe this as support somebody chooses to repeat, not as a
          recurring charge.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tier ? 'Save tier' : 'Publish tier'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
