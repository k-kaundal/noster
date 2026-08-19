import { Gift } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { NotBuiltYet } from '@/components/NotBuiltYet';
import { useSeo } from '@/hooks/useSeo';

/**
 * Sats drops: a pot of sats anyone in a group can claim a share of.
 *
 * The worst of the invented pages, and the reason the rest were checked. It
 * offered live-looking drops — "5,000 sats each, 87 already claimed, expires
 * in 30 days" — none of which existed, on a Lightning site, with a claim
 * button. See `NotBuiltYet`.
 */
export function SatsDropsPage() {
  useSeo({
    title: 'Sats Drops',
    description: 'Claim sats from community drops.',
    path: '/sats-drops',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Gift}
          title="Sats Drops"
          description="A pot of sats your community can claim a share of."
        />

        <NotBuiltYet
          what="Drops will let you fund a pot once and let each person in a group withdraw a share of it, over LNURL-withdraw."
          plan="It needs one withdraw link per claimant rather than a shared one — a single link is a race, and the first person to find it takes the pot."
        />
      </div>
    </Layout>
  );
}

export default SatsDropsPage;
