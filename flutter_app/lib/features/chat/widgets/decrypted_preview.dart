import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

class DecryptedPreview extends ConsumerStatefulWidget {
  final NostrEvent event;
  final DecryptedDm? cached;

  const DecryptedPreview({super.key, required this.event, this.cached});

  @override
  ConsumerState<DecryptedPreview> createState() => _DecryptedPreviewState();
}

class _DecryptedPreviewState extends ConsumerState<DecryptedPreview> {
  String? _text;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    if (widget.cached != null) {
      _text = widget.cached!.plaintext;
    } else {
      _decrypt();
    }
  }

  Future<void> _decrypt() async {
    final nostr = ref.read(nostrServiceProvider);
    final result = await nostr.decryptDm(widget.event);
    if (mounted) {
      setState(() {
        _text = result?.plaintext;
        _failed = result == null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final display = _failed ? 'Unable to decrypt' : (_text ?? '…');
    return Text(
      display,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        fontSize: 14,
        color: colorScheme.onSurfaceVariant,
        fontStyle: _failed ? FontStyle.italic : FontStyle.normal,
      ),
    );
  }
}
