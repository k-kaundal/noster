import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:linkify/linkify.dart' as linkify;
import 'package:url_launcher/url_launcher.dart';

/// Renders rich Nostr post content with tappable hashtags, mentions, and URLs.
class PostContent extends StatelessWidget {
  final String content;
  final TextStyle? baseStyle;
  final void Function(String hashtag)? onHashtagTap;
  final void Function(String pubkeyOrNpub)? onMentionTap;
  final int? maxLines;

  const PostContent({
    super.key,
    required this.content,
    this.baseStyle,
    this.onHashtagTap,
    this.onMentionTap,
    this.maxLines,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = theme.colorScheme.primary;
    final style = baseStyle ?? theme.textTheme.bodyMedium ?? const TextStyle();

    final elements = linkify.linkify(
      content,
      linkifiers: const [
        linkify.UrlLinkifier(),
        _HashtagLinkifier(),
        _MentionLinkifier(),
      ],
    );

    final spans = <TextSpan>[];
    for (final el in elements) {
      if (el is _HashtagElement) {
        spans.add(TextSpan(
          text: el.text,
          style: style.copyWith(
            color: accent,
            fontWeight: FontWeight.w600,
          ),
          recognizer: TapGestureRecognizer()
            ..onTap = () => onHashtagTap?.call(el.tag),
        ));
      } else if (el is _MentionElement) {
        spans.add(TextSpan(
          text: el.text,
          style: style.copyWith(
            color: accent,
            fontWeight: FontWeight.w600,
          ),
          recognizer: TapGestureRecognizer()
            ..onTap = () => onMentionTap?.call(el.pubkey),
        ));
      } else if (el is linkify.UrlElement) {
        spans.add(TextSpan(
          text: el.text,
          style: style.copyWith(
            color: accent,
            decoration: TextDecoration.underline,
            decorationColor: accent,
          ),
          recognizer: TapGestureRecognizer()
            ..onTap = () => _launchUrl(el.url),
        ));
      } else {
        spans.add(TextSpan(text: el.text, style: style));
      }
    }

    final richText = Text.rich(
      TextSpan(children: spans, style: style),
      maxLines: maxLines,
      overflow: maxLines != null ? TextOverflow.ellipsis : TextOverflow.clip,
    );

    return SelectionArea(child: richText);
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

// ---- Custom linkifiers ----

class _HashtagElement extends linkify.LinkableElement {
  final String tag;
  _HashtagElement(String text, this.tag) : super(text, '#$tag');
}

class _MentionElement extends linkify.LinkableElement {
  final String pubkey;
  _MentionElement(String text, this.pubkey) : super(text, pubkey);
}

class _HashtagLinkifier extends linkify.Linkifier {
  const _HashtagLinkifier();

  static final _regex = RegExp(r'(^|\s)#(\w+)');

  @override
  List<linkify.LinkifyElement> parse(
    List<linkify.LinkifyElement> elements,
    linkify.LinkifyOptions options,
  ) {
    final out = <linkify.LinkifyElement>[];
    for (final el in elements) {
      if (el is linkify.TextElement) {
        out.addAll(_splitText(el.text));
      } else {
        out.add(el);
      }
    }
    return out;
  }

  List<linkify.LinkifyElement> _splitText(String text) {
    final out = <linkify.LinkifyElement>[];
    var last = 0;
    for (final m in _regex.allMatches(text)) {
      final hashStart = m.start + m.group(1)!.length;
      final hashEnd = m.end;
      final tag = m.group(2)!;
      if (hashStart > last) {
        out.add(linkify.TextElement(text.substring(last, hashStart)));
      }
      final hashtagText = text.substring(hashStart, hashEnd);
      out.add(_HashtagElement(hashtagText, tag));
      last = hashEnd;
    }
    if (last < text.length) {
      out.add(linkify.TextElement(text.substring(last)));
    }
    if (out.isEmpty) return [linkify.TextElement(text)];
    return out;
  }
}

class _MentionLinkifier extends linkify.Linkifier {
  const _MentionLinkifier();

  // Matches nostr:npub1... and nostr:nprofile1...
  static final _regex = RegExp(
    r'(nostr:)?(npub1[02-9ac-hj-np-z]+|nprofile1[02-9ac-hj-np-z]+|note1[02-9ac-hj-np-z]+)',
  );

  @override
  List<linkify.LinkifyElement> parse(
    List<linkify.LinkifyElement> elements,
    linkify.LinkifyOptions options,
  ) {
    final out = <linkify.LinkifyElement>[];
    for (final el in elements) {
      if (el is linkify.TextElement) {
        out.addAll(_splitText(el.text));
      } else {
        out.add(el);
      }
    }
    return out;
  }

  List<linkify.LinkifyElement> _splitText(String text) {
    final out = <linkify.LinkifyElement>[];
    var last = 0;
    for (final m in _regex.allMatches(text)) {
      if (m.start > last) {
        out.add(linkify.TextElement(text.substring(last, m.start)));
      }
      final full = m.group(0)!;
      final id = m.group(2)!;
      out.add(_MentionElement(full, id));
      last = m.end;
    }
    if (last < text.length) {
      out.add(linkify.TextElement(text.substring(last)));
    }
    if (out.isEmpty) return [linkify.TextElement(text)];
    return out;
  }
}
