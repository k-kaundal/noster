import { Users } from 'lucide-react';
import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MembershipList, type Membership } from '@/components/creator/MembershipList';
import { CreateMembershipDialog } from '@/components/creator/CreateMembershipDialog';
import { useSeo } from '@/hooks/useSeo';

/**
 * Memberships Page: Browse and manage recurring membership tiers.
 *
 * Displays:
 * - All active memberships
 * - Subscriber counts and recurring revenue
 * - Create membership button
 */
export function MembershipsPage() {
  useSeo({
    title: 'Memberships',
    description: 'Recurring memberships: sustainable creator revenue.',
    path: '/memberships',
  });

  const [filterStatus] = useState<'active' | 'inactive'>('active');

  // Mock memberships data
  const mockMemberships: Membership[] = [
    {
      id: '1',
      name: 'Supporter',
      description: 'Help support my work',
      price: 5_000,
      interval: 'month',
      subscribers: 24,
      isActive: true,
      benefits: [
        'Access to supporter feed',
        'Early access to articles',
        'Monthly AMA session',
      ],
      creatorName: 'kk',
    },
    {
      id: '2',
      name: 'Premium Builder',
      description: 'Deep dive into my work and process',
      price: 20_000,
      interval: 'month',
      subscribers: 8,
      isActive: true,
      benefits: [
        'All Supporter benefits',
        'Weekly office hours',
        'Direct Nostr DM access',
        'Feature request priority',
        'Source code access',
      ],
      creatorName: 'kk',
    },
    {
      id: '3',
      name: 'Annual Founder',
      description: 'Year-long commitment for maximum value',
      price: 200_000,
      interval: 'year',
      subscribers: 2,
      isActive: true,
      benefits: [
        'All Premium benefits',
        'Custom project sponsorship',
        'Logo placement',
        'Lifetime access to archives',
      ],
      creatorName: 'kk',
    },
  ];

  const totalMonthlyRecurring = mockMemberships.reduce((sum, m) => {
    const monthlyEquivalent = calculateMonthlyEquivalent(m.price, m.interval);
    return sum + monthlyEquivalent * m.subscribers;
  }, 0);

  const totalSubscribers = mockMemberships.reduce((sum, m) => sum + m.subscribers, 0);

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Users}
            title="Memberships"
            description="Recurring revenue from your community."
          />
          <CreateMembershipDialog />
        </div>

        {/* Revenue Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Total Subscribers"
            value={String(totalSubscribers)}
            subtitle={`+${totalSubscribers * 2} this month`}
          />
          <StatCard
            label="Monthly Recurring"
            value={`${(totalMonthlyRecurring / 1_000_000).toFixed(1)}M`}
            subtitle="sats/month"
          />
          <StatCard
            label="Active Tiers"
            value={String(mockMemberships.filter(m => m.isActive).length)}
            subtitle="membership tiers"
          />
        </div>

        {/* Memberships List */}
        <Card>
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="active" className="rounded-none border-b-2 border-transparent px-4 py-3">
                ✓ Active
              </TabsTrigger>
              <TabsTrigger value="inactive" className="rounded-none border-b-2 border-transparent px-4 py-3">
                ○ Inactive
              </TabsTrigger>
            </TabsList>

            <TabsContent value={filterStatus} className="space-y-4 p-6">
              <MembershipList
                memberships={mockMemberships.filter(m =>
                  filterStatus === 'active' ? m.isActive : !m.isActive
                )}
              />
            </TabsContent>
          </Tabs>
        </Card>

        {/* How it Works */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">How Memberships Work</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="font-bold text-foreground">1.</span>
                <span>
                  You create tiers with different benefits and prices
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">2.</span>
                <span>
                  Subscribers sign up and get charged automatically every interval
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">3.</span>
                <span>
                  Revenue lands in your wallet automatically
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">4.</span>
                <span>
                  Subscribers can cancel anytime, or you can pause a tier
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

function calculateMonthlyEquivalent(price: number, interval: string): number {
  switch (interval) {
    case 'day':
      return price * 30;
    case 'week':
      return (price * 365) / 52 / 12;
    case 'month':
      return price;
    case 'year':
      return price / 12;
    default:
      return price;
  }
}

export default MembershipsPage;
