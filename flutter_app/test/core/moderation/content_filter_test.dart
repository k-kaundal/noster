import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  String hex(String ch, int len) => List.filled(len, ch).join();

  NostrEvent event({
    required String content,
    List<List<String>> tags = const [],
    String? pubkey,
  }) =>
      NostrEvent(
        id: hex('e', 64),
        pubkey: pubkey ?? hex('a', 64),
        createdAt: 1700000000,
        kind: 1,
        tags: tags,
        content: content,
        sig: hex('s', 128),
      );

  const filter = ContentFilter();

  group('normalize', () {
    test('lowercases and strips diacritics', () {
      expect(ContentFilter.normalize('SëX'), 'sex');
      expect(ContentFilter.normalize('PÖRN'), 'porn');
    });

    test('digit evasion is caught by the digit-folded form', () {
      // normalize keeps digits (innocent tokens survive); the matcher
      // digit-folds a second form for matching. "p0rn" folds to "porn".
      expect(ContentFilter.normalize('p0rn'), 'p0rn');
      expect(
        filter.verdictForEvent(event(content: 'watch p0rn here')).action,
        FilterAction.hide,
      );
    });

    test('folds homoglyphs', () {
      // Cyrillic 'о' and 'р' in "роrn"
      expect(ContentFilter.normalize('роrn'), 'porn');
    });

    test('removes separator evasion', () {
      expect(ContentFilter.normalize('n.s.f.w'), 'nsfw');
      expect(ContentFilter.normalize('s_e_x'), 'sex');
      expect(ContentFilter.normalize('s-e-x'), 'sex');
    });

    test('collapses 3+ repeated letters to two', () {
      expect(ContentFilter.normalize('seeeex'), 'seex');
      expect(ContentFilter.normalize('goooood'), 'good');
    });

    test('repeat-collapse: "goooood" is not hidden', () {
      // Collapsing to two letters means "goooood" becomes "good" — a real
      // word that must never trip the filter. (A stretched explicit word
      // like "seeeex" becomes "seex" and does NOT match "sex" — catching it
      // would need substring matching, which is the false-positive tradeoff
      // this filter deliberately refuses.)
      expect(
        filter.verdictForEvent(event(content: 'goooood morning everyone')).action,
        FilterAction.show,
      );
      expect(
        filter.verdictForEvent(event(content: 'seeeex me up')).action,
        FilterAction.show,
      );
    });
  });

  group('media posts (reels/pictures)', () {
    // A reel's content IS a URL (the video) — the link-dump ratio must not
    // judge it, or every reel hides (the "all reels hidden by content
    // filter" bug).
    test('video + poster URLs do NOT hide a media post', () {
      // The reel-content case: 3 links covering ~98% of the post — this IS
      // the one the link-dump ratio catches without the media flag
      // (mostly-links requires ≥3 links).
      final e = event(
        content:
            'https://cdn.example/v/abc.mp4 https://cdn.example/v/abc.jpg https://cdn.example/v/abc.m3u8',
      );
      expect(
        filter.verdictForEvent(e, isMediaPost: true).action,
        FilterAction.show,
      );
      // …but WITHOUT the media flag, that same shape hides as mostly-links.
      expect(
        filter.verdictForEvent(e, isMediaPost: false).action,
        FilterAction.hide,
      );
    });

    test('explicit text in a reel caption still hides', () {
      final e = event(content: 'watch this porn https://cdn.example/x.mp4');
      expect(
        filter.verdictForEvent(e, isMediaPost: true).action,
        FilterAction.hide,
      );
    });

    test('hashtag stuffing on a reel still hides', () {
      // >8 combined hashtags is stuffing (raised from >5).
      final e = event(
        content: '#a #b #c #d #e #f #g #h #i https://cdn.example/x.mp4',
        tags: const [],
      );
      expect(
        filter.verdictForEvent(e, isMediaPost: true).action,
        FilterAction.hide,
      );
    });

    test('a reel caption with a few hashtags shows', () {
      final e = event(
        content: 'gm #bitcoin https://cdn.example/x.mp4',
      );
      expect(
        filter.verdictForEvent(e, isMediaPost: true).action,
        FilterAction.show,
      );
    });
  });

  group('event verdicts', () {
    test('clean post shows', () {
      expect(
        filter.verdictForEvent(event(content: 'gm everyone, happy Friday')).action,
        FilterAction.show,
      );
    });

    test('explicit English content hides', () {
      expect(
        filter.verdictForEvent(event(content: 'check out my onlyfans link')).action,
        FilterAction.hide,
      );
    });

    test('explicit Chinese content hides', () {
      expect(
        filter.verdictForEvent(event(content: '全国同城约炮，点击链接')).action,
        FilterAction.hide,
      );
    });

    test('explicit Japanese content hides', () {
      expect(
        filter.verdictForEvent(event(content: '裏垢女子 オフパコ募集')).action,
        FilterAction.hide,
      );
    });

    test('leetspeak evasion hides', () {
      expect(
        filter.verdictForEvent(event(content: 'my 0nlyf4ns')).action,
        FilterAction.hide,
      );
    });

    test('NIP-36 content-warning warns, not hides', () {
      expect(
        filter.verdictForEvent(
          event(
            content: 'some sensitive topic',
            tags: [
              ['content-warning', 'flashing images'],
            ],
          ),
        ).action,
        FilterAction.warn,
      );
    });

    test('#nsfw hashtag warns', () {
      expect(
        filter.verdictForEvent(
          event(
            content: 'new art',
            tags: [
              ['t', 'nsfw'],
            ],
          ),
        ).action,
        FilterAction.warn,
      );
    });

    test('search.html spam link hides', () {
      expect(
        filter.verdictForEvent(
          event(content: 'find singles https://x.com/search.html?q=hot'),
        ).reason,
        'search-link-spam',
      );
    });

    test('spam path variants hide', () {
      expect(
        filter.verdictForEvent(
          event(content: 'click https://spam.example/find.php?id=1'),
        ).action,
        FilterAction.hide,
      );
    });

    test('known spam host hides', () {
      expect(
        filter.verdictForEvent(
          event(content: 'join us https://t.me/chigualixing'),
        ).reason,
        'spam-host',
      );
    });

    test('link dump hides', () {
      // >4 links hides (raised from >3: a genuine 4-link share shows).
      expect(
        filter.verdictForEvent(
          event(
            content:
                'a https://a.com b https://b.com c https://c.com d https://d.com e https://e.com',
          ),
        ).reason,
        'link-dump',
      );
    });

    test('a genuine four-link share shows', () {
      expect(
        filter.verdictForEvent(
          event(
            content:
                'my recent posts: https://a.com/x https://b.com/y https://c.com/z and this thread https://d.com/w — feedback welcome',
          ),
        ).action,
        FilterAction.show,
      );
    });

    test('a single honest link shows', () {
      expect(
        filter.verdictForEvent(
          event(content: 'wrote about this here https://blog.example/post'),
        ).action,
        FilterAction.show,
      );
    });

    test('blocked author hides', () {
      const f = ContentFilter(blockedAuthors: {'deadbeef'});
      expect(
        f
            .verdictForEvent(
              event(content: 'hello', pubkey: 'deadbeef'),
            )
            .reason,
        'blocked-author',
      );
    });

    test('user blocked word hides', () {
      const f = ContentFilter(blockedWords: {'cryptoairdrop'});
      expect(
        f.verdictForEvent(event(content: 'free cryptoairdrop today')).action,
        FilterAction.hide,
      );
    });

    test('toggles disable their own categories', () {
      const off = ContentFilter(nsfwTermsEnabled: false);
      expect(
        off.verdictForEvent(event(content: 'check out my onlyfans link')).action,
        FilterAction.show,
      );

      const noSpam = ContentFilter(spamLinksEnabled: false);
      expect(
        noSpam
            .verdictForEvent(
              event(content: 'x https://a.com/search.html'),
            )
            .action,
        FilterAction.show,
      );
    });

    test('word-boundary: "sex" does not match "sexton" or "Essex"', () {
      expect(
        filter.verdictForEvent(event(content: 'driving through Essex today')).action,
        FilterAction.show,
      );
      expect(
        filter.verdictForEvent(event(content: 'the sexton rang the bell')).action,
        FilterAction.show,
      );
    });

    group('everyday words never hide (false-positive regressions)', () {
      // Each of these was on a term list and hid genuine posts — the
      // 2026-10-27 "real posts vanish" complaint. Pinned so they can't
      // come back.
      final innocent = <String>[
        'look at this meme',           // meme (Turkish "breast" collided with the internet word)
        'standing in the queue',       // queue (French slang collided with English)
        'take a bite of this',         // bite (French slang collided with English)
        'the chatter in the room',     // chatte prefix-matched "chatter"
        'the corridas de toros this weekend', // corridas (bullfights/races)
        'my mother is a janda',        // janda (Indonesian widow/divorcee)
        'orang dewasa saja',           // dewasa (Indonesian "adult")
        'dilihat dengan mata telanjang', // telanjang ("naked eye")
        'I want tteokbokki 떡볶이 so bad', // 떡 (rice cake!)
        '오피스텔에서 살아요',            // 오피 (officetel = apartment)
        '가슴이 아파요',                 // 가슴 (chest — "my chest hurts")
        'my bhabhi cooked dinner भाभी', // भाभी (sister-in-law)
        'นม กินนมเด็ก',               // นม (milk)
        'รับงานออกแบบ',               // รับงาน (freelance "taking design jobs")
        'đau ngực quá',               // ngực (chest pain)
        'nude lipstick is my favorite', // nude (fashion/makeup)
        'privacy advocate, building tools', // privacy (profiles/bios)
        'escorted by the police',      // escorts (police escorts)
        'sexting laws vary by state',  // sexting (discourse)
        'topless beaches in europe',   // topless (travel/fashion)
        'breastfeeding nipples hurt',  // nipples (anatomy)
        'playing the trumpet blasen',  // blasen (German wind instruments)
        'my goats kozy on the farm',   // kozy (Polish "goats")
        'un baiser pour toi',          // baiser (French "a kiss")
        'el cono de helado',           // cono (Spanish "cone")
        'batatas peladas',             // peladas (Portuguese "peeled")
      ];
      for (final text in innocent) {
        test('shows: "$text"', () {
          expect(
            filter.verdictForEvent(event(content: text)).action,
            FilterAction.show,
          );
        });
      }

      // The unambiguous vulgarity MUST keep hiding (store compliance).
      final explicit = <String>[
        'check out my onlyfans link',
        'watch p0rn here',
        '全国同城约炮，点击链接',
        '裏垢女子 オフパコ募集',
        'my 0nlyf4ns',
      ];
      for (final text in explicit) {
        test('hides: "$text"', () {
          expect(
            filter.verdictForEvent(event(content: text)).action,
            FilterAction.hide,
          );
        });
      }
    });
  });

  group('hashtag spam', () {
    test('hashtag-only anchor post hides', () {
      // The anchor suffix fires first (more specific shape).
      expect(
        filter.verdictForEvent(event(content: '#ziwei-comm-anchor')).action,
        FilterAction.hide,
      );
    });

    test('anchor-suffixed tag hides', () {
      expect(
        filter
            .verdictForEvent(event(content: 'news at #world-comm-anchor today'))
            .reason,
        'anchor-tag',
      );
    });

    test('hashtag anchor with one camouflage word hides', () {
      expect(
        filter
            .verdictForEvent(event(content: '#ziwei-comm-anchor #ziwei soon'))
            .action,
        FilterAction.hide,
      );
    });

    test('excessive hashtag stuffing hides', () {
      expect(
        filter
            .verdictForEvent(
              event(
                content:
                    'what a wonderful morning everyone #bitcoin #nostr #zap #gm #art #photo #music #news #crypto #btc',
              ),
            )
            .reason,
        'hashtag-stuffing',
      );
    });

    test('stuffing via t tags (not just content) hides', () {
      expect(
        filter
            .verdictForEvent(
              event(
                content: 'good read',
                tags: [
                  ['t', 'a'],
                  ['t', 'b'],
                  ['t', 'c'],
                  ['t', 'd'],
                  ['t', 'e'],
                  ['t', 'f'],
                  ['t', 'g'],
                  ['t', 'h'],
                  ['t', 'i'],
                ],
              ),
            )
            .reason,
        'hashtag-stuffing',
      );
    });

    test('a normal post with one hashtag shows', () {
      expect(
        filter
            .verdictForEvent(event(content: 'gm #nostr, who is building today?'))
            .action,
        FilterAction.show,
      );
    });

    test('a post with five hashtags shows (limit is >8)', () {
      expect(
        filter
            .verdictForEvent(
              event(content: '#a #b #c #d #e check this out everyone'),
            )
            .action,
        FilterAction.show,
      );
    });

    test('a genuine post with six hashtags shows', () {
      // The over-blocking case users hit: six real topic tags hid as
      // "stuffing" under the old >5 rule.
      expect(
        filter
            .verdictForEvent(
              event(
                content:
                    'gm! building today #bitcoin #nostr #zap #gm #art #photo',
              ),
            )
            .action,
        FilterAction.show,
      );
    });

    test('a lone #nsfw tag warns (author label beats spam shape)', () {
      expect(
        filter
            .verdictForEvent(
              event(
                content: '#nsfw',
                tags: [
                  ['t', 'nsfw'],
                ],
              ),
            )
            .action,
        FilterAction.warn,
      );
    });

    test('hashtag spam respects the spam toggle', () {
      const off = ContentFilter(spamLinksEnabled: false);
      expect(
        off.verdictForEvent(event(content: '#ziwei-comm-anchor')).action,
        FilterAction.show,
      );
    });
  });

  group('profile verdicts', () {
    test('clean profile shows', () {
      expect(
        filter
            .verdictForProfile(
              const NostrProfile(name: 'alice', about: 'building things'),
              'pk',
            )
            .action,
        FilterAction.show,
      );
    });

    test('explicit username hides', () {
      expect(
        filter
            .verdictForProfile(
              const NostrProfile(name: 'hotgirls4u'),
              'pk',
            )
            .action,
        FilterAction.hide,
      );
    });

    test('explicit bio hides', () {
      expect(
        filter
            .verdictForProfile(
              const NostrProfile(name: 'jane', about: 'dm for nudes'),
              'pk',
            )
            .action,
        FilterAction.hide,
      );
    });

    test('explicit foreign-language bio hides', () {
      expect(
        filter
            .verdictForProfile(
              const NostrProfile(name: 'mm', about: '兼职女 同城服务 加v'),
              'pk',
            )
            .action,
        FilterAction.hide,
      );
    });

    test('blocked profile hides', () {
      const f = ContentFilter(blockedAuthors: {'pk'});
      expect(
        f.verdictForProfile(const NostrProfile(name: 'anyone'), 'pk').reason,
        'blocked-author',
      );
    });
  });
}
