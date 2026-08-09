/**
 * Hook for accessing relay health metrics and monitoring
 */

import { useEffect, useState } from 'react';
import { getRelayHealthMonitor, type RelayHealthMetrics, type RelayStatus } from '@/lib/relayHealth';

/**
 * Get health metrics for all relays
 */
export function useRelayHealthMetrics() {
  const monitor = getRelayHealthMonitor();
  const [metrics, setMetrics] = useState<RelayHealthMetrics[]>([]);

  useEffect(() => {
    // Update immediately
    setMetrics(monitor.getAllMetrics());

    // Update periodically as metrics change
    const interval = setInterval(() => {
      setMetrics(monitor.getAllMetrics());
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [monitor]);

  return metrics;
}

/**
 * Get health status for a specific relay
 */
export function useRelayStatusForUrl(url: string): RelayStatus {
  const monitor = getRelayHealthMonitor();
  const [status, setStatus] = useState<RelayStatus>('unknown');

  useEffect(() => {
    // Update immediately
    const metrics = monitor.getMetrics(url);
    setStatus(metrics?.status ?? 'unknown');

    // Update periodically
    const interval = setInterval(() => {
      const metrics = monitor.getMetrics(url);
      setStatus(metrics?.status ?? 'unknown');
    }, 5000);

    return () => clearInterval(interval);
  }, [monitor, url]);

  return status;
}

/**
 * Get sorted relays by health (best first)
 */
export function useHealthySortedRelays(urls: string[], limit?: number) {
  const monitor = getRelayHealthMonitor();
  const [sorted, setSorted] = useState<string[]>([]);

  useEffect(() => {
    if (limit) {
      setSorted(monitor.getRecommendedRelays(urls, limit));
    } else {
      setSorted(monitor.sortByHealth(urls));
    }

    // Update periodically as health changes
    const interval = setInterval(() => {
      if (limit) {
        setSorted(monitor.getRecommendedRelays(urls, limit));
      } else {
        setSorted(monitor.sortByHealth(urls));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [monitor, urls, limit]);

  return sorted;
}

/**
 * Record relay operation (success or failure)
 * Use this in query/publish functions to track relay health
 */
export function useRecordRelayOperation() {
  const monitor = getRelayHealthMonitor();

  return {
    recordSuccess: (url: string, responseTime: number = 0) => {
      monitor.recordSuccess(url, responseTime);
    },
    recordFailure: (url: string) => {
      monitor.recordFailure(url);
    },
  };
}
