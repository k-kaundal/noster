import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart' show DecryptedDm;
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

/// A pending "someone sent you a message" banner.
class DmAlert {
  final String peerPubkey;
  final String preview;

  /// Newest incoming message timestamp we alerted for (dedupe).
  final int latestTs;
  const DmAlert({
    required this.peerPubkey,
    required this.preview,
    required this.latestTs,
  });
}

/// Watches incoming DMs and surfaces an in-app banner when a NEW message
/// arrives from someone else — the "someone sent you a message" notification.
///
/// How it works:
/// - Listens to [conversationListProvider] (decrypted conversations).
/// - Keeps track of the newest incoming message timestamp per peer.
/// - When a newer incoming message appears (and it's not from me, and the
///   user isn't currently looking at that thread), it emits a [DmAlert].
///
/// The banner is rendered by [_DmAlertHost] below, which also handles the
/// tap-to-open navigation. Kept as a provider (not a widget) so it lives at
/// the app root and works on every screen.
class DmNotifier extends Notifier<DmAlert?> {
  /// peerPubkey → newest incoming ts we've already alerted about.
  final Map<String, int> _alerted = {};
  bool _primed = false;

  @override
  DmAlert? build() {
    ref.listen(conversationListProvider, (prev, next) {
      next.whenData(_onConversations);
    });
    return null;
  }

  void _onConversations(
    List<({String peer, NostrEvent lastEvent, DecryptedDm? decrypted})> convs,
  ) {
    final auth = ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return;

    // First load: prime the dedupe map WITHOUT alerting (existing messages
    // aren't "new"). Only messages arriving AFTER this point notify.
    if (!_primed) {
      _primed = true;
      for (final c in convs) {
        final d = c.decrypted;
        if (d != null && d.senderPubkey != myPubkey) {
          final ts = _effectiveTs(c);
          if ((_alerted[c.peer] ?? 0) < ts) _alerted[c.peer] = ts;
        }
      }
      return;
    }

    for (final c in convs) {
      final d = c.decrypted;
      if (d == null) continue;
      // Only incoming messages from someone else.
      if (d.senderPubkey == myPubkey) continue;

      // ── Don't notify for already-READ messages ─────────────────────
      // The subscription re-delivers recent messages when you open chat and
      // stamps them with the current arrival time — without this check,
      // opening chat re-fires a "new message" notification for messages you
      // already read. A message only notifies when it arrives AFTER the
      // peer's last-read watermark AND after any prior alert for it.
      final store = ref.read(dmStoreProvider);
      final created = d.createdAt;
      if (!store.isUnreadFrom(c.peer, c.lastEvent, created)) {
        // Keep the dedupe watermark ahead so this event never alerts later.
        final ts = store.arrivalTsOf(c.lastEvent.id) ?? created;
        if ((_alerted[c.peer] ?? 0) < ts) _alerted[c.peer] = ts;
        continue;
      }

      final ts = _effectiveTs(c);
      final alreadyAlerted = _alerted[c.peer] ?? 0;
      if (ts <= alreadyAlerted) continue;

      _alerted[c.peer] = ts;
      state = DmAlert(peerPubkey: c.peer, preview: d.plaintext, latestTs: ts);
      // Phone notification (works backgrounded, like FB/Insta). The sender's
      // name resolves async — fire with the short key, upgrade when loaded.
      final name = ref
              .read(profileProvider(c.peer))
              .valueOrNull
              ?.displayNameOrName ??
          '${c.peer.substring(0, 8)}…';
      LocalNotificationService.instance.showMessage(
        senderName: name,
        preview: d.plaintext,
        peerPubkey: c.peer,
      );
      return; // One banner at a time.
    }
  }

  /// NIP-17 backdates created_at up to 2 days — a just-arrived message would
  /// look "old" and never trigger a banner. Arrival time (tracked by DmStore
  /// for live events) is the honest "is this new?" signal.
  int _effectiveTs(
    ({String peer, NostrEvent lastEvent, DecryptedDm? decrypted}) c,
  ) {
    final arrival = ref.read(dmStoreProvider).arrivalTsOf(c.lastEvent.id);
    final created = c.decrypted?.createdAt ?? c.lastEvent.createdAt;
    return arrival != null && arrival > created ? arrival : created;
  }

  void dismiss() => state = null;
}

final dmNotifierProvider = NotifierProvider<DmNotifier, DmAlert?>(
  DmNotifier.new,
);

/// Renders the in-app "new message" banner. Place this in a Stack above the
/// navigator (done in app.dart's MaterialApp builder).
class DmAlertBanner extends ConsumerWidget {
  const DmAlertBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alert = ref.watch(dmNotifierProvider);
    if (alert == null) return const SizedBox.shrink();

    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(alert.peerPubkey));
    final name = profileAsync.valueOrNull?.displayNameOrName ??
        '${alert.peerPubkey.substring(0, 8)}…';

    // Auto-dismiss after a few seconds.
    Future.delayed(const Duration(seconds: 4), () {
      if (ref.read(dmNotifierProvider)?.latestTs == alert.latestTs) {
        ref.read(dmNotifierProvider.notifier).dismiss();
      }
    });

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(16),
          color: colorScheme.surfaceContainerHigh,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              ref.read(dmNotifierProvider.notifier).dismiss();
              // This banner lives ABOVE the router (MaterialApp.builder), so
              // context.push has no GoRouter — navigate via the router itself.
              ref
                  .read(routerProvider)
                  .push('/chat/${alert.peerPubkey}');
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: colorScheme.primaryContainer,
                    backgroundImage:
                        profileAsync.valueOrNull?.picture != null &&
                                profileAsync.valueOrNull!.picture!.isNotEmpty
                            ? NetworkImage(profileAsync.valueOrNull!.picture!)
                            : null,
                    child: profileAsync.valueOrNull?.picture == null ||
                            profileAsync.valueOrNull!.picture!.isEmpty
                        ? Icon(Icons.lock_rounded,
                            size: 18, color: colorScheme.primary)
                        : null,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          alert.preview.isEmpty
                              ? 'Sent you an encrypted message'
                              : alert.preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chat_bubble_rounded,
                    size: 18,
                    color: colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
