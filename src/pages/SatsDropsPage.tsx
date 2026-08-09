import { Gift } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { SatsDropList, type SatsDrop } from '@/components/community/SatsDropList';
import { CreateSatsDropDialog } from '@/components/community/CreateSatsDropDialog';
import { useSeo } from '@/hooks/useSeo';

/**
 * Sats Drops Page: Browse and claim community distributions.
 *
 * LNURL-withdraw mechanism for:
 * - Welcome gifts to new members
 * - Milestone celebrations
 * - Tip distributions
 * - Giveaways
 */
export function SatsDropsPage() {
  useSeo({
    title: 'Sats Drops',
    description: 'Claim sats from community drops.',
    path: '/sats-drops',
  });

  // Mock sats drops data
  const mockDrops: SatsDrop[] = [
    {
      id: '1',
      title: 'Welcome to Nostr Developers! 🎉',
      description: 'Every new member gets a welcome gift',
      amountPerClaim: 5_000,
      totalBudget: 500_000,
      claimed: 87,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      status: 'active',
      creatorName: 'alice',
    },
    {
      id: '2',
      title: 'Milestone: 5K members! 🚀',
      description: 'Celebrating our community growth',
      amountPerClaim: 10_000,
      totalBudget: 1_000_000,
      claimed: 72,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'active',
      creatorName: 'bob',
    },
    {
      id: '3',
      title: 'Thank you for your contributions',
      description: 'Appreciation drop for community helpers',
      amountPerClaim: 2_000,
      totalBudget: 100_000,
      claimed: 50,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // expired
      status: 'expired',
      creatorName: 'carol',
    },
    {
      id: '4',
      title: 'Building Bitcoin into Nostr',
      amountPerClaim: 20_000,
      totalBudget: 500_000,
      claimed: 25,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      status: 'active',
      creatorName: 'dave',
    },
  ];

  const activeDrops = mockDrops.filter(d => d.status === 'active').length;
  const totalAvailable = mockDrops
    .filter(d => d.status === 'active')
    .reduce((sum, d) => sum + (d.totalBudget - d.amountPerClaim * d.claimed), 0);
  const totalClaimed = mockDrops.reduce((sum, d) => sum + d.amountPerClaim * d.claimed, 0);

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Gift}
            title="Sats Drops"
            description="Claim sats from community distributions. Each drop is a one-time gift."
          />
          <CreateSatsDropDialog />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard label="Active Drops" value={String(activeDrops)} />
          <StatCard
            label="Available"
            value={`${(totalAvailable / 1_000_000).toFixed(1)}M`}
            subtitle="sats to claim"
          />
          <StatCard
            label="All Time"
            value={`${(totalClaimed / 1_000_000).toFixed(1)}M`}
            subtitle="claimed"
          />
        </div>

        {/* Drops List */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            {activeDrops > 0 ? 'Active Drops' : 'No Active Drops'}
          </h2>
          <SatsDropList drops={mockDrops.filter(d => d.status === 'active')} />
        </div>

        {/* Expired Drops */}
        {mockDrops.filter(d => d.status === 'expired').length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">
              Expired Drops
            </h2>
            <SatsDropList drops={mockDrops.filter(d => d.status === 'expired')} />
          </div>
        )}

        {/* Info Card */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">How Sats Drops Work</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="font-bold text-foreground">1.</span>
                <span>
                  Community posts a sats drop (e.g., 5K sats per claim, 500K budget)
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">2.</span>
                <span>
                  Members visit the drop and click "Claim X sats"
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">3.</span>
                <span>
                  Their wallet receives LNURL-withdraw link (no payment needed)
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">4.</span>
                <span>
                  They confirm withdrawal and sats land in their wallet
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">5.</span>
                <span>
                  Drop expires when budget is exhausted or time runs out
                </span>
              </div>
            </div>
          </CardContent>
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
        <div>
          <p className="text-2xl font-bold">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default SatsDropsPage;
