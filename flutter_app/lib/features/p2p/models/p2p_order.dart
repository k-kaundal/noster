import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// NIP-69 P2P order event (kind 38383, addressable).
class P2POrder {
  final String id;
  final String orderId; // d tag
  final String type; // 'buy' | 'sell'
  final String currency; // ISO 4217 fiat code
  final String status; // pending | canceled | in-progress | success | expired
  final String amountSats; // amt tag ('0' = market price / any)
  final String fiatAmount; // fa tag (amount in fiat, may be range "100-200")
  final List<String> paymentMethods; // pm tags
  final String? premium; // premium % over market
  final String? makerName;
  final String? network; // mainnet | testnet
  final String? layer; // lightning
  final String? bond;
  final String makerPubkey;
  final int createdAt;
  final int? expiresAt;

  const P2POrder({
    required this.id,
    required this.orderId,
    required this.type,
    required this.currency,
    this.status = 'pending',
    this.amountSats = '0',
    this.fiatAmount = '',
    this.paymentMethods = const [],
    this.premium,
    this.makerName,
    this.network,
    this.layer,
    this.bond,
    required this.makerPubkey,
    required this.createdAt,
    this.expiresAt,
  });

  factory P2POrder.fromEvent(NostrEvent event) {
    final pm = <String>[];
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag[0] == 'pm' && tag.length > 1) pm.add(tag[1]);
    }
    return P2POrder(
      id: event.id,
      orderId: event.getTag('d') ?? '',
      type: event.getTag('k') ?? 'sell',
      currency: event.getTag('f') ?? 'USD',
      status: event.getTag('s') ?? 'pending',
      amountSats: event.getTag('amt') ?? '0',
      fiatAmount: event.getTag('fa') ?? '',
      paymentMethods: pm,
      premium: event.getTag('premium'),
      makerName: sanitizeText(event.getTag('name')),
      network: event.getTag('network'),
      layer: event.getTag('layer'),
      bond: event.getTag('bond'),
      makerPubkey: event.pubkey,
      createdAt: event.createdAt,
      expiresAt: int.tryParse(event.getTag('expires_at') ?? ''),
    );
  }

  bool get isBuy => type == 'buy';
  bool get isSell => type == 'sell';
  bool get isPending => status == 'pending';
  bool get isOpen => status == 'pending';

  String get typeLabel => isBuy ? 'BUY' : 'SELL';

  String get amountDisplay {
    if (fiatAmount.isNotEmpty) return '$fiatAmount ${currency.toUpperCase()}';
    if (amountSats != '0' && amountSats.isNotEmpty) return '$amountSats sats';
    return 'Market price';
  }
}
