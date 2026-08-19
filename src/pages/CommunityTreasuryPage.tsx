import { DollarSign } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { NotBuiltYet } from '@/components/NotBuiltYet';
import { useSeo } from '@/hooks/useSeo';

/**
 * Community treasury: a shared wallet with more than one person spending it.
 *
 * The balance shown here was a constant — "4.8M sats, up 16.2% this month" —
 * with a member list and transaction history to match, none of it connected to
 * a wallet. See `NotBuiltYet`.
 */
export function CommunityTreasuryPage() {
  useSeo({
    title: 'Community Treasury',
    description: 'Manage your community treasury, members, and shared wallet.',
    path: '/community-treasury',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={DollarSign}
          title="Community Treasury"
          description="A shared wallet, with rules about who can spend it."
        />

        <NotBuiltYet
          what="A treasury will hold sats for a group, show where they came from and went, and let more than one person spend them under rules the group sets."
          plan="The hard part is not the balance — it is that a shared wallet needs approval before a payment leaves, and nothing here can enforce that yet."
        />
      </div>
    </Layout>
  );
}

export default CommunityTreasuryPage;
