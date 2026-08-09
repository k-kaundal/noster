import { useState } from 'react';
import { DollarSign, Plus, TrendingUp, TrendingDown, Users, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Community Treasury: Shared wallet for communities with role-based permissions.
 *
 * Displays:
 * - Current balance and monthly income/expenses
 * - Member list with role-based permissions (admin, treasurer, moderator, member)
 * - Recent transactions
 * - Governance integration
 */
export function CommunityTreasury() {
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddMember, setShowAddMember] = useState(false);

  // Mock data — will be replaced with real API calls
  const treasuryData = {
    balance: 4_820_000,
    monthlyIncome: 820_000,
    monthlyExpense: 240_000,
    growth: 16.2,
  };

  return (
    <div className="space-y-6">
      {/* Treasury Balance Header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/8 to-transparent px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Treasury Balance
          </p>

          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-5xl font-bold tabular">
              {(treasuryData.balance / 1_000_000).toFixed(1)}M
            </span>
            <span className="text-lg text-muted-foreground">sats</span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Monthly Income</p>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-success" />
                <span className="font-semibold text-success">
                  +{(treasuryData.monthlyIncome / 1000).toFixed(0)}K sats
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Monthly Expenses</p>
              <div className="flex items-center gap-1">
                <TrendingDown className="h-4 w-4 text-destructive" />
                <span className="font-semibold text-destructive">
                  -{(treasuryData.monthlyExpense / 1000).toFixed(0)}K sats
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Growth</p>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="font-semibold text-primary">
                  +{treasuryData.growth}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Treasury Tabs */}
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
            <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <DollarSign className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="members" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <Users className="mr-2 h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="transactions" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <Clock className="mr-2 h-4 w-4" />
              Transactions
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">MONTHLY BREAKDOWN</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Member dues (15 × 1K/mo)</span>
                    <span className="font-semibold text-success">+15K</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Bounty solutions</span>
                    <span className="font-semibold text-success">+50K</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Event tickets</span>
                    <span className="font-semibold text-success">+25K</span>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Income</span>
                    <span className="text-success">+90K</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-2">MONTHLY SPENDING</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Server hosting</span>
                    <span className="font-semibold text-destructive">-80K</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Moderator stipends</span>
                    <span className="font-semibold text-destructive">-20K</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Marketing</span>
                    <span className="font-semibold text-destructive">-10K</span>
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Expenses</span>
                    <span className="text-destructive">-110K</span>
                  </div>
                </div>
              </div>
            </div>

            <Button variant="outline" className="w-full">
              📊 View detailed analytics
            </Button>
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members" className="space-y-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Treasury permissions by role
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowAddMember(!showAddMember)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            </div>

            {showAddMember && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div>
                  <Label htmlFor="member-npub" className="text-xs font-semibold">
                    Public Key (npub)
                  </Label>
                  <Input
                    id="member-npub"
                    placeholder="npub1..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="member-role" className="text-xs font-semibold">
                    Role
                  </Label>
                  <select id="member-role" className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm">
                    <option>Admin</option>
                    <option>Treasurer</option>
                    <option>Moderator</option>
                    <option>Member</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1">Add Member</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <TreasuryMemberItem
                name="KK"
                pubkey="npub1abc123..."
                role="admin"
                permissions={['View', 'Receive', 'Send', 'Vote']}
              />
              <TreasuryMemberItem
                name="Alice"
                pubkey="npub1def456..."
                role="treasurer"
                permissions={['View', 'Receive', 'Send']}
              />
              <TreasuryMemberItem
                name="Bob"
                pubkey="npub1ghi789..."
                role="moderator"
                permissions={['View', 'Receive']}
              />
              <TreasuryMemberItem
                name="Carol"
                pubkey="npub1jkl012..."
                role="member"
                permissions={['View (balance only)']}
              />
            </div>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground mb-4">
              Recent treasury activity (last 30 days)
            </p>

            <div className="space-y-2">
              <TransactionItem
                type="income"
                amount={100_000}
                description="Member dues (12 × $8.33/mo)"
                timestamp="2 hours ago"
              />
              <TransactionItem
                type="income"
                amount={50_000}
                description="Bounty: Build Rust CLI tool"
                timestamp="1 day ago"
              />
              <TransactionItem
                type="expense"
                amount={80_000}
                description="Server hosting (DigitalOcean)"
                timestamp="3 days ago"
              />
              <TransactionItem
                type="income"
                amount={25_000}
                description="Event tickets sold (25 × 1K)"
                timestamp="5 days ago"
              />
              <TransactionItem
                type="expense"
                amount={20_000}
                description="Moderator stipends"
                timestamp="7 days ago"
              />
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function TreasuryMemberItem({
  name,
  pubkey,
  role,
  permissions,
}: {
  name: string;
  pubkey: string;
  role: 'admin' | 'treasurer' | 'moderator' | 'member';
  permissions: string[];
}) {
  const roleColors = {
    admin: 'bg-primary/20 text-primary',
    treasurer: 'bg-success/20 text-success',
    moderator: 'bg-warning/20 text-warning',
    member: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium">{name}</p>
          <code className="text-xs text-muted-foreground font-mono">{pubkey}</code>
        </div>
        <span className={cn(
          'text-xs font-semibold px-2 py-1 rounded capitalize',
          roleColors[role]
        )}>
          {role}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {permissions.map((perm) => (
          <span key={perm} className="text-xs bg-background rounded px-2 py-0.5">
            {perm}
          </span>
        ))}
      </div>
    </div>
  );
}

function TransactionItem({
  type,
  amount,
  description,
  timestamp,
}: {
  type: 'income' | 'expense';
  amount: number;
  description: string;
  timestamp: string;
}) {
  const isIncome = type === 'income';

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <span className={cn(
        'text-lg mt-0.5',
        isIncome ? 'text-success' : 'text-destructive'
      )}>
        {isIncome ? '📥' : '📤'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{description}</p>
          <span className={cn(
            'font-semibold tabular whitespace-nowrap',
            isIncome ? 'text-success' : 'text-destructive'
          )}>
            {isIncome ? '+' : '-'}{(amount / 1000).toFixed(0)}K
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{timestamp}</p>
      </div>
    </div>
  );
}
