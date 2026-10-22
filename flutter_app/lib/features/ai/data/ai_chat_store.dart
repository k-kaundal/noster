import 'dart:convert';

import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

import 'package:shared_preferences/shared_preferences.dart';

/// On-device chat history for the AI assistant (local-only per plan §6 —
/// no server, no Nostr sync). Bounded so it can't grow without limit.
class AiChatStore {
  static const _key = 'ai:chat_history_v1';
  static const maxMessages = 300;

  Future<List<AiMessage>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return const [];
      final list = jsonDecode(raw);
      if (list is! List) return const [];
      return list
          .whereType<Map<String, dynamic>>()
          .map(AiMessage.fromJson)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> save(List<AiMessage> messages) async {
    final prefs = await SharedPreferences.getInstance();
    final bounded = messages.length > maxMessages
        ? messages.sublist(messages.length - maxMessages)
        : messages;
    await prefs.setString(
      _key,
      jsonEncode([for (final m in bounded) m.toJson()]),
    );
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
