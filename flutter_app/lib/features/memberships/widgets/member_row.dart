import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/profile_avatar.dart';
import 'package:nostrfeed_mobile/features/studio/models/subscription.dart';

/// One supporter on a tier: who, where they stand, what they have given.
class MemberRow extends ConsumerWidget {
  final Member member;
  final Cadence cadence;

  const MemberRow({super.key, required this.member, required this.cadence});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(member.pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayName ?? profile?.name ??
        '${member.pubkey.substring(0, 8)}…';

    final status = member.status;
    final active = status.state == SubscriptionState.active;

    final last = status.lastPayment;
    final subtitle = switch (status.state) {
      SubscriptionState.active =>
        'Active · ${status.daysLeft ?? 0} days left',
      SubscriptionState.lapsed => last != null
          ? 'Lapsed · last paid ${timeago.format(DateTime.fromMillisecondsSinceEpoch(last.at * 1000))}'
          : 'Lapsed',
      SubscriptionState.none =>
        status.shortfallSats > 0 ? 'Tipped, not subscribed' : '—',
    };

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: ProfileAvatar(
        profile: profile,
        pubkey: member.pubkey,
        radius: 18,
      ),
      title: Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(
          fontSize: 12,
          color: active ? scheme.primary : scheme.onSurfaceVariant,
        ),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '${_format(status.totalSats)} sats',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          ),
          Text(
            'lifetime',
            style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

String _format(int sats) {
  final s = sats.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final idx = s.length - i;
    buf.write(s[i]);
    if (idx > 1 && idx % 3 == 1) buf.write(',');
  }
  return buf.toString();
}
