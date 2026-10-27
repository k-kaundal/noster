/// Chat message model for the NostrFeed AI feature.
///
/// Pure Dart (ADR-0001 domain layer) — no Flutter, no I/O.
/// Provider/model/pricing config lives in `ai_gateway.dart`.
library;

/// One message in an AI chat thread.
/// One step of an agent run (Grok-style "what it's doing") — a tool call
/// with a short status line, shown above the final answer.
class AgentStepEntry {
  final String tool;
  final String status;
  const AgentStepEntry({required this.tool, required this.status});

  Map<String, dynamic> toJson() => {'tool': tool, 'status': status};
  factory AgentStepEntry.fromJson(Map<String, dynamic> json) =>
      AgentStepEntry(
        tool: json['tool'] as String? ?? '',
        status: json['status'] as String? ?? '',
      );
}

class AiMessage {
  final String id;
  final AiRole role;
  final String content;
  final DateTime createdAt;

  /// TOKENS actually charged for this message (assistant messages only).
  final int? costTokens;

  /// USD cost reported by the provider's `usage` (assistant messages only).
  final double? costUsd;

  /// Model id that produced this answer (assistant messages only).
  final String? model;

  /// Generated image URLs (image-gen models — data URLs or hosted URLs).
  final List<String> images;

  /// Generated video URLs (video-gen models — hosted mp4 URLs).
  final List<String> videos;

  /// Agent-mode steps that produced this answer (empty for plain chat).
  final List<AgentStepEntry> agentSteps;

  const AiMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    this.costTokens,
    this.costUsd,
    this.model,
    this.images = const [],
    this.videos = const [],
    this.agentSteps = const [],
  });

  AiMessage copyWith({
    String? content,
    int? costTokens,
    double? costUsd,
    String? model,
    List<String>? images,
    List<String>? videos,
    List<AgentStepEntry>? agentSteps,
  }) {
    return AiMessage(
      id: id,
      role: role,
      content: content ?? this.content,
      createdAt: createdAt,
      costTokens: costTokens ?? this.costTokens,
      costUsd: costUsd ?? this.costUsd,
      model: model ?? this.model,
      images: images ?? this.images,
      videos: videos ?? this.videos,
      agentSteps: agentSteps ?? this.agentSteps,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'content': content,
        'createdAt': createdAt.millisecondsSinceEpoch,
        if (costTokens != null) 'costTokens': costTokens,
        if (costUsd != null) 'costUsd': costUsd,
        if (model != null) 'model': model,
        if (images.isNotEmpty) 'images': images,
        if (videos.isNotEmpty) 'videos': videos,
        if (agentSteps.isNotEmpty)
          'agentSteps': [for (final s in agentSteps) s.toJson()],
      };

  factory AiMessage.fromJson(Map<String, dynamic> json) => AiMessage(
        id: json['id'] as String,
        role: AiRole.values.firstWhere(
          (r) => r.name == json['role'],
          orElse: () => AiRole.user,
        ),
        content: json['content'] as String? ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          json['createdAt'] as int? ?? 0,
        ),
        // Reads BOTH keys: history written in the sats era still parses (its
        // numbers were sats; they're shown as tokens — close enough at the
        // current rate, and a display label is the only thing they drive).
        costTokens: (json['costTokens'] ?? json['costSats']) as int?,
        costUsd: (json['costUsd'] as num?)?.toDouble(),
        model: json['model'] as String?,
        images: [
          for (final url in (json['images'] as List? ?? const [])) '$url',
        ],
        videos: [
          for (final url in (json['videos'] as List? ?? const [])) '$url',
        ],
        agentSteps: [
          for (final s in (json['agentSteps'] as List? ?? const []))
            if (s is Map<String, dynamic>) AgentStepEntry.fromJson(s),
        ],
      );
}

enum AiRole { user, assistant, system }

/// The result of trimming a chat history to the request's context budget.
class ContextWindow {
  /// The messages that fit, oldest-first (includes the new user message).
  final List<AiMessage> messages;

  /// How many older messages were left out. The UI surfaces this ("older
  /// messages are out of context — clear chat to reset") so a silent
  /// truncation never reads as the model "forgetting".
  final int dropped;

  const ContextWindow(this.messages, this.dropped);
}

/// Fits [history] (oldest-first, the new user message LAST) into the
/// model's request budget.
///
/// Budgets are in CHARACTERS (≈ 4 chars/token): every message is capped
/// individually ([maxPerMessageChars], long pastes stop eating the window),
/// and the whole window is capped at [maxTotalChars], walking back from the
/// newest message — the recent exchange matters more than the opening one.
/// [reservedChars] accounts for the system prompt + a live Nostr context
/// block, so a big fetched context shrinks the history instead of blowing
/// the model's context window (which is how "the AI forgot everything" /
/// provider context-length errors happen).
ContextWindow trimToContextBudget(
  List<AiMessage> history, {
  int maxTotalChars = 22000,
  int maxPerMessageChars = 4000,
  int reservedChars = 0,
}) {
  final budget = maxTotalChars -
      (reservedChars > maxTotalChars ~/ 2 ? maxTotalChars ~/ 2 : reservedChars);
  if (budget <= 0 || history.isEmpty) {
    return ContextWindow(history, 0);
  }

  String capped(String content) {
    if (content.length <= maxPerMessageChars) return content;
    // Keep the head AND the tail of a long message — a truncated paste
    // loses the question at its end far more often than its preamble.
    final half = maxPerMessageChars ~/ 2;
    return '${content.substring(0, half)}\n[…]\n'
        '${content.substring(content.length - half)}';
  }

  final kept = <AiMessage>[];
  var used = 0;
  var dropped = 0;
  for (var i = history.length - 1; i >= 0; i--) {
    final m = history[i];
    final content = capped(m.content);
    final cost = content.length;
    // The LAST message (the new user message) always fits — sending nothing
    // but the question beats failing on a full window.
    if (used + cost > budget && kept.isNotEmpty) {
      dropped = i + 1;
      break;
    }
    used += cost;
    kept.insert(0, content == m.content ? m : m.copyWith(content: content));
  }
  return ContextWindow(kept, dropped);
}
