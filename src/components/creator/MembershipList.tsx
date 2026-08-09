import { Zap, Users, Calendar, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface Membership {
  id: string;
  name: string;
  description: string;
  price: number; // sats per interval
  interval: 'day' | 'week' | 'month' | 'year';
  subscribers: number;
  isActive: boolean;
  benefits: string[];
  creatorName: string;
}

export function MembershipList({ memberships }: { memberships: Membership[] }) {
  if (memberships.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No memberships yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {memberships.map((membership) => (
        <MembershipCard key={membership.id} membership={membership} />
      ))}
    </div>
  );
}

function MembershipCard({ membership }: { membership: Membership }) {
  const intervalLabel = {
    day: '/day',
    week: '/week',
    month: '/month',
    year: '/year',
  }[membership.interval];

  const monthlyEquivalent = calculateMonthlyEquivalent(membership.price, membership.interval);

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-lg">{membership.name}</h3>
              {membership.isActive && (
                <Badge variant="outline" className="bg-success/20 text-success shrink-0">
                  ✓ Active
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-1">
              {membership.description}
            </p>
          </div>
        </div>

        {/* Price & Subscribers Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 pb-4 border-b">
          {/* Price */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Price</p>
            <div className="flex items-baseline gap-1">
              <Zap className="h-4 w-4 text-warning" />
              <span className="font-bold">{(membership.price / 1000).toFixed(0)}K</span>
              <span className="text-xs text-muted-foreground">{intervalLabel}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ≈ {(monthlyEquivalent / 1000).toFixed(0)}K/mo
            </p>
          </div>

          {/* Subscribers */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Subscribers</p>
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-bold">{membership.subscribers}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              +{(membership.subscribers * monthlyEquivalent / 1_000_000).toFixed(1)}M/mo
            </p>
          </div>

          {/* Interval */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Recurring</p>
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm capitalize">{membership.interval}</span>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Benefits</p>
          <ul className="space-y-1">
            {membership.benefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button className="flex-1" variant="default">
            Subscribe
          </Button>
          <Button className="flex-1" variant="outline">
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function calculateMonthlyEquivalent(price: number, interval: string): number {
  const daysPerMonth = 30;
  switch (interval) {
    case 'day':
      return price * daysPerMonth;
    case 'week':
      return (price * 7 * 365) / 12 / 7; // ~4.33 weeks per month
    case 'month':
      return price;
    case 'year':
      return price / 12;
    default:
      return price;
  }
}
