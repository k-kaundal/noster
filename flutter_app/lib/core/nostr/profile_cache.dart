import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// The shared profile-cache value: the kind-0 profile, its event
/// `created_at` (freshness vs relay revisions), and a local `fetchedAt`
/// wall-clock timestamp for TTL-based fast paths.
typedef ProfileCacheEntry = ({
  NostrProfile profile,
  int createdAt,
  int fetchedAt,
});

/// Bound for the shared profile cache. Without it the map grew by every
/// prefetched author forever — a long session scrolling past thousands of
/// unique authors accumulated thousands of entries (memory creep). 1500
/// matches the SQLite profile cap — plenty for a session's worth of
/// distinct authors.
const int kProfileCacheCap = 1500;

/// Bounded-write extension on the shared profile cache. The cache is owned
/// by `NostrService` but passed to `SocialRepository` as a plain `Map`, so
/// it can't use a service method — this extension makes the LRU bound
/// available at every write site without a circular import.
extension ProfileCacheBoundedWrite on Map<String, ProfileCacheEntry> {
  /// Insert/update [pubkey], keeping insertion order fresh (Dart's
  /// LinkedHashMap iterates in insertion order) and evicting the OLDEST
  /// entry once past [kProfileCacheCap]. Re-inserting an existing key moves
  /// it to the most-recently-used end, so eviction always drops the stalest.
  void cacheProfileBounded(
    String pubkey, {
    required NostrProfile profile,
    required int createdAt,
    required int fetchedAt,
  }) {
    remove(pubkey); // re-insert at the MRU end
    this[pubkey] = (
      profile: profile,
      createdAt: createdAt,
      fetchedAt: fetchedAt,
    );
    if (length > kProfileCacheCap) {
      remove(keys.first); // evict least-recently-used (oldest)
    }
  }
}
