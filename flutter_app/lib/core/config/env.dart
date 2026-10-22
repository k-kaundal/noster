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

  // ── GetZap Identity API ────────────────────────────────────────────
  static const getzapApi = String.fromEnvironment(
    'GETZAP_API',
    defaultValue: 'https://api.getzap.me/v1',
  );

  // ── Default Relays ─────────────────────────────────────────────────
  static const defaultRelays = [
    'wss://relay.nostrfeed.com', // primary — our own relay
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
  ];

  /// Indexer relays for kind 0 / 10002 lookups.
  static const indexerRelays = [
    'wss://relay.nostrfeed.com', // our own relay first
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://purplepag.es',
    'wss://directory.yabu.me',
  ];

  /// Receipt relays for kind 9735 zap receipt queries.
  static const receiptRelays = [
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://nos.lol',
  ];

  /// Blossom upload servers (fallback defaults).
  static const defaultBlossomServers = [
    'https://blossom.band',
    'https://blossom.primal.net',
    'https://nostr.build',
  ];
}
