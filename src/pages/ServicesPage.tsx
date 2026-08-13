import { Link } from 'react-router-dom';
import { BadgeCheck, Banknote, Sparkles, Wallet, Zap } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { ServiceCard } from '@/components/promo/ServiceCard';
import { useRouteSeo } from '@/hooks/useSeo';
import { SERVICES } from '@/lib/services';

/**
 * Everything NostrFeed runs, in one place.
 *
 * Listed as separate sites because that is how somebody meets them — a name to
 * be zapped at, a lightning wallet, a Cashu mint, a wallet with no feed around
 * it — and none of them needs this app to be useful. Some of them share an
 * LNbits instance, which is an implementation detail everywhere except in the
 * copy that says so: a domain stops being a detail when it is the thing being
 * bought.
 */
const ServicesPage = () => {
  useRouteSeo('/services');

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Sparkles}
          title="What NostrFeed runs"
          description="A name people can zap you at, a lightning wallet, a Cashu mint, and the wallet on a page of its own. Every one of them works with or without this app."
        />

        <div className="grid gap-5">
          {SERVICES.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm font-semibold">Which one do I want?</p>

            <Choice
              icon={BadgeCheck}
              title="A name of your own"
              body="getzap.me. It takes zaps from any client and puts a ✓ on your posts — the one thing here nobody gets by default."
              to="/wallet"
              label="Claim a name"
            />

            <Choice
              icon={Zap}
              title="Getting zapped"
              body="The lightning wallet. It gives you an address people can send to from any Nostr client, and it costs nothing to open."
              to="/wallet"
              label="Set up a lightning wallet"
            />

            <Choice
              icon={Banknote}
              title="Spending without being watched"
              body="The mint. Ecash is a bearer token: the mint signs it without being able to read it, so it cannot tell who spent what."
              to="/ecash"
              label="Hold ecash"
            />

            <Choice
              icon={Wallet}
              title="Just the wallet, nothing else"
              body="wallet.nostrfeed.com. The same balance and the same key, on a page with no feed around it."
            />

            {/* Said plainly rather than buried: the wallet and the mint both
                hold money for people, and neither should be trusted with more
                than someone can afford to lose */}
            <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              The lightning wallet and the mint both hold your balance for you.
              Treat either like cash in a pocket rather than savings — an
              operator who disappears takes the balance with them, and that is
              true of every custodian, this one included.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

function Choice({
  icon: Icon,
  title,
  body,
  to,
  label,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
  to?: string;
  label?: string;
}) {
  return (
    <div className="flex gap-4 rounded-lg p-3 transition-colors hover:bg-muted/50">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
        {to && label && (
          <Link
            to={to}
            className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
          >
            {label} →
          </Link>
        )}
      </div>
    </div>
  );
}

export default ServicesPage;
