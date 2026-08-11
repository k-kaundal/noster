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
  const {
    account,
    hasPassword,
    notificationEmail,
    notificationTelegram,
    notificationNostr,
  } = useLnbitsAccount();

  // Named rather than counted: "2 channels" tells nobody whether the one they
  // care about is on
  const notificationSummary = [
    notificationEmail && 'Email',
    notificationTelegram && 'Telegram',
    notificationNostr && 'Nostr DM',
  ]
    .filter(Boolean)
    .join(', ');

  if (!account) return null;

  const linked = account.pubkey;
  const mismatched = !!linked && !!user && linked !== user.pubkey;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-slate-50 to-transparent dark:from-slate-950/40 pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <User className="h-4 w-4 text-primary" />
          </div>
          Account settings
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg bg-muted/40 p-4">
          <Row label="Username" value={account.username || 'Not set'} />
          <Row
            label="Sign-in"
            value={hasPassword ? 'Nostr key or password' : 'Nostr key only'}
          />
          <Row
            label="Notifications"
            value={notificationSummary || 'Not set'}
          />
        </div>

        {mismatched && (
          <MismatchNotice linked={linked!} current={user!.pubkey} />
        )}

        {!hasPassword && (
          <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/8 p-4 backdrop-blur-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium text-warning-strong mb-1">Secure with a password</p>
              <p className="text-xs text-muted-foreground">
                Right now only your Nostr key opens this wallet. Add a password to sign in from any device.
              </p>
            </div>
          </div>
        )}

        <Accordion type="single" collapsible className="border-t">
          <AccordionItem value="profile" className="border-b-0">
            <AccordionTrigger className="text-sm font-medium hover:text-primary transition-colors">
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Name and notifications
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <ProfileForm />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="password" className="border-b-0">
            <AccordionTrigger className="text-sm font-medium hover:text-primary transition-colors">
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                {hasPassword ? 'Change password' : 'Add a password'}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
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
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
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
    <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/8 p-4 backdrop-blur-sm">
      <div>
        <p className="text-sm font-medium text-warning-strong mb-1">
          This wallet is linked to a different key
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-xs">{linked.slice(0, 12)}…</span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Link it to your current key. The old key won't be able to open it anymore.
      </p>
      <Button
        size="sm"
        disabled={isLinking}
        onClick={() => linkPubkey(current)}
        className="w-full"
      >
        {isLinking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        <Link2 className="mr-1.5 h-3.5 w-3.5" />
        Link to this key
      </Button>
    </div>
  );
}

/**
 * Where the wallet tells you money arrived.
 *
 * Three channels, all of them the server's to deliver: an email, a Telegram
 * chat, or a Nostr DM to a NIP-05 identifier. Worth filling in because a
 * custodial balance that grows while nobody is looking is a zap nobody thanked
 * anyone for.
 */
function ProfileForm() {
  const {
    account,
    notificationEmail,
    notificationTelegram,
    notificationNostr,
    updateProfile,
    isUpdating,
  } = useLnbitsAccount();

  const [username, setUsername] = useState(account?.username ?? '');
  const [email, setEmail] = useState(notificationEmail);
  const [telegram, setTelegram] = useState(notificationTelegram);
  const [nostrIdentifier, setNostrIdentifier] = useState(notificationNostr);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void updateProfile({
          username: username.trim(),
          email: email.trim(),
          telegram: telegram.trim(),
          nostrIdentifier: nostrIdentifier.trim(),
        });
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
        hint="Get a message when money arrives. Not a login."
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
      />

      <Field
        id="account-telegram"
        label="Telegram chat ID"
        hint="Message @userinfobot to find yours."
        value={telegram}
        onChange={setTelegram}
        placeholder="123456789"
      />

      <Field
        id="account-nostr-notify"
        label="Nostr address for notices"
        hint="A NIP-05 identifier. The wallet DMs the notice here."
        value={nostrIdentifier}
        onChange={setNostrIdentifier}
        placeholder="you@nostrfeed.com"
      />

      <Button type="submit" size="lg" disabled={isUpdating || !username.trim()} className="w-full">
        {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save changes
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
      className="space-y-4"
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
        label="Repeat password"
        type="password"
        value={repeat}
        onChange={setRepeat}
        problem={mismatched ? "Passwords don't match." : undefined}
      />

      {!mismatched && !tooShort && repeat && next === repeat && (
        <p className="flex items-center gap-1.5 text-xs text-success-strong bg-success/10 p-2 rounded">
          <Check className="h-3.5 w-3.5" />
          Ready to save
        </p>
      )}

      <Button type="submit" size="lg" disabled={!ready || isSettingPassword} className="w-full">
        {isSettingPassword && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
        className="transition-all"
      />
      {(problem || hint) && (
        <p className={cn('text-xs', problem ? 'text-destructive flex items-center gap-1' : 'text-muted-foreground')}>
          {problem && <span>⚠</span>}
          {problem || hint}
        </p>
      )}
    </div>
  );
}
