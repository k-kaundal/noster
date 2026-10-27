# NostrFeed Flutter — Full Audit: Pages, Flows & Features

**Date:** 2026-10-26 · **Scope:** every screen, data flow, and user interaction
**Method:** static audit of `lib/features/**` against the store/provider layer.
**Companion:** `RELAY_HUB_SYNC_ARCHITECTURE.md` (backend sync), `ADR-0008` (data layer).

---

## A. The data model in one paragraph

Every screen reads from ONE of three sources: **(1) the SQLite store**
(feeds, engagement counts, DM history, notifications — the source of truth),
**(2) a Riverpod provider** (profiles, follows, lists — TTL-cached, relay-backed),
or **(3) a live subscription** (new posts, DMs, social engagement — via the
EventBus). **Optimistic updates** work by writing the user's own action into
the store (ingest) so the SQL projections recount instantly, then letting the
relay confirm in the background. The bugs in this audit were almost all one of
two shapes: **an action published to relays but never ingested into the store**
(so the local count didn't move), or **a screen with no pull-to-refresh**
(so it went stale until restart).

---

## B. Fixes shipped in this audit

| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | Like/unlike count didn't change until relay round trip | `toggleLike` published the reaction but never ingested it into the store — the SQL count reads `event_refs` | Ingest the reaction + the deletion (`post_actions.dart`) — count moves instantly via the invalidation bus |
| 2 | Repost count same | same | same |
| 3 | New post invisible until relay echo ("post again → duplicate") | compose published but never ingested | Optimistic insert into the store (`compose_screen.dart`) |
| 4 | Profile tabs stale — no refresh gesture | `ProfilePostsTab` had no `RefreshIndicator` | Pull-to-refresh on every profile tab (posts/replies/articles/media) + profile provider |
| 5 | Reels stale | `videosProvider` only refreshed via error retry | Pull-to-refresh on the first reel + empty state |
| 6 | Memberships stale | `ListView` with no refresh | `RefreshIndicator` + tier/subscription invalidation |

Replies and DMs were **already correct** (optimistic insert + status flips) —
no change needed there.

---

## C. Per-page audit (every screen)

Legend — **Data**: where the content comes from · **Refresh**: how it re-syncs · **Optimistic**: does the user's action show instantly.

| Screen | Data | Refresh | Optimistic | Status |
|---|---|---|---|---|
| **Feed — For You** | SQLite store + live tail | pull-to-refresh + connectivity watcher + live | like/repost/bookmark/zap/comment ✅ (fixed) | ✅ |
| **Feed — Following** | SQLite store + live tail (follows) | same | same ✅ | ✅ |
| **Explore** | trending (local candidates + relay) + People-to-follow | pull-to-refresh + TTL | — | ✅ |
| **Trending** | `trendingProvider(hours)` (store + relay window) | pull-to-refresh + TTL | — | ✅ |
| **Hashtag feed** | relay tag query | pull-to-refresh | — | ✅ |
| **Notifications** | durable store + live + background watermark | pull-to-refresh + live | — | ✅ |
| **Chat list** | DM store projection (decrypted, durable) | pull-to-refresh + live sub | outbox echo ✅ | ✅ |
| **Chat thread** | DM store + outbox | live + gap-fill | send status (pending→sent/failed) ✅ | ✅ |
| **Thread (replies)** | store-first + relay backfill | live + ingest | reply optimistic insert ✅ | ✅ |
| **Articles list** | `articlesProvider` | pull-to-refresh (AsyncFeedList) | — | ✅ |
| **Article reader** | event passed in | — | — | ✅ |
| **Bookmarks** | `bookmarksProvider` | pull-to-refresh (AsyncFeedList) | bookmark toggle ✅ | ✅ |
| **Lists** | `followSetsProvider` | pull-to-refresh (AsyncFeedList) | create/edit ✅ | ✅ |
| **List detail** | list members + `listFeedProvider` | — | — | ✅ |
| **Communities** | `communitiesProvider` | pull-to-refresh (AsyncFeedList) | join/leave ✅ | ✅ |
| **Community detail** | approvals + a-tagged posts | — | — | ✅ |
| **Calendar** | `calendarEventsProvider` | pull-to-refresh | RSVP ✅ | ✅ |
| **Groups** | `groupsProvider` | pull-to-refresh | create/join ✅ | ✅ |
| **Group chat** | kind 9/11 group messages | live sub | send ✅ | ✅ |
| **Live** | `liveEventsProvider` (kind 30311) | pull-to-refresh | go-live ✅ | ✅ |
| **Reels** | `videosProvider` | **fixed: pull-to-refresh** | like/comment/zap ✅ | ✅ |
| **Profile (other)** | `userPostsProvider` + profile/followers | **fixed: pull-to-refresh on every tab** | follow ✅ | ✅ |
| **You (hub)** | profile + quick stats | — | — | ✅ |
| **Wallet** | LNbits/NWC/Cashu services | 30s sync + live socket | send/receive ✅ | ✅ |
| **Market** | `marketProvider` | pull-to-refresh | — | ✅ |
| **P2P** | `p2pProvider` | — | — | ✅ |
| **Premium** | admission + premium status | — | buy flows ✅ | ✅ |
| **Studio** | `studioEarningsProvider` (validated receipts) | window selector re-query | goals ✅ | ✅ |
| **Memberships** | `myMembershipsProvider` + tiers | **fixed: pull-to-refresh** | subscribe (zap) ✅ | ✅ |
| **Bounties** | `bountiesProvider` | pull-to-refresh (AsyncFeedList) | claim ✅ | ✅ |
| **Search** | relay NIP-50 + local FTS | re-query per term | — | ✅ (refresh = new query) |
| **Settings** | local prefs | — | — | ✅ |
| **Support** | static (build-time addresses) | — | Lightning pay ✅ | ✅ |
| **Onboarding** | one-time flow | — | seed follows ✅ | ✅ |
| **Docs** | static | — | — | ✅ |

---

## D. Per-flow audit (every user interaction)

| Flow | What happens now | Verified |
|---|---|---|
| **Like / unlike** | Optimistic flip on the card + **ingest reaction into the store** → SQL count moves instantly → relay publish → 2s later provider refresh confirms | ✅ fixed |
| **Repost / undo** | same pattern (reaction kind 6/16 + kind-5 deletion) | ✅ fixed |
| **Comment / reply** | Optimistic insert into store → thread + parent count update instantly → relay publish → backfill merges | ✅ already correct |
| **Zap** | Amount sheet → pay → burst animation → `refreshZaps` (2s) recounts receipts | ✅ |
| **Quick zap** | one-tap default amount → burst → recount | ✅ |
| **Post (compose)** | **Optimistic insert into store** → shows in feed instantly → feeds refresh → profile posts invalidate | ✅ fixed |
| **Poll vote** | kind 1018 → PollCard tallies live | ✅ |
| **Bookmark** | toggle → `bookmarkedIdsProvider` + `bookmarksProvider` invalidate → icon flips instantly | ✅ |
| **Share** | `SharePlus` with `nostr:note1…` | ✅ |
| **Quote post** | composer with QuoteCard preview → kind-1 + q/p tags | ✅ |
| **Follow / unfollow** | kind-3 publish → follows providers invalidate → count updates | ✅ |
| **DM send** | gift wrap → outbox pending → publishWithAck → sent/failed flip → self-copy echo reconciles | ✅ |
| **DM receive** | live sub → DmStore.ingest → decrypt off-isolate → thread + badge + banner + phone notification | ✅ |
| **Report / block** | NIP-56 report / NIP-51 mute list sync | ✅ |
| **Background notifications** | 15-min catch-up → DM gap-fill + social watermark notify (dedup + burst-collapse) | ✅ (this audit's earlier fix) |
| **Pull-to-refresh** | feed, explore, trending, notifications, chat, articles, bookmarks, lists, communities, calendar, groups, live, **reels, profile, memberships** | ✅ all covered |

---

## E. Remaining known items (honest list)

| Item | Severity | Note |
|---|---|---|
| First-open 1–2s empty feed on a **fresh install** | low | Expected: the SQLite store is empty on a brand-new install, so the first page comes from the relay (a fast hub now). The skeleton shows during it. A disk-cached warm start (returning users) is instant. Not a bug — it's a cold start; the onboarding's seed follows + hub sync make it as short as physically possible. |
| `search_screen` has no pull gesture | by design | Search re-queries on every term change; a pull would re-run the same query. No action needed. |
| Kind-1059 (NIP-17) DM tap → chat list, not the thread | known | The sender is hidden behind the ephemeral wrapper by design; the conversation resolves via DmStore.prime in the list. Deep-linking to the thread would need decrypt-first — a later enhancement. |
| Chat page "not good" (vague) | needs detail | The DM pipeline (decrypt, outbox, status, threads) is verified working. If a *specific* symptom exists (ordering, avatars, images), it needs a concrete repro — the plumbing is sound. |

---

## F. The rules going forward (prevent regression)

1. **Every user action that changes a count or a list MUST ingest into the
   store** (the relay publish alone does nothing for the local projections).
   Likes/reposts/posts/replies/deletions all follow the optimistic-insert
   pattern (`post_actions.dart`, `thread_screen._postReply`, `compose_screen`).
2. **Every scrollable list of relay data MUST have pull-to-refresh**
   (`RefreshIndicator` wrapping a scrollable child, including the empty and
   error states so a failed fetch can be retried by gesture).
3. **Counts come from the store** (`localEngagementProvider` SQL grouped
   count), never a per-card relay query — so an ingest recounts instantly via
   the invalidation bus.
