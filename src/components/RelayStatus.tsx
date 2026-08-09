/**
 * Relay status display component
 * Shows health and connection status for all configured relays
 */

import { useRelayHealthMetrics, useRelayStatusForUrl } from '@/hooks/useRelayStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RelayStatus } from '@/lib/relayHealth';

interface RelayStatusProps {
  compact?: boolean;
  urls?: string[];
}

/**
 * Display relay status for debugging and monitoring
 */
export function RelayStatus({ compact = false, urls }: RelayStatusProps) {
  const metrics = useRelayHealthMetrics();

  // Filter to specific URLs if provided, otherwise show all
  const displayMetrics = urls
    ? metrics.filter(m => urls.includes(m.url))
    : metrics;

  if (displayMetrics.length === 0) {
    return null;
  }

  if (compact) {
    return <CompactRelayStatus metrics={displayMetrics} />;
  }

  return <DetailedRelayStatus metrics={displayMetrics} />;
}

/**
 * Compact view - just show status indicators
 */
function CompactRelayStatus({
  metrics
}: {
  metrics: ReturnType<typeof useRelayHealthMetrics>
}) {
  const healthyCount = metrics.filter(m => m.status === 'healthy').length;
  const degradedCount = metrics.filter(m => m.status === 'degraded').length;
  const deadCount = metrics.filter(m => m.status === 'dead').length;

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span className="font-medium">{healthyCount}</span>
      </div>
      {degradedCount > 0 && (
        <div className="flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
          <span className="font-medium">{degradedCount}</span>
        </div>
      )}
      {deadCount > 0 && (
        <div className="flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          <span className="font-medium">{deadCount}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Detailed view - show full metrics for each relay
 */
function DetailedRelayStatus({
  metrics
}: {
  metrics: ReturnType<typeof useRelayHealthMetrics>
}) {
  const sorted = [...metrics].sort((a, b) => {
    const statusOrder = { healthy: 0, degraded: 1, dead: 2, unknown: 3 };
    return statusOrder[a.status] - statusOrder[b.status];
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Relay Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map(metric => (
            <RelayStatusRow key={metric.url} metric={metric} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Individual relay status row
 */
function RelayStatusRow({ metric }: { metric: ReturnType<typeof useRelayHealthMetrics>[0] }) {
  const icon = getStatusIcon(metric.status);
  const label = getStatusLabel(metric.status);
  const color = getStatusColor(metric.status);

  return (
    <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/40">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{relayDisplayName(metric.url)}</p>
          <p className="text-xs text-muted-foreground">
            {metric.successfulRequests}/{metric.totalRequests} • {metric.avgResponseTime.toFixed(0)}ms
          </p>
        </div>
      </div>

      <Badge className={cn('shrink-0 text-xs font-medium', color)}>
        {label}
      </Badge>

      {metric.errorRate > 0 && (
        <div className="text-xs text-muted-foreground">
          {metric.errorRate.toFixed(0)}% errors
        </div>
      )}

      {metric.isCircuitOpen && (
        <div className="text-xs text-red-500 font-medium">
          ⏱️ Waiting
        </div>
      )}
    </div>
  );
}

// Helper functions

function getStatusIcon(status: RelayStatus) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case 'degraded':
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case 'dead':
      return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    default:
      return <HelpCircle className="h-4 w-4 text-gray-500 shrink-0" />;
  }
}

function getStatusLabel(status: RelayStatus): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'dead':
      return 'Down';
    default:
      return 'Unknown';
  }
}

function getStatusColor(status: RelayStatus): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'degraded':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case 'dead':
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
  }
}

function relayDisplayName(url: string): string {
  return url.replace(/^wss?:\/\//i, '').replace(/\/$/, '');
}
