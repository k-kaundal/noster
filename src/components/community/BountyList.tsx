import { Clock, Award, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface Bounty {
  id: string;
  title: string;
  description: string;
  reward: number; // in sats
  deadline: Date;
  status: 'open' | 'closed' | 'paid';
  submissions: number;
  winner?: {
    name: string;
    pubkey: string;
  };
  creator: {
    name: string;
    pubkey: string;
  };
}

export function BountyList({ bounties }: { bounties: Bounty[] }) {
  if (bounties.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No bounties yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {bounties.map((bounty) => (
        <BountyCard key={bounty.id} bounty={bounty} />
      ))}
    </div>
  );
}

function BountyCard({ bounty }: { bounty: Bounty }) {
  const daysRemaining = Math.ceil(
    (bounty.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  const statusConfig = {
    open: {
      label: 'Open',
      color: 'bg-success/20 text-success',
      icon: '🟢',
    },
    closed: {
      label: 'Closed',
      color: 'bg-warning/20 text-warning',
      icon: '🟡',
    },
    paid: {
      label: 'Paid',
      color: 'bg-primary/20 text-primary',
      icon: '✓',
    },
  };

  const config = statusConfig[bounty.status];

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg leading-tight mb-1">{bounty.title}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {bounty.description}
            </p>
          </div>
          <Badge variant="outline" className={cn(config.color, 'shrink-0')}>
            {config.icon} {config.label}
          </Badge>
        </div>

        {/* Bounty Details Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 pb-4 border-b">
          {/* Reward */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Reward</p>
            <div className="flex items-center gap-1">
              <Zap className="h-4 w-4 text-warning" />
              <span className="font-bold">{(bounty.reward / 1000).toFixed(0)}K</span>
              <span className="text-xs text-muted-foreground">sats</span>
            </div>
          </div>

          {/* Deadline */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Deadline</p>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className={cn(
                'font-medium text-sm',
                daysRemaining <= 3 ? 'text-destructive' : ''
              )}>
                {daysRemaining > 0 ? `${daysRemaining}d left` : 'Closed'}
              </span>
            </div>
          </div>

          {/* Submissions */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Submissions</p>
            <div className="flex items-center gap-1">
              <Award className="h-4 w-4 text-primary" />
              <span className="font-bold">{bounty.submissions}</span>
              <span className="text-xs text-muted-foreground">submitted</span>
            </div>
          </div>
        </div>

        {/* Creator & Winner Info */}
        <div className="space-y-2 mb-4">
          <div className="text-xs text-muted-foreground">
            Posted by <span className="font-medium text-foreground">@{bounty.creator.name}</span>
          </div>
          {bounty.winner && bounty.status === 'paid' && (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <span className="text-sm">
                <span className="font-medium text-success">Won by</span>{' '}
                <span className="font-medium">@{bounty.winner.name}</span>
              </span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <Button
          className="w-full"
          disabled={bounty.status !== 'open'}
          variant={bounty.status === 'open' ? 'default' : 'outline'}
        >
          {bounty.status === 'open' && 'Submit Solution'}
          {bounty.status === 'closed' && 'Submissions Closed'}
          {bounty.status === 'paid' && `✓ Paid to @${bounty.winner?.name}`}
        </Button>
      </CardContent>
    </Card>
  );
}
