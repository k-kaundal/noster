import { Award } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { NotBuiltYet } from '@/components/NotBuiltYet';
import { useSeo } from '@/hooks/useSeo';

/**
 * Bounties: fund a task, collect submissions, pay whoever solves it.
 *
 * The listings that used to fill this page were invented — four bounties with
 * sats rewards, submission counts and a named winner, none of which existed.
 * See `NotBuiltYet` for why that is worse than an empty page on a site that
 * moves money.
 */
export function BountiesPage() {
  useSeo({
    title: 'Bounties',
    description: 'Community bounties: solve problems, earn sats.',
    path: '/bounties',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Award}
          title="Bounties"
          description="Solve community problems and earn sats."
        />

        <NotBuiltYet
          what="Bounties will let you put sats behind a task, take submissions from anyone, and pay the person who solves it."
          plan="It needs an event kind for the offer and the submissions, and an escrow the payer cannot walk away from — neither exists yet, and a bounty board without them is just a list of promises."
        />
      </div>
    </Layout>
  );
}

export default BountiesPage;
