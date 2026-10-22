/// Global providers, split by domain and re-exported here so existing
/// imports keep working while the structure is organized internally:
///
/// - `nostr_service_providers.dart` — the NostrService singleton + init.
/// - `auth_providers.dart` — auth state, profiles, follows, user posts.
/// - `content_providers.dart` — feed/trending/search/engagement/market/etc.
///
/// New code should import the domain file it needs rather than this barrel
/// (cheaper analysis), but nothing is required to change today.
library;

export 'auth_providers.dart';
export 'content_providers.dart';
export 'nostr_service_providers.dart';
