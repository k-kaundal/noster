import { DollarSign } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { CommunityTreasury } from '@/components/community/CommunityTreasury';
import { useSeo } from '@/hooks/useSeo';

/**
 * Community Treasury Page: Manage shared community wallet.
 *
 * Displays:
 * - Treasury balance and monthly metrics
 * - Member list with role-based permissions
 * - Transaction history
 * - Income/expense breakdown
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
          description="Shared wallet for your community. Track income, manage members, and fund initiatives."
        />

        <CommunityTreasury />
      </div>
    </Layout>
  );
}

export default CommunityTreasuryPage;
