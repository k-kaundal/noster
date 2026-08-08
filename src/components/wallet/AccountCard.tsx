import { useState } from 'react';
import { Check, KeyRound, Link2, Loader2, Mail, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsAccount } from '@/hooks/useLnbitsAccount';
import { cn } from '@/lib/utils';

/** LNbits' own minimum, enforced here so the failure is immediate. */
const MIN_PASSWORD = 8;

/**
 * The account behind the wallet: who it belongs to and how else to reach it.
 *
 * Collapsed by default. None of it is needed to use the wallet — it is what
 * you set up once, when you decide the balance is worth protecting.
 */
export function AccountCard() {
  const { user } = useCurrentUser();
  const { account, hasPassword, notificationEmail } = useLnbitsAccount();

  if (!account) return null;

  const linked = account.pubkey;
  const mismatched = !!linked && !!user && linked !== user.pubkey;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" />
          Account
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <Row label="Username" value={account.username || 'Not set'} />
          <Row
            label="Sign-in"
            value={hasPassword ? 'Nostr key or password' : 'Nostr key only'}
          />
          <Row
            label="Payment notices"
            value={notificationEmail || 'Not set'}
          />
        </div>

        {mismatched && (
          <MismatchNotice linked={linked!} current={user!.pubkey} />
        )}

        {!hasPassword && (
          <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Your Nostr key is the only way into this wallet. Add a password
              and you can still reach it from a device without your signer.
            </span>
          </p>
        )}

        <Accordion type="single" collapsible className="border-t">
          <AccordionItem value="profile" className="border-b-0">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Name and email
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ProfileForm />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="password" className="border-b-0">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                {hasPassword ? 'Change password' : 'Add a password'}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <PasswordForm />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

/**
 * When the wallet belongs to a different Nostr key than the one signed in.
 *
 * Happens after switching accounts. Relinking moves the wallet to the current
 * key, which is destructive in one direction — the old key loses it — so it
 * says so before the button rather than after.
 */
function MismatchNotice({
  linked,
  current,
}: {
  linked: string;
  current: string;
}) {
  const { linkPubkey, isLinking } = useLnbitsAccount();

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="text-sm">
        This wallet is linked to{' '}
        <span className="font-mono text-xs">{linked.slice(0, 12)}…</span>, not
        the key you're signed in with.
      </p>
      <p className="text-xs text-muted-foreground">
        Relinking moves it to the current key. The old key will no longer open
        this wallet.
      </p>
      <Button size="sm" disabled={isLinking} onClick={() => linkPubkey(current)}>
        {isLinking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        <Link2 className="mr-1.5 h-3.5 w-3.5" />
        Link to this key
      </Button>
    </div>
  );
}

function ProfileForm() {
  const { account, notificationEmail, updateProfile, isUpdating } =
    useLnbitsAccount();

  const [username, setUsername] = useState(account?.username ?? '');
  const [email, setEmail] = useState(notificationEmail);

  return (
    <form
      className="space-y-3 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void updateProfile({ username: username.trim(), email: email.trim() });
      }}
    >
      <Field
        id="account-username"
        label="Username"
        hint="Used to sign in with a password, if you set one."
        value={username}
        onChange={setUsername}
        placeholder="satoshi"
      />

      <Field
        id="account-email"
        label="Email for payment notices"
        hint="Where the wallet tells you money arrived. Not a login."
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
      />

      <Button type="submit" size="sm" disabled={isUpdating || !username.trim()}>
        {isUpdating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Save
      </Button>
    </form>
  );
}

function PasswordForm() {
  const { account, hasPassword, setPassword, isSettingPassword } =
    useLnbitsAccount();

  const [username, setUsername] = useState(account?.username ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  const tooShort = !!next && next.length < MIN_PASSWORD;
  const mismatched = !!repeat && next !== repeat;
  const ready =
    !!username.trim() &&
    next.length >= MIN_PASSWORD &&
    next === repeat &&
    (!hasPassword || !!current);

  return (
    <form
      className="space-y-3 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void setPassword({
          username: username.trim(),
          password: next,
          passwordRepeat: repeat,
          currentPassword: hasPassword ? current : undefined,
        }).then(() => {
          setCurrent('');
          setNext('');
          setRepeat('');
        });
      }}
    >
      <Field
        id="password-username"
        label="Username"
        hint="The name you'll sign in with."
        value={username}
        onChange={setUsername}
        placeholder="satoshi"
      />

      {hasPassword && (
        <Field
          id="password-current"
          label="Current password"
          type="password"
          value={current}
          onChange={setCurrent}
        />
      )}

      <Field
        id="password-new"
        label="New password"
        hint={`At least ${MIN_PASSWORD} characters.`}
        type="password"
        value={next}
        onChange={setNext}
        problem={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
      />

      <Field
        id="password-repeat"
        label="Repeat it"
        type="password"
        value={repeat}
        onChange={setRepeat}
        problem={mismatched ? "These don't match." : undefined}
      />

      {!mismatched && !tooShort && repeat && next === repeat && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          Ready to save
        </p>
      )}

      <Button type="submit" size="sm" disabled={!ready || isSettingPassword}>
        {isSettingPassword && (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        )}
        {hasPassword ? 'Change password' : 'Add password'}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  type = 'text',
  value,
  onChange,
  placeholder,
  problem,
}: {
  id: string;
  label: string;
  hint?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  problem?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={!!problem}
        autoComplete={type === 'password' ? 'new-password' : undefined}
      />
      {(problem || hint) && (
        <p className={cn('text-xs', problem ? 'text-destructive' : 'text-muted-foreground')}>
          {problem || hint}
        </p>
      )}
    </div>
  );
}
