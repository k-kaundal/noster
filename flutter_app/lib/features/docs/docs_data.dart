import 'package:flutter/material.dart';

/// One section of an in-app guide: a heading plus paragraphs.
class DocSection {
  final String heading;
  final List<String> paragraphs;
  const DocSection(this.heading, this.paragraphs);
}

/// An in-app guide. [route] deep-links the card to a feature instead of the
/// reader when the guide is really "open this screen".
class AppDoc {
  final String title;
  final String description;
  final String category;
  final IconData icon;
  final List<DocSection> sections;
  final String? route;

  const AppDoc({
    required this.title,
    required this.description,
    required this.category,
    required this.icon,
    this.sections = const [],
    this.route,
  });
}

const docCategories = [
  'All',
  'Getting Started',
  'Nostr',
  'Features',
  'Creators',
  'Wallet',
  'Privacy',
];

/// The guides. User-facing — they explain what a thing IS and how to use it,
/// not how it is implemented (that lives in AGENTS.md and docs/).
const appDocs = [
  // ── Getting started ──────────────────────────────────────────────
  AppDoc(
    title: 'Getting Started with NostrFeed',
    description:
        'Create an account, set up your profile, and publish your first post.',
    category: 'Getting Started',
    icon: Icons.rocket_launch,
    sections: [
      DocSection('Your key is your account', [
        'NostrFeed has no usernames or passwords. When you sign up you get a '
            'key pair: an npub (your public address, safe to share) and an '
            'nsec (your secret key — it signs everything you do).',
        'Anyone holding your nsec IS you, as far as the network is '
            'concerned. Back it up from the Identity screen the moment you '
            'create it; there is no "forgot password" flow to save you.',
      ]),
      DocSection('Set up your profile', [
        'Open your profile and add a name, a picture and a short bio. This '
            'is a plain Nostr event — every client on the network reads the '
            'same one, so the profile you set here follows you everywhere.',
      ]),
      DocSection('Publish your first post', [
        'Tap the center Create button and write something. Posts go to your '
            'relays and appear in the feeds of everyone who follows you.',
        'To be found, follow a few people first — the Home feed is built '
            'from who you follow, and Explore shows what the wider network '
            'is talking about.',
      ]),
      DocSection('Get a name people can read', [
        'A fresh account has a generated address (u + random characters). It '
            'receives zaps from minute one, but it says nothing about who '
            'you are.',
        'From the Wallet or Premium screen you can buy a verified name like '
            'you@nostrfeed.com. That puts a ✓ next to your posts and unlocks '
            'Premium features like the Studio.',
      ]),
    ],
  ),

  // ── Nostr ────────────────────────────────────────────────────────
  AppDoc(
    title: 'What is Nostr?',
    description:
        'An introduction to the Nostr protocol, keys, relays, and decentralized identity.',
    category: 'Nostr',
    icon: Icons.hub,
    sections: [
      DocSection('A protocol, not a platform', [
        'Nostr is an open protocol for publishing signed messages. No '
            'company runs it, no account can be suspended by an admin, and '
            'no algorithm decides what you may say to your own followers.',
        'NostrFeed is one client of many. The same key and the same posts '
            'work in Damus, Amethyst, Primal and every other client — you '
            'are never locked in.',
      ]),
      DocSection('Keys instead of accounts', [
        'Your identity is a cryptographic key pair. The npub is your public '
            'address; the nsec is the secret that proves posts are yours. '
            'There is no database of users — a post is verified by checking '
            'its signature against the key.',
      ]),
      DocSection('Relays instead of servers', [
        'Relays are simple stores that hold and forward your events. You '
            'publish to several, and readers fetch from several. If one '
            'relay goes down or censors you, the others still have '
            'everything — you can change relays without losing a follower.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Understanding Your Keys',
    description:
        'How npub and nsec keys work, how to keep them safe, and what to do if you lose them.',
    category: 'Nostr',
    icon: Icons.key,
    sections: [
      DocSection('npub vs nsec', [
        'Your npub starts with "npub1" and is public — share it freely; it '
            'is how people find and follow you.',
        'Your nsec starts with "nsec1" and is secret. It signs your posts, '
            'your messages, your payments metadata — everything. Pasting it '
            'anywhere hands over your whole identity.',
      ]),
      DocSection('Back it up once, properly', [
        'Export your key from the Identity screen and store it somewhere '
            'offline — a password manager, an encrypted drive, paper in a '
            'safe. Not in a screenshot gallery, not in a chat with '
            'yourself.',
      ]),
      DocSection('If you lose it', [
        'A lost nsec is a lost identity: the posts stay on the relays, but '
            'nobody — including you — can ever post as that key again. Your '
            'only move is a new key and telling your followers.',
        'A leaked nsec is worse: move to a new key immediately and announce '
            'it from the old one while you still can.',
      ]),
      DocSection('Read-only browsing', [
        'You can log in with just an npub to look around without any key on '
            'the device. Read-only mode can browse but cannot post, zap or '
            'message.',
      ]),
    ],
  ),

  // ── Creators ─────────────────────────────────────────────────────
  AppDoc(
    title: 'Creator Studio',
    description:
        'Your earnings dashboard: what you earned, from zaps, memberships and goals.',
    category: 'Creators',
    icon: Icons.dashboard,
    route: '/studio',
    sections: [
      DocSection('What the Studio shows', [
        'The Studio answers one question: what did you earn, and where from. '
            'The earnings chart, the payment count and the zapper count are '
            'all built from zap receipts — the public proof each payment '
            'leaves on the relays.',
        'Pick 7, 30 or 90 days to compare against the previous period. A '
            'receipt that fails verification is counted and shown as '
            'refused, so the figure you quote is one you can defend.',
      ]),
      DocSection('Premium feature', [
        'The Studio is a Premium feature: it opens with a paid, verified '
            'NIP-05 name. The reason is the same one that prices the name — '
            'a creator asks strangers for money on an open protocol, and a '
            'paid name is the cheapest honest signal that there is a person '
            'behind the ask.',
        'Get a name from the Premium screen and the Studio unlocks.',
      ]),
      DocSection('The two earning tools', [
        'Memberships are recurring support: you publish tiers, supporters '
            'pay one period at a time, and every payment is publicly '
            'verifiable.',
        'Zap goals are one-off fundraisers: a target, a progress bar, and '
            'an announcement post that collects the zaps.',
        'Both live in the Studio and on the Memberships screen.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Memberships & Subscriptions',
    description:
        'Sell subscription tiers to your supporters, or subscribe to the creators you read.',
    category: 'Creators',
    icon: Icons.card_membership,
    route: '/memberships',
    sections: [
      DocSection('How a subscription works', [
        'A subscription here is a zap to a tier. The creator publishes a '
            'tier — a name, a price in sats, a period — and subscribing is '
            'paying it. The receipt the payment leaves on the relays IS the '
            'subscription: signed, public, and checkable by anyone.',
        'There is no membership table to trust and nothing to fake: a '
            'receipt the creator’s own lightning server did not sign is not '
            'counted.',
      ]),
      DocSection('Selling tiers (Premium)', [
        'Open Memberships, tap New tier, and set a name, a price and a '
            'period (week, month or year), plus the perks a subscriber '
            'gets. Editing the tier later keeps its identity — supporters’ '
            'standing carries over.',
        'You can watch supporters, run rate and lifetime totals from '
            'Memberships or the Studio.',
      ]),
      DocSection('One payment, one period', [
        'Nothing charges anyone on a schedule — no app on this protocol '
            'can. Each payment covers exactly one period, and renewal is '
            'your supporter deciding again.',
        'A payment has to cover the full price to start a period. Smaller '
            'payments are tips — real money, and shown as such — but three '
            'tips do not add up to a month. If you are short, the app says '
            'by how much.',
      ]),
      DocSection('Subscribing to someone', [
        'Anyone can subscribe — no Premium needed. Find a creator’s tier, '
            'tap Subscribe, and pay with any wallet. Your standing (active, '
            'days left, lapsed) is computed from your own receipts and is '
            'the same answer the creator sees.',
        'To stop, simply do not pay the next period. That is the only '
            'cancellation there is — and it always works.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Zap Goals',
    description:
        'Set a fundraising target and let supporters zap toward it.',
    category: 'Creators',
    icon: Icons.track_changes,
    route: '/studio',
    sections: [
      DocSection('What a goal is', [
        'A zap goal is a public fundraising target (NIP-75): a title, an '
            'amount in sats, and a progress bar anyone can fund by zapping '
            'it. Use it for equipment, events, a milestone — anything with '
            'a number on it.',
      ]),
      DocSection('Creating one', [
        'From the Studio, tap New goal: set the title, the target in sats, '
            'and what it is for. Goals are a Premium feature, like the rest '
            'of the seller side of the Studio.',
      ]),
      DocSection('Getting it funded', [
        'A goal on its own appears in no feed. Tap the megaphone on your '
            'goal to announce it in a post — zaps on that post count toward '
            'the goal, in every client, including ones that have never '
            'heard of zap goals.',
        'The bar counts only verified receipts inside the goal’s window, '
            'and says so when a payment was set aside — a funded bar that '
            'did not move is always explained.',
      ]),
      DocSection('After the target', [
        'A goal stays fundable after it is reached — over-funding is '
            'normal. Only an optional deadline closes the count. Retiring a '
            'goal asks relays to delete it; sats already sent are yours '
            'and are not affected.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Premium & Verified Names',
    description:
        'What Premium unlocks, and how a verified NIP-05 name works.',
    category: 'Creators',
    icon: Icons.workspace_premium,
    route: '/premium',
    sections: [
      DocSection('What you get', [
        'A verified name (you@nostrfeed.com) with the ✓ every client shows, '
            'a lightning address at the same name so people can pay you, '
            'and access to the paid relay.',
        'Premium also unlocks the seller side of the app: the Creator '
            'Studio, subscription tiers, zap goals, and remote-signer '
            'tools (Nostr Bunker, NWC Provider).',
      ]),
      DocSection('What a verified name is', [
        'NIP-05 is the protocol’s naming system: a domain you trust vouches '
            'that a name points at your key. Clients check it by asking the '
            'domain, which is why the ✓ shows up everywhere, not just here.',
        'Names are sold by the year. A reserved-but-unpaid name grants '
            'nothing — it goes live when the invoice settles, and it needs '
            'renewing before it lapses.',
      ]),
      DocSection('The free tier stays useful', [
        'Every account gets a working lightning address for free — you can '
            'receive zaps from your first minute. What Premium buys is the '
            'name, the verification, and the creator tools.',
      ]),
    ],
  ),

  // ── Wallet ───────────────────────────────────────────────────────
  AppDoc(
    title: 'Connecting a Wallet',
    description:
        'Set up your Lightning wallet to send and receive zaps using NWC or the built-in wallet.',
    category: 'Wallet',
    icon: Icons.account_balance_wallet,
    sections: [
      DocSection('Three ways to pay', [
        'The built-in wallet is the one-tap option: a custodial Lightning '
            'wallet created for you, ready immediately.',
        'NWC (Nostr Wallet Connect) links an external wallet — Alby, Zeus, '
            'Wallet of Satoshi and others — by pasting a '
            'nostr+walletconnect:// URI. Your sats stay in your own wallet; '
            'the app just asks it to pay.',
        'Cashu ecash is the private option: bearer tokens from a mint, '
            'spent like digital cash.',
      ]),
      DocSection('Receiving', [
        'Your lightning address (you@nostrfeed.com on the paid tier, the '
            'generated one on the free tier) receives any amount, any time. '
            'The Receive sheet can also mint a one-off invoice for an exact '
            'amount and watches it flip to "Received" when it settles.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Sending & Receiving Zaps',
    description:
        'How Lightning zaps work on Nostr and how to zap content you love.',
    category: 'Wallet',
    icon: Icons.bolt,
    sections: [
      DocSection('What a zap is', [
        'A zap is a Lightning payment with a receipt attached (NIP-57). You '
            'pay the author’s lightning address; their server publishes a '
            'signed receipt naming the post and the amount. That receipt is '
            'what feeds, profiles and Studios count.',
      ]),
      DocSection('Zapping', [
        'Tap the bolt on any post or profile, pick an amount, add a message '
            'if you like, and pay with any connected wallet. Copy the '
            'invoice or scan the QR to pay from a wallet on another device '
            '— it always works.',
      ]),
      DocSection('Why a zap might not show', [
        'A zap counts when its receipt verifies against the recipient’s '
            'lightning server. If their server does not support zaps, the '
            'payment still reaches them — but no receipt is published, so '
            'it appears on no post. The app says so when that happens.',
      ]),
    ],
  ),

  // ── Features ─────────────────────────────────────────────────────
  AppDoc(
    title: 'Communities & Groups',
    description:
        'Create or join communities, moderate content, and participate in group chats.',
    category: 'Features',
    icon: Icons.groups,
    sections: [
      DocSection('Communities', [
        'Communities are public spaces around a topic (NIP-72). Posts '
            'tagged for a community appear on its page after moderator '
            'approval — joining one adds it to your profile’s Communities '
            'tab.',
      ]),
      DocSection('Groups', [
        'Groups are smaller, relay-hosted rooms (NIP-29) with real-time '
            'chat. They can be open or closed, public or private; admins '
            'manage members and can remove messages.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Writing Long-Form Articles',
    description:
        'Publish markdown articles on Nostr using kind 30023. Covers formatting and images.',
    category: 'Features',
    icon: Icons.article,
    sections: [
      DocSection('Articles vs posts', [
        'Articles are markdown documents with a title, a summary and a '
            'cover image (NIP-23). They are addressable forever — editing '
            'replaces the same address rather than posting a copy.',
        'Feeds show articles as preview cards; the full piece opens in the '
            'reader.',
      ]),
      DocSection('Verified names only', [
        'Long-form publishing requires a verified (paid) name. Articles '
            'carry more weight than notes and stay addressable forever — '
            'the name is the cheapest honest signal that a person stands '
            'behind one.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Bookmarks & Lists',
    description:
        'Save posts for later and organize your favorite accounts into curated lists.',
    category: 'Features',
    icon: Icons.bookmark,
    sections: [
      DocSection('Bookmarks', [
        'Bookmark any post from its menu to find it later under Bookmarks. '
            'Bookmarks are standard Nostr lists — they sync across every '
            'client that reads them.',
      ]),
      DocSection('Follow sets', [
        'Lists (NIP-51 follow sets) group accounts by topic. A list has '
            'its own feed — posts only from its members — so you can read '
            '"just the photographers" without unfollowing anyone.',
      ]),
    ],
  ),

  // ── Privacy ──────────────────────────────────────────────────────
  AppDoc(
    title: 'Privacy Best Practices',
    description:
        'Understand what data is public on Nostr and how to protect your privacy.',
    category: 'Privacy',
    icon: Icons.privacy_tip,
    sections: [
      DocSection('Assume it is public', [
        'Posts, follows, likes, zaps and profile data are public events, '
            'copied to many relays. Deletion is a request relays may honor '
            '— never a guarantee. Do not publish anything you could not '
            'live with being permanent.',
      ]),
      DocSection('Private messages', [
        'DMs are encrypted to the recipient (NIP-17). Relays store the '
            'ciphertext, not the content — but metadata (who talks to whom, '
            'roughly when) is still visible, as with any messaging system.',
      ]),
      DocSection('Payments', [
        'Lightning payments do not name you on-chain, but a zap receipt '
            'publicly links your key to what you funded. For privacy, plain '
            'wallet payments leave no Nostr receipt; Cashu ecash leaves no '
            'link at all.',
      ]),
    ],
  ),
  AppDoc(
    title: 'Read-Only Mode',
    description:
        'Browse Nostr without a private key using read-only npub login.',
    category: 'Privacy',
    icon: Icons.visibility,
    sections: [
      DocSection('Browse without a key', [
        'Logging in with an npub alone puts the app in read-only mode: '
            'full browsing, zero signing. Nothing secret ever touches the '
            'device — useful on a shared phone or a quick look.',
        'Post, zap and message buttons are disabled. Log in with your nsec '
            '(or a bunker) when you want to act.',
      ]),
    ],
  ),
];
