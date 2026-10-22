/// Chat message model for the NostrFeed AI feature.
///
/// Pure Dart (ADR-0001 domain layer) — no Flutter, no I/O.
/// Provider/model/pricing config lives in `ai_gateway.dart`.
library;

/// One message in an AI chat thread.
class AiMessage {
  final String id;
  final AiRole role;
  final String content;
  final DateTime createdAt;

  /// Sats actually charged for this message (assistant messages only).
  final int? costSats;

  /// USD cost reported by the provider's `usage` (assistant messages only).
  final double? costUsd;

  /// Model id that produced this answer (assistant messages only).
  final String? model;

  /// Generated image URLs (image-gen models — data URLs or hosted URLs).
  final List<String> images;

  const AiMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    this.costSats,
    this.costUsd,
    this.model,
    this.images = const [],
  });

  AiMessage copyWith({
    String? content,
    int? costSats,
    double? costUsd,
    String? model,
    List<String>? images,
  }) {
    return AiMessage(
      id: id,
      role: role,
      content: content ?? this.content,
      createdAt: createdAt,
      costSats: costSats ?? this.costSats,
      costUsd: costUsd ?? this.costUsd,
      model: model ?? this.model,
      images: images ?? this.images,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'content': content,
        'createdAt': createdAt.millisecondsSinceEpoch,
        if (costSats != null) 'costSats': costSats,
        if (costUsd != null) 'costUsd': costUsd,
        if (model != null) 'model': model,
        if (images.isNotEmpty) 'images': images,
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
        costSats: json['costSats'] as int?,
        costUsd: (json['costUsd'] as num?)?.toDouble(),
        model: json['model'] as String?,
        images: [
          for (final url in (json['images'] as List? ?? const [])) '$url',
        ],
      );
}

enum AiRole { user, assistant, system }
