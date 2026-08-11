import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMyExternalIdentities } from '@/hooks/useExternalIdentities';
import { useToast } from '@/hooks/useToast';
import {
  PLATFORMS,
  platformSpec,
  proofUrl,
  validateClaim,
  type IdentityClaim,
} from '@/lib/nip39';

/**
 * Adding and removing NIP-39 claims.
 *
 * The order matters and is the opposite of what a form usually does: the proof
 * text is shown *before* the fields, because it has to be posted on the other
 * platform first. Someone who fills this in and saves without posting anything
 * has published a claim that points at nothing, and the only sign of it is a
 * proof link that 404s for everybody except them.
 */
export function LinkedAccountsEditor() {
  const { user } = useCurrentUser();
  const { claims, isLoading, save, isSaving } = useMyExternalIdentities();
  const { toast } = useToast();

  const [platform, setPlatform] = useState(PLATFORMS[0].id);
  const [identity, setIdentity] = useState('');
  const [proof, setProof] = useState('');
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const npub = nip19.npubEncode(user.pubkey);
  const spec = platformSpec(platform) ?? PLATFORMS[0];
  const proofText = spec.proofText(npub);

  const draft: IdentityClaim = {
    platform,
    identity: identity.trim().toLowerCase(),
    proof: proof.trim(),
  };

  const problem =
    identity.trim() || proof.trim() ? validateClaim(draft) : null;

  const alreadyLinked = claims.some(
    (claim) =>
      claim.platform === draft.platform && claim.identity === draft.identity
  );

  const copyProofText = async () => {
    try {
      await navigator.clipboard.writeText(proofText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the text and copy it manually.',
        variant: 'destructive',
      });
    }
  };

  const add = async () => {
    if (problem || !draft.identity || !draft.proof || alreadyLinked) return;

    await save([...claims, draft]);
    setIdentity('');
    setProof('');
  };

  const remove = async (target: IdentityClaim) => {
    await save(
      claims.filter(
        (claim) =>
          !(
            claim.platform === target.platform &&
            claim.identity === target.identity
          )
      )
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked accounts</CardTitle>
        <p className="text-sm text-muted-foreground">
          Prove you control an account elsewhere by posting your key there and
          pointing at the post. Other clients show the link; whether anyone
          trusts it depends on the proof being real, so it has to exist before
          you save.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : claims.length > 0 ? (
          <ul className="space-y-2">
            {claims.map((claim) => {
              const url = proofUrl(claim);
              const label = platformSpec(claim.platform)?.label ?? claim.platform;

              return (
                <li
                  key={`${claim.platform}:${claim.identity}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {label} · {claim.identity}
                    </p>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-xs text-primary hover:underline"
                      >
                        Check the proof
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Proof: {claim.proof}
                      </p>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(claim)}
                    disabled={isSaving}
                    aria-label={`Remove ${label} ${claim.identity}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No accounts linked yet.
          </p>
        )}

        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-platform">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id="link-platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            First, because it has to happen first. The exact string matters —
            GitHub's is the one without quotes around the npub — so it is
            offered to copy rather than described.
          */}
          <div className="space-y-1.5">
            <Label>Step 1 — post this on {spec.label}</Label>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted p-2 text-xs">
                {proofText}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyProofText}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="link-identity">
                Step 2 — {spec.identityLabel}
              </Label>
              <Input
                id="link-identity"
                value={identity}
                onChange={(changed) => setIdentity(changed.target.value)}
                placeholder={spec.identityPlaceholder}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="link-proof">{spec.proofLabel}</Label>
              <Input
                id="link-proof"
                value={proof}
                onChange={(changed) => setProof(changed.target.value)}
                placeholder={spec.proofPlaceholder}
              />
            </div>
          </div>

          {problem && (
            <p className="text-xs text-destructive">{problem.message}</p>
          )}

          {alreadyLinked && !problem && (
            <p className="text-xs text-muted-foreground">
              That account is already linked.
            </p>
          )}

          <Button
            type="button"
            size="sm"
            onClick={add}
            disabled={
              isSaving ||
              !!problem ||
              alreadyLinked ||
              !draft.identity ||
              !draft.proof
            }
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            {isSaving ? 'Saving…' : 'Link account'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
