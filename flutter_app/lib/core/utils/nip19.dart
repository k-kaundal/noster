import 'package:flutter/material.dart';
import 'package:bech32/bech32.dart';
import 'package:hex/hex.dart';

/// Decoded NIP-19 identifier.
sealed class Nip19Id {
  const Nip19Id();
}

class Nip19Pubkey extends Nip19Id {
  final String pubkey;
  const Nip19Pubkey(this.pubkey);
}

class Nip19Note extends Nip19Id {
  final String eventId;
  const Nip19Note(this.eventId);
}

class Nip19Profile extends Nip19Id {
  final String pubkey;
  final List<String> relays;
  const Nip19Profile(this.pubkey, this.relays);
}

class Nip19Event extends Nip19Id {
  final String eventId;
  final String? author;
  final int? kind;
  final List<String> relays;
  const Nip19Event(this.eventId, {this.author, this.kind, this.relays = const []});
}

class Nip19Address extends Nip19Id {
  final int kind;
  final String pubkey;
  final String identifier;
  final List<String> relays;
  const Nip19Address({
    required this.kind,
    required this.pubkey,
    required this.identifier,
    this.relays = const [],
  });
}

/// Decode a NIP-19 bech32 identifier (npub/nsec/note/nprofile/nevent/naddr).
/// Returns null on parse failure.
Nip19Id? decodeNip19(String input) {
  try {
    final codec = const Bech32Codec();
    final decoded = codec.decode(input.trim(), input.length);
    final hrp = decoded.hrp;
    final data = _convertBits(decoded.data, 5, 8, false);

    switch (hrp) {
      case 'npub':
        return Nip19Pubkey(HEX.encode(data));
      case 'note':
        return Nip19Note(HEX.encode(data));
      case 'nprofile':
        return _decodeProfile(data);
      case 'nevent':
        return _decodeEvent(data);
      case 'naddr':
        return _decodeAddress(data);
      default:
        return null;
    }
  } catch (_) {
    return null;
  }
}

/// Parse TLV (type-length-value) encoded data for nprofile/nevent/naddr.
Map<int, List<List<int>>> _parseTlv(List<int> bytes) {
  final result = <int, List<List<int>>>{};
  var i = 0;
  while (i + 2 <= bytes.length) {
    final type = bytes[i];
    final length = bytes[i + 1];
    if (i + 2 + length > bytes.length) break;
    final value = bytes.sublist(i + 2, i + 2 + length);
    result.putIfAbsent(type, () => []).add(value);
    i += 2 + length;
  }
  return result;
}

Nip19Id? _decodeProfile(List<int> data) {
  final tlv = _parseTlv(data);
  final pubkeyBytes = tlv[0]?.firstOrNull;
  if (pubkeyBytes == null || pubkeyBytes.length != 32) return null;
  final relays = (tlv[1] ?? []).map((r) => String.fromCharCodes(r)).toList();
  return Nip19Profile(HEX.encode(pubkeyBytes), relays);
}

Nip19Id? _decodeEvent(List<int> data) {
  final tlv = _parseTlv(data);
  final idBytes = tlv[0]?.firstOrNull;
  if (idBytes == null || idBytes.length != 32) return null;
  final relays = (tlv[1] ?? []).map((r) => String.fromCharCodes(r)).toList();
  final authorBytes = tlv[2]?.firstOrNull;
  final kindBytes = tlv[3]?.firstOrNull;
  return Nip19Event(
    HEX.encode(idBytes),
    author: authorBytes != null ? HEX.encode(authorBytes) : null,
    kind: kindBytes != null && kindBytes.length == 4
        ? (kindBytes[0] << 24) | (kindBytes[1] << 16) | (kindBytes[2] << 8) | kindBytes[3]
        : null,
    relays: relays,
  );
}

Nip19Id? _decodeAddress(List<int> data) {
  final tlv = _parseTlv(data);
  final idBytes = tlv[0]?.firstOrNull;
  if (idBytes == null) return null;
  final relays = (tlv[1] ?? []).map((r) => String.fromCharCodes(r)).toList();
  final authorBytes = tlv[2]?.firstOrNull;
  final kindBytes = tlv[3]?.firstOrNull;
  if (authorBytes == null || authorBytes.length != 32) return null;
  if (kindBytes == null || kindBytes.length != 4) return null;
  return Nip19Address(
    kind: (kindBytes[0] << 24) | (kindBytes[1] << 16) | (kindBytes[2] << 8) | kindBytes[3],
    pubkey: HEX.encode(authorBytes),
    identifier: String.fromCharCodes(idBytes),
    relays: relays,
  );
}

List<int> _convertBits(List<int> data, int from, int to, bool pad) {
  var acc = 0;
  var bits = 0;
  final maxv = (1 << to) - 1;
  final result = <int>[];
  for (final value in data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.add((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) result.add((acc << (to - bits)) & maxv);
  return result;
}

/// Returns true if the input looks like a NIP-19 bech32 identifier.
bool looksLikeNip19(String input) {
  final s = input.trim().toLowerCase();
  return s.startsWith('npub1') ||
      s.startsWith('note1') ||
      s.startsWith('nprofile1') ||
      s.startsWith('nevent1') ||
      s.startsWith('naddr1') ||
      s.startsWith('nsec1');
}

/// A placeholder page for NIP-19 deep links that don't have a dedicated handler.
class Nip19HandlerPage extends StatelessWidget {
  final String identifier;
  const Nip19HandlerPage({super.key, required this.identifier});

  @override
  Widget build(BuildContext context) {
    final decoded = decodeNip19(identifier);
    return Scaffold(
      appBar: AppBar(title: const Text('Nostr Link')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.link, size: 48),
              const SizedBox(height: 16),
              Text(
                decoded == null
                    ? 'Invalid Nostr identifier'
                    : 'Unsupported identifier type',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                identifier,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                    ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
