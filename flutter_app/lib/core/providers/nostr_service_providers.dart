import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';

export 'package:nostrfeed_mobile/core/nostr/nostr_service.dart'
    show NostrService;
export 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart'
    show EventEngagement;
export 'package:nostrfeed_mobile/core/nostr/repositories/feed_repository.dart'
    show HashtagStat;

/// Nostr service singleton.
final nostrServiceProvider = Provider<NostrService>((ref) => NostrService());

/// Helper: ensure service is initialized before querying.
Future<NostrService> initNostr(Ref ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr;
}
