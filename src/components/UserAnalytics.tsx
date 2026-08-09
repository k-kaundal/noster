import {
  BarChart3,
  TrendingUp,
  MessageCircle,
  RepeatCw,
  Heart,
  FileText,
} from 'lucide-react';
import { useUserStats, calculateUserEngagementScore } from '@/hooks/useUserStats';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface UserAnalyticsProps {
  pubkey: string;
  className?: string;
}

/**
 * User analytics card showing engagement and activity statistics
 */
export function UserAnalytics({ pubkey, className }: UserAnalyticsProps) {
  const { data: stats, isLoading } = useUserStats(pubkey);

  if (!stats || isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const engagementScore = calculateUserEngagementScore(stats);

  const metrics = [
    {
      label: 'Posts',
      value: stats.totalNotes,
      icon: FileText,
      color: 'text-blue-500',
    },
    {
      label: 'Replies',
      value: stats.totalReplies,
      icon: MessageCircle,
      color: 'text-green-500',
    },
    {
      label: 'Likes',
      value: stats.totalLikes,
      icon: Heart,
      color: 'text-red-500',
    },
    {
      label: 'Reposts',
      value: stats.totalReposts,
      icon: RepeatCw,
      color: 'text-purple-500',
    },
    {
      label: 'Articles',
      value: stats.articlesPublished,
      icon: FileText,
      color: 'text-orange-500',
    },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </span>
          <div className="flex items-center gap-2 text-sm font-normal">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            {engagementScore}/day
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {metrics.map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="rounded-lg border border-muted bg-muted/30 p-3 text-center"
            >
              <Icon className={cn('h-5 w-5 mx-auto mb-1', color)} />
              <p className="text-2xl font-bold tabular">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {/* Account Age */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Account Age</span>
            <span className="font-semibold">
              {stats.accountAge} day{stats.accountAge !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Activity Breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Activity Breakdown
          </p>
          <div className="space-y-1.5">
            {[
              {
                name: 'Posts',
                value: stats.totalNotes,
                total: stats.totalNotes + stats.totalReplies + stats.articlesPublished,
                color: 'bg-blue-500',
              },
              {
                name: 'Replies',
                value: stats.totalReplies,
                total: stats.totalNotes + stats.totalReplies + stats.articlesPublished,
                color: 'bg-green-500',
              },
              {
                name: 'Articles',
                value: stats.articlesPublished,
                total: stats.totalNotes + stats.totalReplies + stats.articlesPublished,
                color: 'bg-orange-500',
              },
            ].map(({ name, value, total, color }) => {
              const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-medium">{percentage}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full transition-all', color)}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
