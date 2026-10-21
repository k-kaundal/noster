import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_context.dart';

/// Decrypted DM payload — used by both NIP-04 (kind 4) and NIP-17 (kind 1059).
class DecryptedDm {
  final String plaintext;
  final String senderPubkey;

  /// The REAL recipient (from the rumor's 'p' tag for NIP-17). Null when it
  /// can't be determined (e.g. legacy kind 4 where the p-tag is on the event).
  final String? recipientPubkey;

  final int createdAt;
  const DecryptedDm({
    required this.plaintext,
    required this.senderPubkey,
    this.recipientPubkey,
    required this.createdAt,
  });
}

class DmRepository {
  final NostrContext ctx;
  DmRepository(this.ctx);

  /// NIP-04 encrypted DM (kind 4).
  NostrEvent createEncryptedDm(String peerPubkey, String plaintext) {
    ctx.requireSigning();
    return ctx.authService.signDmEvent(
      privateKey: ctx.auth.privateKey!,
      peerPubkey: peerPubkey,
      plaintext: plaintext,
    );
  }

  /// NIP-17 gift-wrapped DM (kind 1059) — modern, metadata-private.
  /// Most current clients (Amethyst, 0xchat, Damus) send DMs this way.
  ///
  /// Returns TWO gift wraps per NIP-17: one for the recipient, one for the
  /// sender (so the sender's clients can decrypt and show their own message).
  List<NostrEvent> createNip17Dm(String peerPubkey, String plaintext) {
    ctx.requireSigning();
    return ctx.authService.signGiftWrap(
      senderPrivateKey: ctx.auth.privateKey!,
      senderPubkey: ctx.auth.pubkey!,
      recipientPubkey: peerPubkey,
      plaintext: plaintext,
    );
  }

  /// NIP-17 DM inbox relay list (kind 10050) — tells OTHER users where to
  /// send us gift wraps. Without it, senders fall back to well-known DM
  /// relays (Primal etc.), which is unreliable.
  NostrEvent createDmInboxRelayList(List<String> relayUrls) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 10050,
      content: '',
      tags: [
        for (final url in relayUrls) ['relay', url],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Decrypt a DM event from the current user's perspective.
  ///
  /// Handles both:
  ///  - kind 4 (legacy NIP-04, AES-256-CBC)
  ///  - kind 1059 (NIP-17 gift wrap, NIP-44 + seal + gift)
  ///
  /// Returns a record with the plaintext, the real sender pubkey (from the
  /// inner rumor for NIP-17), and the rumor timestamp. Returns null on
  /// failure.
  Future<DecryptedDm?> decryptDm(NostrEvent event) async {
    if (ctx.auth.privateKey == null) return null;
    final myPubkey = ctx.auth.pubkey;
    if (myPubkey == null) return null;

    // ── NIP-17 gift wrap ────────────────────────────────────────────
    if (event.kind == 1059) {
      try {
        final rumor = ctx.authService.unwrapGiftWrap(
          recipientPrivateKey: ctx.auth.privateKey!,
          giftWrap: event,
        );
        final rumorPubkey = rumor['pubkey'] as String;
        final rumorContent = rumor['content'] as String;
        final rumorTs = rumor['created_at'] as int;
        // Extract the peer from the rumor's 'p' tag. For a message we sent,
        // this is the recipient; for a message to us, this is us (the sender
        // p-tags themselves in their own copy per NIP-17).
        final rumorTags = rumor['tags'] as List?;
        String? recipient;
        if (rumorTags != null) {
          for (final tag in rumorTags) {
            if (tag is List && tag.isNotEmpty && tag[0] == 'p' && tag.length > 1) {
              recipient = tag[1] as String?;
              break;
            }
          }
        }
        return DecryptedDm(
          plaintext: rumorContent,
          senderPubkey: rumorPubkey,
          recipientPubkey: recipient,
          createdAt: rumorTs,
        );
      } catch (_) {
        return null;
      }
    }

    // ── NIP-04 legacy ───────────────────────────────────────────────
    if (event.kind == 4) {
      // Determine the peer's pubkey: if we sent it, the peer is the 'p' tag;
      // otherwise the peer is the event author.
      final peerPubkey = event.pubkey == myPubkey
          ? event.getTag('p')
          : event.pubkey;
      if (peerPubkey == null || peerPubkey.isEmpty) return null;
      try {
        final plaintext = await ctx.authService.nip04Decrypt(
          privateKey: ctx.auth.privateKey!,
          peerPubkey: peerPubkey,
          ciphertext: event.content,
        );
        return DecryptedDm(
          plaintext: plaintext,
          senderPubkey: event.pubkey,
          createdAt: event.createdAt,
        );
      } catch (_) {
        return null;
      }
    }

    return null;
  }
}
