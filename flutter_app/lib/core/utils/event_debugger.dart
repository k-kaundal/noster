import 'dart:convert';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// Debug utility to inspect and log Nostr events for troubleshooting.
/// Call `debugPrintEvent(event)` to see what's really in an event.
class EventDebugger {
  static String describeEvent(NostrEvent event) {
    final buffer = StringBuffer();
    buffer.writeln('┌─ Event ${event.id.substring(0, 12)}… ─────────────────');
    buffer.writeln('│ kind: ${event.kind} (${_kindName(event.kind)})');
    buffer.writeln('│ pubkey: ${event.pubkey.substring(0, 12)}…');
    buffer.writeln('│ created_at: ${event.createdAt} (${DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000)})');
    buffer.writeln('│ content (${event.content.length} chars): ${_preview(event.content, 100)}');
    buffer.writeln('│ tags (${event.tags.length}):');

    for (final tag in event.tags) {
      if (tag.isEmpty) continue;
      buffer.writeln('│   [${tag.map((t) => '"$t"').join(', ')}]');
    }

    // Analysis
    buffer.writeln('│');
    buffer.writeln('│ Analysis:');
    buffer.writeln('│   ${_analyze(event)}');
    buffer.writeln('└─────────────────────────────────────────');

    return buffer.toString();
  }

  static String _kindName(int kind) {
    return switch (kind) {
      0 => 'profile metadata',
      1 => 'text note',
      3 => 'contacts',
      4 => 'legacy DM',
      6 => 'repost',
      7 => 'reaction',
      16 => 'generic repost',
      20 => 'picture',
      21 => 'video',
      22 => 'short video',
      1111 => 'NIP-22 comment',
      9735 => 'zap receipt',
      30023 => 'long-form article',
      31922 => 'calendar date event',
      31923 => 'calendar time event',
      31925 => 'calendar RSVP',
      _ => 'unknown',
    };
  }

  static String _preview(String content, int maxLen) {
    if (content.length <= maxLen) return content;
    return '${content.substring(0, maxLen)}…';
  }

  static String _analyze(NostrEvent event) {
    final issues = <String>[];

    // Check if content looks like JSON
    final trimmed = event.content.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        final parsed = jsonDecode(trimmed);
        if (parsed is Map) {
          if (parsed.containsKey('id') && parsed.containsKey('sig')) {
            issues.add('⚠️ Content is EMBEDDED EVENT JSON (should be unwrapped)');
          } else if (parsed.containsKey('name') || parsed.containsKey('about')) {
            issues.add('⚠️ Content is PROFILE JSON (should not render as text)');
          } else {
            issues.add('⚠️ Content is JSON (keys: ${parsed.keys.take(5).join(", ")})');
          }
        }
      } catch (_) {
        issues.add('ℹ️ Content starts/ends with braces but is not valid JSON');
      }
    }

    // Kind-specific checks
    switch (event.kind) {
      case 6:
      case 16:
        if (event.content.isEmpty) {
          issues.add('ℹ️ Repost with empty content — should fetch by e-tag');
        }
        if (event.getTag('e') == null) {
          issues.add('⚠️ Repost missing e-tag');
        }
        break;
      case 7:
        final content = event.content;
        if (content != '+' && content != '-' && content.isNotEmpty && !_isEmoji(content)) {
          issues.add('ℹ️ Reaction with non-standard content: "$content"');
        }
        break;
      case 9735:
        if (event.getTag('bolt11') == null) {
          issues.add('⚠️ Zap receipt missing bolt11 tag');
        }
        if (event.getTag('P') == null) {
          issues.add('ℹ️ Zap receipt missing P tag (sender unknown)');
        }
        break;
      case 30023:
        if (event.getTag('d') == null) {
          issues.add('⚠️ Article missing d tag');
        }
        if (event.getTag('title') == null) {
          issues.add('ℹ️ Article missing title tag');
        }
        break;
    }

    if (issues.isEmpty) {
      return '✅ Looks normal';
    }
    return issues.join('\n│   ');
  }

  static bool _isEmoji(String s) {
    // Simple check — most emojis are multi-byte
    return s.runes.any((r) => r > 127);
  }

  /// Log a list of events with summary statistics.
  static String summarizeEvents(List<NostrEvent> events) {
    final buffer = StringBuffer();
    buffer.writeln('=== Event Summary (${events.length} events) ===');

    final byKind = <int, int>{};
    var jsonContentCount = 0;
    var emptyContentCount = 0;

    for (final e in events) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      final trimmed = e.content.trim();
      if (trimmed.isEmpty) emptyContentCount++;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) jsonContentCount++;
    }

    buffer.writeln('Kinds:');
    for (final entry in byKind.entries.toList()..sort((a, b) => b.value.compareTo(a.value))) {
      buffer.writeln('  kind ${entry.key} (${_kindName(entry.key)}): ${entry.value}');
    }

    buffer.writeln('Content issues:');
    buffer.writeln('  JSON-like content: $jsonContentCount');
    buffer.writeln('  Empty content: $emptyContentCount');

    return buffer.toString();
  }
}
