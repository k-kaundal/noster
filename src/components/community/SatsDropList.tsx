import { Gift, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface SatsDrop {
  id: string;
  title: string;
  description?: string;
  amountPerClaim: number; // sats
  totalBudget: number; // sats
  claimed: number; // how many claimed so far
  expiresAt: Date;
  status: 'active' | 'expired' | 'exhausted';
  creatorName: string;
}

export function SatsDropList({ drops }: { drops: SatsDrop[] }) {
  if (drops.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Gift className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No sats drops yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {drops.map((drop) => (
        <SatsDropCard key={drop.id} drop={drop} />
      ))}
    </div>
  );
}

function SatsDropCard({ drop }: { drop: SatsDrop }) {
  const daysRemaining = Math.ceil((drop.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const claimsRemaining = Math.floor((drop.totalBudget - drop.amountPerClaim * drop.claimed) / drop.amountPerClaim);
  const percentClaimed = Math.round((drop.claimed * drop.amountPerClaim / drop.totalBudget) * 100);

  const statusConfig = {
    active: {
      label: 'Active',
      color: 'bg-success/20 text-success',
      icon: '🟢',
    },
    expired: {
      label: 'Expired',
      color: 'bg-destructive/20 text-destructive',
      icon: '🔴',
    },
    exhausted: {
      label: 'Exhausted',
      color: 'bg-warning/20 text-warning',
      icon: '⚠️',
    },
  };

  const config = statusConfig[drop.status];

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🎁</span>
              <h3 className="font-semibold text-lg leading-tight">{drop.title}</h3>
            </div>
            {drop.description && (
              <p className="text-sm text-muted-foreground line-clamp-1">
                {drop.description}
              </p>
            )}
          </div>
          <Badge variant="outline" className={`${config.color} shrink-0`}>
            {config.icon} {config.label}
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="mb-3 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{percentClaimed}% claimed</span>
            <span>{claimsRemaining} claims left</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-success transition-all"
              style={{ width: `${percentClaimed}%` }}
            />
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 pb-4 border-b">
          {/* Amount per claim */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Per Claim</p>
            <div className="flex items-baseline gap-0.5">
              <span className="font-bold text-lg">{(drop.amountPerClaim / 1000).toFixed(0)}</span>
              <span className="text-xs text-muted-foreground">K sats</span>
            </div>
          </div>

          {/* Total Budget */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Budget</p>
            <div className="flex items-baseline gap-0.5">
              <span className="font-bold text-lg">{(drop.totalBudget / 1_000_000).toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">M sats</span>
            </div>
          </div>

          {/* Time Remaining */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Expires</p>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className={`font-medium text-sm ${daysRemaining <= 3 ? 'text-destructive' : ''}`}>
                {daysRemaining > 0 ? `${daysRemaining}d` : 'Expired'}
              </span>
            </div>
          </div>
        </div>

        {/* Status Message & Action */}
        {drop.status === 'active' ? (
          <Button className="w-full" size="sm">
            <Gift className="mr-2 h-4 w-4" />
            Claim {(drop.amountPerClaim / 1000).toFixed(0)}K sats
          </Button>
        ) : drop.status === 'exhausted' ? (
          <div className="flex items-center justify-center gap-2 text-sm text-warning py-2 bg-warning/10 rounded">
            <AlertCircle className="h-4 w-4" />
            <span>Budget exhausted</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-destructive py-2 bg-destructive/10 rounded">
            <AlertCircle className="h-4 w-4" />
            <span>Drop expired</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-3">
          Posted by <span className="font-medium">@{drop.creatorName}</span>
        </p>
      </CardContent>
    </Card>
  );
}
