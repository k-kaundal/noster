/// Central environment / build-time configuration for NostrFeed Flutter.
///
/// Mirrors the web app's VITE_ environment variables. In Flutter these are
/// compile-time constants via --dart-define or defaults below.
class Env {
  // ── LNbits ──────────────────────────────────────────────────────────
  static const lnbitsUrl = String.fromEnvironment(
    'LNBITS_URL',
    defaultValue: 'https://ln.nostrfeed.com',
  );
  // SECURITY: No hardcoded credentials. These must be provided via
  // --dart-define at build time from CI secrets, never committed to git.
  static const lnbitsWalletId = String.fromEnvironment(
    'LNBITS_WALLET_ID',
    defaultValue: '',
  );
  static const lnbitsInvoiceKey = String.fromEnvironment(
    'LNBITS_INVOICE_KEY',
    defaultValue: '',
  );

  // ── Cashu ───────────────────────────────────────────────────────────
  static const cashuMintUrl = String.fromEnvironment(
    'CASHU_MINT_URL',
    defaultValue: 'https://mint.nostrfeed.com',
  );

  // ── Lightning Addresses ─────────────────────────────────────────────
  static const lightningAddressDomain = String.fromEnvironment(
    'LIGHTNING_ADDRESS_DOMAIN',
    defaultValue: 'ln.nostrfeed.com',
  );
  static const lightningAddressDomains = String.fromEnvironment(
    'LIGHTNING_ADDRESS_DOMAINS',
    defaultValue: '',
  );
  static const freeLightningAddressDomain = String.fromEnvironment(
    'FREE_LIGHTNING_ADDRESS_DOMAIN',
    defaultValue: '',
  );
  static const freeLightningAddressDomains = String.fromEnvironment(
    'FREE_LIGHTNING_ADDRESS_DOMAINS',
    defaultValue: '',
  );

  // ── NIP-05 Verified Names ──────────────────────────────────────────
  static const nip5DomainId = String.fromEnvironment(
    'NIP5_DOMAIN_ID',
    defaultValue: 'i3KUfyMGodpcVZqFqGf2Wx',
  );
  static const nip5Domain = String.fromEnvironment(
    'NIP5_DOMAIN',
    defaultValue: 'ln.nostrfeed.com',
  );
  static const nip5Domains = String.fromEnvironment(
    'NIP5_DOMAINS',
    defaultValue: '2sJcjWPRQEDinLcENtPtJs:getzap.me',
  );

  // ── Premium / Paid Relay ────────────────────────────────────────────
  static const premiumMonthlyLink = String.fromEnvironment(
    'PREMIUM_MONTHLY_LINK',
    defaultValue: '',
  );
  static const premiumLifetimeLink = String.fromEnvironment(
    'PREMIUM_LIFETIME_LINK',
    defaultValue: '',
  );
  static const paidRelay = String.fromEnvironment(
    'PAID_RELAY',
    defaultValue: 'wss://paid.nostrfeed.com',
  );
  static const paidRelayAdmission = String.fromEnvironment(
    'PAID_RELAY_ADMISSION',
    defaultValue: '',
  );

  // ── Fiat ────────────────────────────────────────────────────────────
  static const fiatProvider = String.fromEnvironment(
    'FIAT_PROVIDER',
    defaultValue: 'paypal',
  );
  static const premiumMonthlyFiatPlan = String.fromEnvironment(
    'PREMIUM_MONTHLY_FIAT_PLAN',
    defaultValue: '',
  );
  static const premiumLifetimeFiatPlan = String.fromEnvironment(
    'PREMIUM_LIFETIME_FIAT_PLAN',
    defaultValue: '',
  );

  // ── Blossom (Media Upload) ──────────────────────────────────────────
  static const blossomServers = String.fromEnvironment(
    'BLOSSOM_SERVERS',
    defaultValue: '',
  );

  // ── OpenRouter (AI) ────────────────────────────────────────────────
  // Direct-from-app key (no proxy server). The FREE-tier key can only call
  // `:free` models ($0 spend possible; keep its dashboard credit limit at 0).
  // A second, credit-capped paid key will be added for paid tiers later.
  // SECURITY: never commit a real key here. Put it in the gitignored
  // `.env` and build/run with `--dart-define-from-file=.env`.
  static const openRouterApiKey = String.fromEnvironment(
    'OPENROUTER_API_KEY',
    defaultValue: '',
  );
  static const openRouterBaseUrl = String.fromEnvironment(
    'OPENROUTER_BASE_URL',
    defaultValue: 'https://openrouter.ai/api/v1',
  );

  /// Operator pubkey (hex) that signs the AI gateway config note
  /// (kind 30078, d-tag `nostrfeed-ai-config`) — the app only trusts config
  /// from this key. Same key as the web app's ADMIN_PUBKEY (onboarding).
  static const operatorPubkey = String.fromEnvironment(
    'OPERATOR_PUBKEY',
    defaultValue:
        'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
  );

  /// The lightning address paid boosts are zapped to (NIP-57, `e`-tagging
  /// the promoted note). Its lnurl metadata's `nostrPubkey` is resolved at
  /// runtime and used to verify boost receipts — a receipt signed by any
  /// other key is not a boost. Must point at a pay link on the operator's
  /// LNbits (the house/operator wallet) with zaps enabled.
  static const platformLightningAddress = String.fromEnvironment(
    'PLATFORM_LIGHTNING_ADDRESS',
    defaultValue: 'boost@ln.nostrfeed.com',
  );

  // ── GetZap Identity API ────────────────────────────────────────────
  static const getzapApi = String.fromEnvironment(
    'GETZAP_API',
    defaultValue: 'https://api.getzap.me/v1',
  );

  // ── Default Relays ─────────────────────────────────────────────────
  // Our own relay FIRST (best latency + we control retention), then a
  // curated set of HEALTHY, free, well-run general relays. Sources: the
  // health-checked awesome-nostr-relays catalogue + nostr.watch + NostrMash
  // activity rankings. Deliberately excludes adult-oriented relays (store
  // compliance) AND dead relays — relay.nostr.band has been offline for a
  // long time (many stale guides still list it; a relay that never
  // connects is a top reason a fresh setup looks broken). Users can add
  // more from Settings → Relays; NIP-65 outbox routing layers per-user
  // relays on top.
  static const defaultRelays = [
    'wss://relay.nostrfeed.com', // our own relay — primary
    'wss://relay.damus.io', // most popular, fast, US
    'wss://nos.lol', // reliable, high activity share
    'wss://relay.primal.net', // highest activity share (NostrMash #1)
    'wss://relay.snort.social', // Snort's relay
    'wss://nostr.mom', // community-run, steady
    'wss://offchain.pub', // healthy, good coverage
    'wss://ditto.pub', // healthy, rising
    'wss://nostr.oxtr.dev', // healthy, open
  ];

  /// Indexer relays for kind 0 / 10002 lookups (NIP-50 search + metadata).
  /// nostr.band was the classic indexer but is dead — purplepag.es +
  /// coracle + yabu carry metadata indexing now.
  static const indexerRelays = [
    'wss://relay.nostrfeed.com', // our own relay first
    'wss://relay.primal.net',
    'wss://purplepag.es',
    'wss://indexer.coracle.social',
    'wss://directory.yabu.me',
  ];

  /// Receipt relays for kind 9735 zap receipt queries.
  static const receiptRelays = [
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://nostr.mom',
  ];

  /// Blossom upload servers (fallback defaults).
  static const defaultBlossomServers = [
    'https://blossom.band',
    'https://blossom.primal.net',
    'https://nostr.build',
  ];
}
