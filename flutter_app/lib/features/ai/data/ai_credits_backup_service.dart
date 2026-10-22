import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_credits_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';

/// The d-tag of the user's AI-credits backup event (kind 30078 app-data).
const aiCreditsBackupDTag = 'nostrfeed-ai-credits';

/// AI credits backup on Nostr — the "credits follow the key, not the device"
/// piece.
///
/// The on-device ledger (secure storage) is fast but dies with a wipe and
/// doesn't move between devices. This service mirrors the ledger into a
/// NIP-44 self-encrypted, addressable app-data event (kind 30078, d-tag
/// [aiCreditsBackupDTag]) published to the user's relays: only the owner can
/// read it (encrypted to their own key), relays can't see the numbers, and
/// any device signed in with the same key restores it.
///
/// Merge is union semantics (`AiCreditsLedger.mergeWith`): purchases and
/// spends are monotonic counters, so the max of each is the truth and the
/// balance is re-derived — a merge can never resurrect spent credits or lose
/// a purchase.
///
/// Everything here is best-effort: a relay outage or a read-only (no
/// private key) login degrades to the local ledger, never blocks it.
class AiCreditsBackupService {
  final NostrService _nostr;

  AiCreditsBackupService(this._nostr);

  /// Whether a backup is possible at all: needs a full (private-key) login —
  /// read-only sessions can't sign or self-encrypt.
  bool get canBackup => _nostr.canSign;

  /// Fetches + decrypts the user's backed-up ledger from relays.
  ///
  /// Returns null when there's no backup, the user can't decrypt, or relays
  /// are unreachable — the caller treats null as "no remote copy", never as
  /// "zero balance".
  Future<AiCreditsLedger?> restore() async {
    if (!canBackup) return null;
    final pubkey = _nostr.auth.pubkey!;
    try {
      final events = await _nostr.relayPool.query(
        [
          NostrFilter(
            kinds: [NostrKinds.appData],
            authors: [pubkey],
            tagFilters: {
              'd': [aiCreditsBackupDTag],
            },
            limit: 1,
          ),
        ],
        timeout: const Duration(seconds: 8),
      );
      if (events.isEmpty) return null;
      // Addressable: newest version wins.
      events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return _decrypt(events.first);
    } catch (_) {
      return null;
    }
  }

  /// Encrypts + publishes [ledger] as the user's newest backup event.
  /// Fire-and-forget by callers; failures are swallowed (local ledger is
  /// the working copy, the backup just catches up next time).
  Future<void> backup(AiCreditsLedger ledger) async {
    if (!canBackup) return;
    try {
      final event = _encrypt(ledger);
      await _nostr.publishEvent(event);
    } catch (_) {
      // Backup is a mirror, never a gate on using credits.
    }
  }

  NostrEvent _encrypt(AiCreditsLedger ledger) {
    final privkey = _nostr.auth.privateKey!;
    final pubkey = _nostr.auth.pubkey!;
    final payload = _nostr.authService.nip44Encrypt(
      privateKey: privkey,
      peerPubkey: pubkey, // self-encrypted: only the owner reads it
      // Unit-tagged: a legacy (sats-era) backup is a bare ledger JSON; the
      // token format wraps it so restore knows the numbers are tokens.
      plaintext: jsonEncode({'unit': 'tokens', 'ledger': ledger.toJson()}),
    );
    return _nostr.createEvent(
      kind: NostrKinds.appData,
      content: payload,
      tags: [
        ['d', aiCreditsBackupDTag],
        ['client', 'nostrfeed'],
      ],
    );
  }

  AiCreditsLedger? _decrypt(NostrEvent event) {
    try {
      final privkey = _nostr.auth.privateKey!;
      final plaintext = _nostr.authService.nip44Decrypt(
        privateKey: privkey,
        peerPubkey: event.pubkey,
        payload: event.content,
      );
      final json = jsonDecode(plaintext);
      if (json is! Map<String, dynamic>) return null;
      if (json['unit'] == 'tokens' && json['ledger'] is Map<String, dynamic>) {
        return AiCreditsLedger.fromJson(
          json['ledger'] as Map<String, dynamic>,
        );
      }
      // Legacy sats-era backup (bare ledger JSON) — the numbers are SATS.
      // Convert to tokens BEFORE any merge: merging sats counters into a
      // token ledger would mix units and inflate the balance ~1,200×.
      final legacy = AiCreditsLedger.fromJson(json);
      if (legacy.totalPurchased == 0 && legacy.totalSpent == 0) return legacy;
      int toTokens(int sats) =>
          (sats * tokensPerUsd / AiCreditsService.migrationSatsPerUsd)
              .round();
      return AiCreditsLedger(
        balance: toTokens(legacy.balance),
        totalPurchased: toTokens(legacy.totalPurchased),
        totalSpent: toTokens(legacy.totalSpent),
        updatedAt: legacy.updatedAt,
      );
    } catch (_) {
      return null;
    }
  }
}
