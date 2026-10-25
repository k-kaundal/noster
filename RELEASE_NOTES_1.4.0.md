# NostrFeed Android 1.4.0 (build 11) — Release Notes

Build: `flutter build appbundle --release --dart-define-from-file=.env`
Output: `flutter_app/build/app/outputs/bundle/release/app-release.aab`

## Highlights

### In-app local relay (ADR-0007, complete)
- The app now embeds a real NIP-01 relay: feed, profiles, notifications,
  comments, threads, articles, market, live, calendar, groups, lists,
  bookmarks, videos, hashtags all read **local-first** from the on-device
  SQLite store with remote relays as the network backstop.
- Offline works: cached pages render instantly, relays supplement in
  parallel.
- One oracle-tested filter engine + NIP-01 lifecycle (ephemeral skip,
  replaceable/addressable newest-wins, NIP-09 deletions honored, NIP-40
  expiry, case-insensitive hashtags).

### NIP-77 negentropy sync
- Reconnects and background catch-ups reconcile **set differences** instead
  of re-pulling windows — a few KB after a 12 h gap.

### Background sync (Play-safe, Android 15-compliant)
- Opt-in "Stay synced (faster)" in Settings: bounded sync windows via
  WorkManager → dataSync foreground service (6 h/day budget respected,
  degrades gracefully under Doze/OEM killers). Hourly periodic catch-up
  stays the default.

### Notifications fixed ("again and again")
- An event fires a phone notification **exactly once ever** (persisted
  dedup set — restart replays can't re-notify).
- Bursts collapse Instagram-style: "Alice and 5 others liked your post"
  instead of 30 separate alerts. DMs collapse per sender.

### Navigation & discovery
- Every route now has an entry point: Explore "Browse" chips (Trending,
  Reels, Articles, Calendar, Communities, Groups, Live, Market, Lists) and
  a full "Browse" launcher in the You hub (Articles / Reels / Communities /
  Groups / Calendar / Live / Market / P2P / Bounties / Sats Drops).

### UI polish
- NWC wallet-connect redesigned: brand-gradient hero, larger type/touch
  targets, wallet-brand chips, responsive max-width on tablets.
- All text-field icons standardized to Material's 18 px scale.
- New `group` / `qr` icons (fixed missing-asset crashes).

## Bug fixes
- **Addressable events data loss**: a late older version of an article /
  list / community could wipe the newer one — fixed with exact d-tag
  comparison.
- **Limit semantics**: per-filter NIP-01 union bounds.
- **Database lock stalls**: two-path ingest (fast chunked batches for
  regular kinds, per-event transactions for lifecycle kinds).
- **Hashtag case**: `#Nostr` ≡ `#nostr` everywhere (identity tags stay
  case-sensitive).
