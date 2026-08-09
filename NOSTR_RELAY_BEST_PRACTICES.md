# Nostr Relay Connection Best Practices

This guide details best practices for stable and reliable Nostr relay connections to minimize disconnections, timeouts, and failed requests.

## 🎯 Core Principles

1. **Connection Pooling**: Use a connection pool to reuse relay connections
2. **Exponential Backoff**: Retry failed connections with increasing delays
3. **Health Monitoring**: Track relay health and prefer healthy relays
4. **Timeouts**: Set appropriate timeouts to prevent hanging requests
5. **Graceful Degradation**: Fall back to alternative relays on failure
6. **Circuit Breaker**: Temporarily skip failed relays to avoid hammering
7. **Load Distribution**: Spread requests across multiple relays
8. **Error Recovery**: Implement proper error handling and recovery

## 🔌 Connection Management

### NPool Configuration

The app uses `NPool` from @nostrify/nostrify for connection pooling:

```typescript
const pool = new NPool({
  // Custom relay opener
  open(url: string) {
    return new NRelay1(url, {
      // Reconnection options
      reconnectTimeout: 5000,    // Start with 5s
      maxReconnectTime: 60000,   // Cap at 60s
      // Timeout for individual requests
      requestTimeout: 3000,      // 3 second timeout
    });
  },
  
  // Smart request routing
  reqRouter(filters) {
    // Route to healthy read relays first
    return new Map(targets.map(url => [url, filters]));
  },
  
  // Write routing
  eventRouter(event) {
    // Route writes to configured write relays
    return writeRelays(config);
  },
});
```

### Read Relay Strategy

**Current Implementation:**
- Query up to 8 relays per request (`MAX_READ_RELAYS`)
- Primary relay queried first (`withPrimaryFirst`)
- Deduplication of responses across relays
- All read relays are tried simultaneously

**Best Practice:**
```typescript
// Prioritize: Primary → Healthy → Secondary
const targets = [
  primary,                    // Always include primary
  ...healthy.relays,          // Prefer healthy relays
  ...fallback.relays,         // Use fallback if primary fails
].slice(0, MAX_READ_RELAYS);
```

### Write Relay Strategy

**Current Implementation:**
- Write to all configured write relays
- No retry logic if writes fail

**Best Practice:**
```typescript
// Write to primary + at least 2 additional relays
// If any write succeeds, event is published
const targets = [
  primary,
  ...alternates.slice(0, 3),
].filter(isHealthy);

// Retry failed writes with exponential backoff
```

## ⏱️ Timeout Configuration

### Recommended Timeouts

| Operation | Timeout | Notes |
|-----------|---------|-------|
| Single query | 3-5s | Quick fail-over to next relay |
| Aggregate query | 8-10s | Allow multiple relays to respond |
| Subscription | 2s | Keep connections fresh |
| Event publish | 5-10s | Allow relay processing |
| Relay discovery | 2s | NIP-11 fetch timeout |

### Implementation

```typescript
// Query with timeout
const signal = AbortSignal.timeout(3000); // 3 second timeout
const events = await nostr.query(filters, { signal });
```

## 🔄 Reconnection Strategy

### Exponential Backoff

When a relay connection fails, reconnect with exponential backoff:

```typescript
// Retry delays: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
function getBackoffDelay(attempt: number): number {
  const baseDelay = 1000;
  const maxDelay = 30000;
  const exponentialDelay = Math.min(
    baseDelay * Math.pow(2, attempt),
    maxDelay
  );
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * exponentialDelay * 0.1;
  return exponentialDelay + jitter;
}
```

### Connection Retry Logic

```typescript
// Never retry more than 5 times in quick succession
// Reset counter after successful connection
if (attemptCount > 5 && timeSinceLastSuccess < 1000) {
  // Skip this relay for now (circuit breaker)
  markRelayDown(relay, 30000); // Skip for 30 seconds
  return;
}
```

## 🏥 Health Monitoring

### Relay Health Metrics

Track these metrics per relay:

```typescript
interface RelayHealth {
  url: string;
  lastSuccess: number;        // Timestamp of last successful op
  lastFailure: number;        // Timestamp of last failure
  consecutiveFailures: number; // Failures in a row
  avgResponseTime: number;    // Average response time (ms)
  errorRate: number;          // Percentage of failed requests
  status: 'healthy' | 'degraded' | 'dead';
}
```

### Health Calculation

```typescript
function getRelayHealth(relay: RelayHealth): 'healthy' | 'degraded' | 'dead' {
  const timeSinceSuccess = Date.now() - relay.lastSuccess;
  
  if (relay.errorRate > 50%) return 'dead';          // >50% failures
  if (timeSinceSuccess > 60000) return 'dead';       // No success in 60s
  if (relay.consecutiveFailures > 3) return 'degraded';
  if (relay.errorRate > 20%) return 'degraded';      // >20% failures
  
  return 'healthy';
}
```

### Relay Sorting

```typescript
// Sort by: health → last success time → response time
function sortRelaysByHealth(relays: RelayHealth[]): RelayHealth[] {
  const healthOrder = { healthy: 0, degraded: 1, dead: 2 };
  
  return relays.sort((a, b) => {
    // Primary sort: health
    if (healthOrder[a.status] !== healthOrder[b.status]) {
      return healthOrder[a.status] - healthOrder[b.status];
    }
    // Secondary sort: last success
    return b.lastSuccess - a.lastSuccess;
  });
}
```

## 🚫 Circuit Breaker Pattern

### Implementation

```typescript
interface CircuitBreakerState {
  relay: string;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  recoveryTime: number;
}

function canQueryRelay(breaker: CircuitBreakerState): boolean {
  if (breaker.state === 'closed') return true; // Normal operation
  
  if (breaker.state === 'open') {
    // Check if enough time has passed to recover
    const timeSinceFailure = Date.now() - breaker.lastFailure;
    if (timeSinceFailure > breaker.recoveryTime) {
      breaker.state = 'half-open'; // Try one request
      return true;
    }
    return false; // Still in failure window
  }
  
  // half-open: allow one request to test recovery
  return true;
}
```

## 📊 Error Handling

### Categorize Errors

```typescript
type ErrorType = 
  | 'timeout'           // Request timeout
  | 'connection-failed' // Can't connect
  | 'parse-error'       // Invalid response
  | 'not-found'         // 404 or relay not available
  | 'rate-limited'      // 429 or relay throttling
  | 'auth-required'     // NIP-42 auth required
  | 'unknown';          // Other errors

// Different handling per error type
function handleError(error: Error, type: ErrorType, relay: string) {
  switch (type) {
    case 'timeout':
      // Temporary issue, retry with backoff
      increaseFailureCount(relay);
      scheduleRetry(relay, getBackoffDelay(failureCount));
      break;
      
    case 'rate-limited':
      // Back off significantly
      pauseRelay(relay, 5 * 60 * 1000); // 5 minutes
      break;
      
    case 'auth-required':
      // Handle NIP-42 authentication
      setupAuth(relay);
      break;
  }
}
```

## 🎯 Request Optimization

### Batch Requests

Instead of multiple individual queries, combine them:

```typescript
// ❌ Bad: Multiple sequential queries
const posts = await nostr.query([{ kinds: [1], limit: 20 }]);
const profiles = await nostr.query([{ kinds: [0], limit: 20 }]);
const follows = await nostr.query([{ kinds: [3], limit: 20 }]);

// ✅ Good: Single batch query
const results = await nostr.query([
  { kinds: [1], limit: 20 },      // Posts
  { kinds: [0], limit: 20 },      // Profiles
  { kinds: [3], limit: 20 },      // Follows
]);
```

### Request Deduplication

```typescript
// Cache recent requests to avoid duplicate queries
const requestCache = new Map<string, { data: any; time: number }>();
const CACHE_TTL = 2000; // 2 seconds

function getCacheKey(filters: NostrFilter[]): string {
  return JSON.stringify(filters); // Simple key generation
}
```

## 🔐 Authentication (NIP-42)

### Handle Auth-Required Relays

```typescript
if (error.message.includes('AUTH_REQUIRED')) {
  // Some relays require NIP-42 authentication
  const auth = await user.signer.signEvent({
    kind: 22242,
    tags: [['relay', relayUrl], ['challenge', challenge]],
    content: '',
  });
  
  // Retry with auth
  relay.auth(auth);
  return retry();
}
```

## 📈 Monitoring & Logging

### Key Metrics to Track

```typescript
interface RelayMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalEvents: number;
  avgResponseTime: number;
  errorsByType: Record<string, number>;
  reconnectAttempts: number;
  lastQueryTime: number;
}

// Log periodic health reports
function logRelayHealth(relays: RelayHealth[]) {
  console.log('=== Relay Health ===');
  relays.forEach(relay => {
    console.log(`${relay.url}: ${relay.status} (${relay.errorRate.toFixed(1)}% error rate)`);
  });
}
```

## ✅ Current Implementation Status

### ✅ What's Working

- [x] Connection pooling with NPool
- [x] Primary relay prioritization
- [x] Multiple relay support (fan-out reads)
- [x] Relay list configuration
- [x] Read/write separation

### ⚠️ Needs Improvement

- [ ] Explicit reconnection strategy configuration
- [ ] Relay health tracking
- [ ] Circuit breaker pattern
- [ ] Timeout configuration visibility
- [ ] Error rate monitoring
- [ ] Relay recovery logging
- [ ] Performance metrics collection

## 🚀 Recommended Improvements

### Phase 1: Health Monitoring (High Priority)

1. Track relay health metrics
2. Log errors by type and relay
3. Sort relays by health
4. Display relay status in UI

### Phase 2: Connection Resilience

1. Implement circuit breaker pattern
2. Add exponential backoff for retries
3. Implement request deduplication
4. Add timeout configuration

### Phase 3: Advanced Features

1. NIP-42 authentication support
2. Relay discovery optimization
3. Connection pooling optimization
4. Performance monitoring dashboard

## 🔗 References

- [NIP-01: Basic Protocol Flow](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-42: Authentication](https://github.com/nostr-protocol/nips/blob/master/42.md)
- [NIP-11: Relay Information Document](https://github.com/nostr-protocol/nips/blob/master/11.md)
- [@nostrify Documentation](https://github.com/nbd-wtf/nostrify)
- [WebSocket Best Practices](https://www.rfc-editor.org/rfc/rfc6455)

## 🛠️ Troubleshooting

### Connection Keeps Dropping

**Symptoms:** App disconnects frequently, errors appear then clear

**Solutions:**
1. Check relay server status (NIP-11 document)
2. Increase timeout values
3. Add backup relays
4. Check network connectivity

### Slow Queries

**Symptoms:** App feels slow, loading takes long

**Solutions:**
1. Reduce number of relays queried per request
2. Optimize filter queries (limit, time range)
3. Enable request caching
4. Prefer faster relays (lower avg response time)

### Duplicate Data

**Symptoms:** Same events appear multiple times

**Solutions:**
1. Ensure NPool deduplication is enabled
2. Check query deduplication logic
3. Verify relay response validation

### Missing Data

**Symptoms:** Some posts/users don't show up

**Solutions:**
1. Add more read relays to config
2. Check relay filtering (NIP-13, proof-of-work)
3. Verify query parameters (time range, kinds)
4. Check user's relay settings (NIP-65)

---

**Last Updated**: August 2026
**Status**: Active & Maintained
