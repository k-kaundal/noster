# NostrFeed: Nostr Operating System for People, Creators & Communities
## Complete Feature Map & Information Architecture (v2.0)

**Version**: 2.0 (Strategic Expansion)  
**Date**: 2026-08-09  
**Status**: Comprehensive Product Blueprint  

---

## STRATEGIC VISION

NostrFeed is **not another Twitter clone**. It's a **Nostr-native operating system** that:

1. **Identity as OS**: One vault for npub, NIP-05, relays, signers, permissions, session management
2. **Community Economy**: Treasury + governance + bounties + memberships + marketplace built-in
3. **Lightning Social Graph**: See who follows whom AND who zapped whom AND who collaborates
4. **AI Intelligence Layer**: Search, discovery, summaries, recommendations, moderation everywhere
5. **Internet-native Payments**: Lightning disappears into the UX. Users think "support this" not "create LNURL"

```
                         NOSTRFEED OS
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
      IDENTITY            SOCIAL            COMMERCE
          │                  │                  │
    ┌─────┴─────┐      ┌─────┴─────┐     ┌─────┴─────┐
    │ Vault     │      │ Feed      │     │ Lightning │
    │ Signing   │      │ Graph     │     │ Products  │
    │ Relays    │      │ AI        │     │ Payments  │
    │ Apps      │      │ Discovery │     │ Bounties  │
    │ NIP-05    │      │ Communities     │ Treasury  │
    └───────────┘      └───────────┘     └───────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                      ┌──────┴──────┐
                      │   RELAYS    │
                      │ (Nostr Core)│
                      └─────────────┘
```

---

## FEATURE INVENTORY: 56 TOTAL FEATURES

### MVP (16 Features) — Weeks 1-4
Core social platform + wallet + identity

### Phase 2 (10 Features) — Weeks 5-8
Identity vault + AI layer + Community economy foundation

### Phase 3 (30 Features) — Weeks 9+
Full community economy + creator tools + developer platform

---

## PART 1: MVP FEATURES (16)

| # | Feature | System | Description |
|---|---------|--------|-------------|
| 1 | **Nostr Login** | Auth | NIP-07 + NIP-44 signing, multi-device, no passwords |
| 2 | **Profiles** | Social | Kind 0, name, bio, picture, banner, links |
| 3 | **Following** | Social | Kind 3, public follow list, discovery |
| 4 | **Posts** | Social | Kind 1, text + media, edit support |
| 5 | **Replies** | Social | Kind 1 (threaded), nested responses |
| 6 | **Reposts** | Social | Kind 6/16, boosting content |
| 7 | **Reactions** | Social | Kind 7, emoji reactions |
| 8 | **Media Upload** | Media | Blossom servers, images/videos in posts |
| 9 | **Search** | Discovery | FTS on posts, people, communities |
| 10 | **Notifications** | Social | Kind 1, NIP-98, real-time activity alerts |
| 11 | **Bookmarks** | Social | Kind 30003, save posts for later |
| 12 | **Nostr Wallet** | Wallet | LNbits custodial wallet, send/receive |
| 13 | **Zaps** | Lightning | NIP-57, LNURL-pay, emoji zaps |
| 14 | **Payment Links** | Creator | LNURL-pay, "Support KK" pages |
| 15 | **NIP-05 Identity** | Identity | Free nostrfeed.com addresses |
| 16 | **Communities** | Social | Kind 34550, basic groups + chat |

---

## PART 2: PHASE 2 FEATURES (10) — Core Differentiators

| # | Feature | System | Description | LNbits |
|---|---------|--------|-------------|--------|
| 17 | **Identity Vault** 🥇 | Identity | Signing devices, NIP-05, relays, apps, permissions, sessions | bunker/remote-signer |
| 18 | **Semantic AI Search** | Discovery | "Find people discussing AI agents" — returns people, posts, articles, events | AI + FTS |
| 19 | **Community Economy** | Communities | Members, treasury, chat, events, bounties, marketplace, subscriptions | wallet transactions |
| 20 | **Community Treasury** | Communities | Shared wallet with permission levels (admin, treasurer, moderator) | wallet, permissions |
| 21 | **Sats Drops** | Communities | LNURL-withdraw, claim mechanism for communities/creators | LNURL-withdraw |
| 22 | **Bounties** | Creator | Post problem + reward → solutions submitted → winner paid | payments |
| 23 | **Paid Memberships** | Creator | Recurring Lightning (1K, 5K, 10K sats/month) for communities/creators | wallet, recurring |
| 24 | **Live Streaming** | Media | WebRTC/HLS, chat, tip jar, Lightning tips during stream | livestream capability |
| 25 | **AI Daily Digest** | Discovery | Morning summary: top stories, developer updates, zaps, community news | AI + query |
| 26 | **Mini Apps** | Platform | Extension system for developers to build: polls, games, bots, analytics | LNbits extensions |

---

## PART 3: PHASE 3 FEATURES (30) — Full Platform

### Section A: Identity & Access (5 features)

| # | Feature | Description |
|---|---------|-------------|
| 27 | **App Permission Manager** | Connect app → see permissions (read events, publish, read DMs, sign payments) → approve/deny + expiry |
| 28 | **Verified Identity Badges** | Proof-of-ownership for npub, Twitter account, domain ownership |
| 29 | **Social Proof System** | Trust score by account age, account behavior, community reputation |
| 30 | **Session Management** | Manage active sessions, device list, revoke sessions, security logs |
| 31 | **Multi-Signer Support** | Use multiple signing devices (MacBook + iPhone + Hardware Wallet) simultaneously |

### Section B: Community Economy (9 features)

| # | Feature | Description |
|---|---------|-------------|
| 32 | **Community Governance** | Proposals → voting (on-chain via Nostr) → treasury impact → moderation elections |
| 33 | **Reputation System** | Multi-dimensional scoring: Trust, Technical, Helpful, Creator, based on activity + community votes |
| 34 | **Contribution Badges** | "Early Nostr Builder", "100 helpful replies", "1M sats received", "50 livestreams" |
| 35 | **Access Passes** | "AI Builders Pass" — valid until date, benefits (private posts, weekly calls, resources) |
| 36 | **Private Communities** | Public/Private/Invite-only/Paid/Token-gated options with LNURL-pay entry |
| 37 | **Community Store** | TPoS inventory system for communities selling digital/physical goods |
| 38 | **Referral System** | "Share this course, earn 10% commission" — tracking + payouts |
| 39 | **Affiliate Marketplace** | Products with commission rates — creators can resell others' courses/templates |
| 40 | **Marketplace** | Peer-to-peer store for creators selling products (PDFs, code, templates, courses) |

### Section C: Creator Tools (8 features)

| # | Feature | Description |
|---|---------|-------------|
| 41 | **Long-form Articles** | NIP-23 support: title, cover, content, code blocks, images, video, references |
| 42 | **Paid Articles** | Preview + "Unlock for 100 sats" paywall, payment splits to co-authors |
| 43 | **Paid Expert Chat** | Open conversation with creators for ⚡1,000/month subscription |
| 44 | **Creator Studio** | Analytics (followers, engagement, zaps), earnings breakdown by source |
| 45 | **AI Creator Copilot** | Writing tools: improve, summarize, translate, rewrite, generate title/hashtags, create variations |
| 46 | **Voice Posts** | Record audio → AI generates transcript, chapters, summary, searchable text |
| 47 | **Digital Downloads** | Sell ebooks, source code, datasets, templates, software, courses |
| 48 | **Social Sats System** | Thank (+100), Reward (+500), Bounty (1K-100K), Giveaway (claim sats) |

### Section D: Discovery & AI (5 features)

| # | Feature | Description |
|---|---------|-------------|
| 49 | **AI Nostr Assistant** | "What happened today?", "Find AI builders", "Who did I miss?", "Summarize #Bitcoin" |
| 50 | **Social Graph Explorer** | Visualize: you → @alice → @bob → @kk. "Why am I seeing this person?" |
| 51 | **Auto-Translation** | Post in English, reader picks Hindi/Thai/Japanese — instant translation |
| 52 | **Knowledge Base** | Save posts into Collections (Nostr Dev, AI Agents, Bitcoin) → AI summarizes collections |
| 53 | **Semantic Search** | "Decentralized AI agents" returns people, posts, articles, events (not keyword match) |

### Section E: Infrastructure & Developer (4 features)

| # | Feature | Description |
|---|---------|-------------|
| 54 | **Relay Health Dashboard** | Your relays: latency, write/read status, auto-select fastest healthy ones |
| 55 | **Relay Marketplace** | Discover public/lightning/developer/media/regional/private relays, subscribe to premium ones |
| 56 | **Developer Mode** | Console: inspect events, subscriptions, signing, NIP tools, raw JSON |
| 57 | **Nostr Event Inspector** | Paste nevent1... → shows kind, author, relays, signature validation, raw JSON |

---

## PART 4: STRATEGIC FEATURE MAPPING

### The 5 BIG Platform Pillars

```
1. IDENTITY VAULT (Feature 17)
   └── Single place for npub, NIP-05, relays, signing, apps, permissions
   └── Makes users feel they "own" their identity

2. COMMUNITY ECONOMY (Features 19-26, 32-40)
   └── Every community has: members, treasury, governance, bounties, marketplace
   └── Defensible vs Twitter clone — communities are the differentiator

3. LIGHTNING SOCIAL GRAPH (Invisible throughout)
   └── Not "make a payment" — payment is social action
   └── Follow @alice → @alice zapped you → @alice is in 4 communities
   └── Economic relationships as important as social ones

4. AI INTELLIGENCE LAYER (Features 18, 25, 45, 49-53)
   └── Search: semantic not keyword
   └── Discovery: daily digest, recommendations
   └── Creation: copilot for writing
   └── Assistant: natural language Nostr queries
   └── Makes the platform feel like an OS, not a feed

5. INTERNET-NATIVE PAYMENTS (Every feature)
   └── Posts can have tips → Articles can have paywalls → Communities can have subscriptions
   └── Lightning is infrastructure, not a feature
   └── Users never think "LNURL" — they think "support this"
```

### LNbits Capability → NostrFeed Feature Mapping

| LNbits | NostrFeed Feature(s) | Why It Matters |
|--------|----------------------|----------------|
| LNURL-pay | Payment Links (14), Zaps (13), Paid Articles (42), Paid Chat (43), Bounties (22) | Every monetization |
| LNURL-withdraw | Sats Drops (21), Withdrawals | Communities + creators |
| Wallet API | Wallet (12), Treasury (20), Memberships (23) | Core transactions |
| Livestream payments | Live Streaming (24), Live Tips | Creator revenue |
| TPoS | Marketplace (40), Store (37) | Product sales |
| Chat/DMs | Paid Expert Chat (43), Messages | Conversation monetization |
| Permissions | Identity (17), Treasury (20), App Manager (27) | Access control |
| Subscriptions | Memberships (23), Paid Chat (43), Access Passes (35) | Recurring revenue |
| Products | Digital Downloads (47), Marketplace (40) | Inventory system |
| Extensions | Mini Apps (26), Developer Mode (56) | Extensibility |

---

## PART 5: INFORMATION ARCHITECTURE (UPDATED)

### Main Navigation Structure v2.0

```
PRIMARY NAVIGATION (Updated for identity + communities + commerce)

├── 🏠 HOME
│   ├── Following Feed
│   ├── For You (AI-powered)
│   └── Global
│
├── 🧠 DISCOVER (Renamed from Explore)
│   ├── Trending
│   ├── AI Search
│   ├── Daily Digest
│   ├── People
│   ├── Communities
│   ├── Live
│   ├── Relay Market (NEW)
│   └── Social Graph (NEW)
│
├── 👥 COMMUNITIES (Full economy)
│   ├── My Communities
│   ├── Discover
│   ├── Treasury (NEW)
│   ├── Governance (NEW)
│   ├── Bounties (NEW)
│   └── Marketplace (NEW)
│
├── 🔴 LIVE
│   ├── Now Streaming
│   ├── Scheduled
│   └── On Demand
│
├── 🛍 MARKETPLACE (Expanded)
│   ├── Products
│   ├── Services
│   ├── Digital Downloads (NEW)
│   ├── Courses (NEW)
│   ├── Trending
│   └── My Store (if seller)
│
├── 💰 CREATOR (Expanded)
│   ├── Dashboard
│   ├── Posts & Articles
│   ├── Go Live
│   ├── Bounties
│   ├── Studio Analytics
│   ├── Payment Links
│   ├── Products
│   ├── Memberships
│   └── Earnings
│
├── ⚡ WALLET
│   ├── Overview
│   ├── Send / Receive
│   ├── Transaction History
│   ├── My Memberships
│   ├── Access Passes
│   └── Settings
│
├── 💬 MESSAGES
│   ├── Conversations
│   ├── Expert Chat (NEW)
│   └── Requests
│
├── 🔔 ACTIVITY
│   ├── Notifications
│   ├── Mentions
│   ├── Zaps
│   ├── Follows
│   └── Replies
│
├── 🟣 IDENTITY (NEW - Top priority)
│   ├── Vault
│   │   ├── Signing Devices
│   │   ├── NIP-05
│   │   ├── Relays
│   │   ├── Connected Apps
│   │   └── Permissions
│   └── Session History
│
└── 👤 PROFILE & SETTINGS
    ├── My Profile
    ├── Edit Profile
    ├── Account Settings
    ├── Privacy & Safety
    ├── Notification Preferences
    └── Logout
```

---

## PART 6: KEY PAGES & LAYOUTS (UPDATED)

### NEW: IDENTITY VAULT PAGE

```
┌────────────────────────────────────────────────────────┐
│ 🟣 Identity Vault                                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│ YOUR NOSTR IDENTITY                                    │
│                                                        │
│ npub1abc123... [Copy]                                  │
│ kk@nostrfeed.com ✓                                     │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 🔐 SIGNING DEVICES                                     │
│                                                        │
│ MacBook         ✓ Active   [Revoke]                    │
│ iPhone          ✓ Active   [Revoke]                    │
│ Hardware Wallet ✓ Offline  [Revoke]                    │
│ Nostr Extension ✓ Active   [Revoke]                    │
│                                                        │
│ [+ Add New Device]                                     │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 🔗 RELAYS                                              │
│                                                        │
│ relay.nostr.band    [Read] [Write] [Status: 🟢]       │
│ relay.damus.io      [Read] [Write] [Status: 🟢]       │
│ relay.primal.net    [Read]         [Status: 🟢]       │
│                                                        │
│ [+ Add Relay]  [Optimize]                              │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 🧩 CONNECTED APPS (4 apps)                            │
│                                                        │
│ NostrFeed                                              │
│ Reads: events, DMs  |  Writes: posts                  │
│ Expires: Never     [Manage] [Revoke]                  │
│                                                        │
│ NDK App                                                │
│ Reads: events      |  Writes: none                    │
│ Expires: 90 days   [Manage] [Revoke]                  │
│                                                        │
│ MyWebsite                                              │
│ Reads: profile, events  |  Writes: events             │
│ Expires: 7 days    [Manage] [Revoke]                  │
│                                                        │
│ [+ Connect New App]                                    │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ SESSION HISTORY                                        │
│                                                        │
│ Aug 9, 2026  10:42 AM   MacBook      Sign-in         │
│ Aug 9, 2026  08:15 AM   iPhone       Approve App     │
│ Aug 8, 2026  11:30 PM   Extension    Publish Post    │
│                                                        │
│ [View All] [Security Log]                             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### NEW: COMMUNITY TREASURY PAGE

```
┌────────────────────────────────────────────────────────┐
│ 👥 Nostr Developers  •  Treasury                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│ BALANCE                                                │
│                                                        │
│          ⚡ 4,820,000 sats                             │
│                                                        │
│ Monthly Income: +820K   |   Monthly Expenses: -240K    │
│ Net: +580K              |   Growth: +16.2%             │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ TREASURY MEMBERS                                       │
│                                                        │
│ KK        Admin         Can: view, receive, send, vote │
│ Alice     Treasurer     Can: view, receive, send       │
│ Bob       Moderator     Can: view only                 │
│ Carol     Member        Can: view (balance only)       │
│                                                        │
│ [+ Add Member] [Manage Roles]                          │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ RECENT TRANSACTIONS                                    │
│                                                        │
│ +100K  Member dues (12 x $8.33/mo)                    │
│ +50K   Bounty solutions                               │
│ -80K   Server hosting                                 │
│ -20K   Moderator stipends                             │
│                                                        │
│ [View All]                                             │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│ GOVERNANCE                                             │
│                                                        │
│ Proposal #42: "Spend 100K on community server"        │
│ YES: 82%  NO: 18%  [Vote]  Treasury Impact: 2.1%      │
│                                                        │
│ Proposal #41: "Elect Alice as new Treasurer"          │
│ YES: 94%  NO: 6%   [Closed]                           │
│                                                        │
│ [+ Create Proposal]                                    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### NEW: AI SEARCH PAGE

```
┌────────────────────────────────────────────────────────┐
│ 🧠 Semantic Search                                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│ [Find people discussing decentralized AI agents]      │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Find people discussing decentralized AI...         │ │
│ │ [Search]                                          │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ RESULTS                                                │
│                                                        │
│ 👥 PEOPLE (12 matches)                                │
│                                                        │
│ @alice      AI researcher, 2.4K followers             │
│ @bob        Developer, 1.8K followers                 │
│ @carol      Product, 3.1K followers                   │
│                                                        │
│ 📝 POSTS (48 matches)                                 │
│                                                        │
│ "Building an AI agent on Nostr..."                    │
│ by @alice  •  2 hours ago  •  82 zaps                 │
│                                                        │
│ "Decentralized AI architecture thoughts..."           │
│ by @bob  •  1 day ago  •  214 zaps                    │
│                                                        │
│ 📰 ARTICLES (5 matches)                               │
│                                                        │
│ "A Deep Dive into Nostr AI Agents"                    │
│ by @carol  •  Jul 29  •  1,200 zaps                   │
│                                                        │
│ 🎙️ EVENTS (3 matches)                                │
│                                                        │
│ "AI Agents Workshop" - Sep 15                         │
│ Community: Nostr Developers                           │
│                                                        │
│ 👥 COMMUNITIES (2 matches)                            │
│                                                        │
│ "AI Builders" - 5.2K members                          │
│ "Nostr Research" - 1.8K members                       │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## PART 7: MVP → PHASE 2 → PHASE 3 DEPLOYMENT PLAN

### Timeline: 12 Weeks

**Week 1-4: MVP (16 features)**
- Core social: posts, replies, reposts, following
- Auth: Nostr login + NIP-05
- Wallet: send, receive, zaps
- Communities: basic groups + chat
- Deploy on testnet first

**Week 5-8: Phase 2 (10 features) — Differentiators Launch**
- **Identity Vault** (Feature 17) — Major UX differentiation
- **AI Search** (Feature 18) — Semantic search + discovery
- **Community Economy** (Features 19-26) — Treasury, bounties, memberships, live
- **Mini Apps** (Feature 26) — Extension system unlocks developer ecosystem

**Week 9-12: Phase 3 (30 features) — Full Platform**
- Creator tools (articles, voice, copilot, downloads)
- Marketplace + store
- AI assistant + daily digest
- Relay marketplace
- Developer tools
- All community economy features

### Success Metrics

| Phase | Metric | Target |
|-------|--------|--------|
| MVP | Users | 1K |
| MVP | Profiles created | 500+ |
| MVP | Daily active users | 200+ |
| Phase 2 | Communities created | 50+ |
| Phase 2 | Sats flowing/month | 10M+ |
| Phase 3 | Creators earning | $1000+/month |
| Phase 3 | Monthly active users | 10K+ |

---

## PART 8: USER STORIES & FLOWS

### Identity Vault (Feature 17) Flow

```
User lands on NostrFeed
    ↓
"Let me set up my Nostr identity once"
    ↓
Go to Identity Vault
    ↓
See: npub, NIP-05, signing devices, relays, connected apps, permissions
    ↓
"Add signing device" (MacBook)
    ↓
System shows QR for bunker pairing
    ↓
MacBook signs confirmation
    ↓
Device appears in vault as "Active"
    ↓
User connects second device (iPhone)
    ↓
User adds relay (relay.primal.net)
    ↓
User connects external app (website.com)
    ↓
App requests: read events, publish
    ↓
User approves for 90 days
    ↓
Session logged in vault
    ↓
User feels: "This is MY Nostr identity, owned completely"
```

### Community Economy (Features 19-26) Flow

```
User creates community "AI Builders"
    ↓
Community gets treasury address
    ↓
User invites 10 members
    ↓
Members join via LNURL-withdraw (sats drop) or NIP-57 zap
    ↓
Community now has:
    • Members list
    • Chat (kind 11)
    • Discussion feed
    • Treasury (0 sats initially)
    ↓
User posts bounty: "Build AI agent tutorial (50K sats)"
    ↓
Member submits solution
    ↓
User approves solution
    ↓
System auto-pays 50K sats from treasury to winner
    ↓
User sets up membership: "1,000 sats/month for private posts"
    ↓
Members subscribe, payment recurs
    ↓
Treasury grows: 50K + 1K x 12 members = 62K sats
    ↓
User schedules live event
    ↓
Members watch, tip the stream
    ↓
Event ends, tips go to treasury
    ↓
User creates proposal: "Spend 100K on community server?"
    ↓
Members vote (yes 82%, no 18%)
    ↓
Proposal passes
    ↓
System deducts 100K from treasury
    ↓
Community feels: "We built this together, economically"
```

### Lightning Social Graph Discovery

```
User follows @alice (simple follow, kind 3)
    ↓
User zaps @alice 1,000 sats (kind 9734/9735)
    ↓
User joins @alice's community "AI"
    ↓
User tips @alice's livestream 500 sats
    ↓
System tracks: follow + zap + community + livestream
    ↓
User sees in social graph: @alice is my most engaged connection
    ↓
@alice's connection graph now shows:
    • Follows by @alice
    • Zaps received (weighted by amount)
    • Shared communities
    • Collaboration history
    ↓
Other users see: "This person receives consistent support"
    ↓
System recommends: "Follow @alice (you and 12 others tip her)"
    ↓
Discovery becomes economic, not just social
```

---

## PART 9: TECHNICAL IMPLEMENTATION NOTES

### Database Schema Additions (Phase 2+)

```sql
-- Identity Vault
CREATE TABLE signing_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT,
  signer_type TEXT, -- 'bunker', 'extension', 'hardware', 'local'
  last_used TIMESTAMP,
  is_active BOOLEAN,
  permissions JSON
);

CREATE TABLE relay_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  relay_url TEXT,
  read BOOLEAN,
  write BOOLEAN,
  added_at TIMESTAMP
);

-- Community Economy
CREATE TABLE community_treasury (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  balance_sats BIGINT,
  monthly_income BIGINT,
  monthly_expense BIGINT
);

CREATE TABLE treasury_members (
  id TEXT PRIMARY KEY,
  treasury_id TEXT NOT NULL,
  user_pubkey TEXT,
  role TEXT, -- 'admin', 'treasurer', 'moderator', 'member'
  permissions JSON
);

CREATE TABLE bounties (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  creator_pubkey TEXT,
  description TEXT,
  reward_sats BIGINT,
  deadline TIMESTAMP,
  status TEXT, -- 'open', 'closed', 'paid'
  winner_pubkey TEXT
);

-- Creator Monetization
CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  creator_pubkey TEXT,
  name TEXT,
  price_sats BIGINT,
  interval TEXT, -- 'daily', 'weekly', 'monthly'
  benefits TEXT
);

CREATE TABLE membership_subscriptions (
  id TEXT PRIMARY KEY,
  membership_id TEXT,
  subscriber_pubkey TEXT,
  started_at TIMESTAMP,
  next_charge TIMESTAMP,
  is_active BOOLEAN
);

-- AI / Search
CREATE TABLE semantic_embeddings (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  embedding VECTOR(1536), -- OpenAI embedding
  updated_at TIMESTAMP
);
```

### API Endpoints (Phase 2+)

```
Identity Vault:
POST   /api/v1/identity/devices
GET    /api/v1/identity/devices
DELETE /api/v1/identity/devices/:id

POST   /api/v1/identity/relays
GET    /api/v1/identity/relays
DELETE /api/v1/identity/relays/:id

GET    /api/v1/identity/apps
POST   /api/v1/identity/apps/:id/permissions
DELETE /api/v1/identity/apps/:id

Community Economy:
POST   /api/v1/communities/:id/treasury/proposal
GET    /api/v1/communities/:id/treasury/proposals
POST   /api/v1/communities/:id/treasury/vote
POST   /api/v1/communities/:id/bounty
GET    /api/v1/communities/:id/bounties
POST   /api/v1/bounties/:id/submit

Creator:
POST   /api/v1/memberships
GET    /api/v1/memberships/:id/subscribers
POST   /api/v1/articles
POST   /api/v1/voice-post/transcribe
POST   /api/v1/copilot/improve

Search & Discovery:
POST   /api/v1/search/semantic
GET    /api/v1/discovery/digest
GET    /api/v1/graph/social/:pubkey
GET    /api/v1/relays/health
```

---

## SUMMARY: Why This Matters

**MVP (16 features)** = Minimum social media app with wallet
**Phase 2 (10 features)** = Nostr-native OS feeling (Identity + AI + Economy)
**Phase 3 (30 features)** = Full creator + community + developer platform

By Week 8:
- Users have ONE place to manage their Nostr identity
- Communities can self-fund via treasury + memberships
- Search works semantically ("AI builders" not "keyword")
- First parties have reasons to stay (Mini Apps ecosystem)

By Week 12:
- NostrFeed is defensible against Twitter clone comparison
- Creators can earn full-time
- Communities are economically sovereign
- AI layer makes discovery work like an OS, not a feed
- Lightning is everywhere but invisible

**The North Star**: Users should never think "I'm using Nostr." They should think "I'm using NostrFeed OS."

