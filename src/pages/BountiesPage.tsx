import { Award } from 'lucide-react';
import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BountyList, type Bounty } from '@/components/community/BountyList';
import { CreateBountyDialog } from '@/components/community/CreateBountyDialog';
import { useSeo } from '@/hooks/useSeo';

/**
 * Bounties Page: Browse and submit solutions for community bounties.
 *
 * Displays:
 * - All open bounties
 * - Bounties with active submissions
 * - Closed/paid bounties
 * - Create bounty button (for community admins)
 */
export function BountiesPage() {
  useSeo({
    title: 'Bounties',
    description: 'Community bounties: solve problems, earn sats.',
    path: '/bounties',
  });

  type FilterStatus = 'all' | 'open' | 'closed' | 'paid';
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Mock bounties data
  const mockBounties: Bounty[] = [
    {
      id: '1',
      title: 'Build Rust CLI tool for relay management',
      description: 'Create a CLI tool that can connect to Nostr relays, check status, and manage subscriptions',
      reward: 50_000,
      deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
      status: 'open',
      submissions: 3,
      creator: { name: 'kk', pubkey: 'npub1abc...' },
    },
    {
      id: '2',
      title: 'Write NIP-89 implementation guide',
      description: 'Comprehensive guide covering NIP-89 (Recommended Application Handlers)',
      reward: 25_000,
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
      status: 'open',
      submissions: 1,
      creator: { name: 'alice', pubkey: 'npub1def...' },
    },
    {
      id: '3',
      title: 'Design Nostr payment flow diagram',
      description: 'Create visual diagram explaining LNURL + NIP-57 payment flow',
      reward: 10_000,
      deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days
      status: 'closed',
      submissions: 8,
      creator: { name: 'bob', pubkey: 'npub1ghi...' },
    },
    {
      id: '4',
      title: 'Fix relay sync issues',
      description: 'Identify and fix race condition causing missed events',
      reward: 100_000,
      deadline: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // closed
      status: 'paid',
      submissions: 5,
      winner: { name: 'charlie', pubkey: 'npub1jkl...' },
      creator: { name: 'dave', pubkey: 'npub1mno...' },
    },
  ];

  const filteredBounties = mockBounties.filter(
    (b) => filterStatus === 'all' || b.status === filterStatus
  );

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Award}
            title="Bounties"
            description="Solve community problems and earn sats."
          />
          <CreateBountyDialog />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <StatCard label="Open" value={String(mockBounties.filter(b => b.status === 'open').length)} />
          <StatCard label="Total Reward" value={`${(mockBounties.reduce((sum, b) => sum + b.reward, 0) / 1_000_000).toFixed(1)}M`} subtitle="sats" />
          <StatCard label="Submissions" value={String(mockBounties.reduce((sum, b) => sum + b.submissions, 0))} />
          <StatCard label="Paid Out" value={`${mockBounties.filter(b => b.status === 'paid').length}`} />
        </div>

        {/* Filter Tabs */}
        <Card>
          <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="all" className="rounded-none border-b-2 border-transparent px-4 py-3">
                All
              </TabsTrigger>
              <TabsTrigger value="open" className="rounded-none border-b-2 border-transparent px-4 py-3">
                🟢 Open
              </TabsTrigger>
              <TabsTrigger value="closed" className="rounded-none border-b-2 border-transparent px-4 py-3">
                🟡 Closed
              </TabsTrigger>
              <TabsTrigger value="paid" className="rounded-none border-b-2 border-transparent px-4 py-3">
                ✓ Paid
              </TabsTrigger>
            </TabsList>

            <TabsContent value={filterStatus} className="space-y-4 p-6">
              <BountyList bounties={filteredBounties} />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </p>
        <p className="text-2xl font-bold">
          {value}
          {subtitle && <span className="text-xs text-muted-foreground ml-1">{subtitle}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

export default BountiesPage;
