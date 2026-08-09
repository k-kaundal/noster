/**
 * Relay health monitoring and management
 * Tracks relay performance, failures, and connection health
 */

export type RelayStatus = 'healthy' | 'degraded' | 'dead' | 'unknown';

export interface RelayHealthMetrics {
  url: string;
  status: RelayStatus;
  lastSuccess: number;           // Timestamp of last successful operation
  lastFailure: number;           // Timestamp of last failure
  consecutiveFailures: number;   // Failures in current streak
  totalRequests: number;         // Total requests sent to this relay
  successfulRequests: number;    // Successful requests
  errorRate: number;             // Percentage (0-100)
  avgResponseTime: number;       // Average response time in ms
  isCircuitOpen: boolean;        // Circuit breaker state
  circuitOpenUntil: number;      // When circuit will attempt recovery
}

export class RelayHealthMonitor {
  private metrics: Map<string, RelayHealthMetrics> = new Map();
  private readonly circuitBreakerThreshold = 3;    // Failures before opening circuit
  private readonly circuitBreakerTimeout = 30000;   // 30 seconds
  private readonly healthCheckInterval = 60000;     // Check health every 60 seconds

  constructor() {
    this.startHealthChecks();
  }

  /**
   * Record a successful operation for a relay
   */
  recordSuccess(url: string, responseTime: number = 0) {
    const metrics = this.getOrCreateMetrics(url);

    metrics.lastSuccess = Date.now();
    metrics.consecutiveFailures = 0;
    metrics.totalRequests++;
    metrics.successfulRequests++;

    // Update average response time with exponential moving average
    if (metrics.avgResponseTime === 0) {
      metrics.avgResponseTime = responseTime;
    } else {
      metrics.avgResponseTime = metrics.avgResponseTime * 0.7 + responseTime * 0.3;
    }

    // Close circuit on success
    metrics.isCircuitOpen = false;
    metrics.circuitOpenUntil = 0;

    this.updateStatus(url);
  }

  /**
   * Record a failed operation for a relay
   */
  recordFailure(url: string) {
    const metrics = this.getOrCreateMetrics(url);

    metrics.lastFailure = Date.now();
    metrics.consecutiveFailures++;
    metrics.totalRequests++;

    // Open circuit breaker if too many consecutive failures
    if (metrics.consecutiveFailures >= this.circuitBreakerThreshold) {
      metrics.isCircuitOpen = true;
      metrics.circuitOpenUntil = Date.now() + this.circuitBreakerTimeout;
    }

    this.updateStatus(url);
  }

  /**
   * Check if a relay can be queried right now
   */
  canQuery(url: string): boolean {
    const metrics = this.getOrCreateMetrics(url);

    // If circuit is open, check if recovery time has passed
    if (metrics.isCircuitOpen) {
      if (Date.now() > metrics.circuitOpenUntil) {
        // Try one request (half-open state)
        metrics.isCircuitOpen = false;
      } else {
        // Still in failure window
        return false;
      }
    }

    return true;
  }

  /**
   * Get all relay metrics
   */
  getAllMetrics(): RelayHealthMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics for a specific relay
   */
  getMetrics(url: string): RelayHealthMetrics | undefined {
    return this.metrics.get(url);
  }

  /**
   * Sort relays by health (best first)
   */
  sortByHealth(urls: string[]): string[] {
    const statusOrder = { healthy: 0, degraded: 1, dead: 2, unknown: 3 };

    return [...urls].sort((a, b) => {
      const metricsA = this.getMetrics(a);
      const metricsB = this.getMetrics(b);

      if (!metricsA) return 1;
      if (!metricsB) return -1;

      // Sort by status first
      const statusDiff = statusOrder[metricsA.status] - statusOrder[metricsB.status];
      if (statusDiff !== 0) return statusDiff;

      // Then by last success time (more recent is better)
      return metricsB.lastSuccess - metricsA.lastSuccess;
    });
  }

  /**
   * Get relay recommendation for querying
   * Returns sorted list of relays, best first
   */
  getRecommendedRelays(urls: string[], limit: number = 8): string[] {
    return this.sortByHealth(urls)
      .filter(url => this.canQuery(url))
      .slice(0, limit);
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
  }

  /**
   * Export metrics for debugging
   */
  export(): Record<string, RelayHealthMetrics> {
    const result: Record<string, RelayHealthMetrics> = {};
    this.metrics.forEach((metrics, url) => {
      result[url] = { ...metrics };
    });
    return result;
  }

  /**
   * Import metrics (for restoring state)
   */
  import(data: Record<string, RelayHealthMetrics>) {
    this.metrics.clear();
    Object.entries(data).forEach(([url, metrics]) => {
      this.metrics.set(url, { ...metrics });
    });
  }

  // Private methods

  private getOrCreateMetrics(url: string): RelayHealthMetrics {
    if (!this.metrics.has(url)) {
      this.metrics.set(url, {
        url,
        status: 'unknown',
        lastSuccess: 0,
        lastFailure: 0,
        consecutiveFailures: 0,
        totalRequests: 0,
        successfulRequests: 0,
        errorRate: 0,
        avgResponseTime: 0,
        isCircuitOpen: false,
        circuitOpenUntil: 0,
      });
    }
    return this.metrics.get(url)!;
  }

  private updateStatus(url: string) {
    const metrics = this.getOrCreateMetrics(url);

    if (metrics.totalRequests === 0) {
      metrics.status = 'unknown';
      return;
    }

    metrics.errorRate = (1 - metrics.successfulRequests / metrics.totalRequests) * 100;

    const timeSinceSuccess = Date.now() - metrics.lastSuccess;

    // Dead if no successful requests recently or error rate is very high
    if (metrics.errorRate > 50% || timeSinceSuccess > 120000) {
      metrics.status = 'dead';
    }
    // Degraded if error rate is moderate or some consecutive failures
    else if (metrics.errorRate > 20% || metrics.consecutiveFailures > 0) {
      metrics.status = 'degraded';
    }
    // Healthy otherwise
    else {
      metrics.status = 'healthy';
    }
  }

  private startHealthChecks() {
    setInterval(() => {
      // Periodic health status updates
      // This could trigger health checks (NIP-11) for dead relays
      this.metrics.forEach((metrics) => {
        if (metrics.status === 'dead' && Date.now() - metrics.lastFailure > 60000) {
          // Reset status after 1 minute to retry dead relays
          metrics.status = 'unknown';
        }
      });
    }, this.healthCheckInterval);
  }
}

// Global singleton instance
let globalMonitor: RelayHealthMonitor | null = null;

/**
 * Get or create the global relay health monitor
 */
export function getRelayHealthMonitor(): RelayHealthMonitor {
  if (!globalMonitor) {
    globalMonitor = new RelayHealthMonitor();
  }
  return globalMonitor;
}

/**
 * Reset the global monitor (useful for testing)
 */
export function resetRelayHealthMonitor() {
  if (globalMonitor) {
    globalMonitor.reset();
  }
}
