import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

/// Resolve an event for a quote card: SQLite store first (free if we've
/// already ingested it), then a bounded relay fetch ingested back. Returns
/// null when the event can't be found — the card then shows a subtle
/// "couldn't load" placeholder instead of nothing.
final _quoteEventProvider =
    FutureProvider.family<NostrEvent?, String>((ref, eventId) async {
  final cached = await EventStore.instance.eventById(eventId);
  if (cached != null) return cached;
  try {
    final nostr = await initNostr(ref);
    final ev = await nostr.fetchEventById(eventId);
    if (ev != null) await EventStore.instance.ingest([ev]);
    return ev;
  } catch (_) {
    return null;
  }
});

/// A rich embedded preview of a quoted event (X's quote-tweet card).
///
/// NIP-18/NIP-27: a post that quotes another (`q` tag, or a `nostr:note1…`/
/// `nevent1…` reference in its content) should render the quoted event as a
/// compact embedded card — author, snippet, media indicator — that taps
/// through to the thread. The old renderer showed a bare "🔗 note abc…"
/// link, which is why quotes read as "no content".
class QuoteCard extends ConsumerWidget {
  /// The quoted event id (hex) or a NIP-19 reference (`note1…`/`nevent1…`).
  final String reference;
  const QuoteCard({super.key, required this.reference});

  String? get _eventId {
    // Raw 64-char hex id.
    if (RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(reference)) {
      return reference.toLowerCase();
    }
    // NIP-19: note1… / nevent1…
    final id =
        reference.startsWith('nostr:') ? reference.substring(6) : reference;
    final decoded = decodeNip19(id);
    return switch (decoded) {
      Nip19Note(eventId: final e) => e,
      Nip19Event(eventId: final e) => e,
      _ => null,
    };
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final eventId = _eventId;
    if (eventId == null) return const SizedBox.shrink();

    final eventAsync = ref.watch(_quoteEventProvider(eventId));

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: eventAsync.when(
        loading: () => _shell(
          scheme,
          child: const Row(
            children: [
              SkeletonCircle(radius: 12),
              SizedBox(width: 10),
              Expanded(child: SkeletonLine(height: 12)),
            ],
          ),
        ),
        error: (_, _) => _unavailable(scheme),
        data: (event) {
          if (event == null) return _unavailable(scheme);
          return _QuoteBody(event: event, shell: _shell);
        },
      ),
    );
  }

  Widget _shell(ColorScheme scheme, {required Widget child, VoidCallback? onTap}) {
    return Material(
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.all(12), child: child),
      ),
    );
  }

  Widget _unavailable(ColorScheme scheme) {
    return _shell(
      scheme,
      child: Row(
        children: [
          Icon(Icons.link_off_rounded, size: 16, color: scheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Text(
            'Quoted post unavailable',
            style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _QuoteBody extends ConsumerWidget {
  final NostrEvent event;
  final Widget Function(ColorScheme, {required Widget child, VoidCallback? onTap})
  shell;
  const _QuoteBody({required this.event, required this.shell});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        (event.pubkey.length > 12
            ? '${event.pubkey.substring(0, 8)}…'
            : event.pubkey);

    // Snippet: the text, trimmed. Note the media indicator if it carries any.
    final text = sanitizeText(event.content.trim());
    final hasMedia = _hasMedia(event);
    final snippet = text.length > 220 ? '${text.substring(0, 220)}…' : text;

    return shell(
      scheme,
      onTap: () => context.push('/thread', extra: event),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SafeAvatar(imageUrl: profile?.picture, radius: 12),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          if (snippet.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              snippet,
              style: TextStyle(
                fontSize: 13,
                color: scheme.onSurfaceVariant,
                height: 1.35,
              ),
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (hasMedia) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(Icons.photo_library_outlined,
                    size: 14, color: scheme.primary),
                const SizedBox(width: 6),
                Text(
                  'Media',
                  style: TextStyle(fontSize: 12, color: scheme.primary),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  bool _hasMedia(NostrEvent e) {
    final c = e.content.toLowerCase();
    return c.contains('.jpg') ||
        c.contains('.jpeg') ||
        c.contains('.png') ||
        c.contains('.gif') ||
        c.contains('.webp') ||
        c.contains('.mp4') ||
        e.kind == 20 ||
        e.kind == 21 ||
        e.kind == 22;
  }
}
