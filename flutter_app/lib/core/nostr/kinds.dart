/// Kind numbers for every event type this app publishes or reads, plus the
/// NIP-01 storage classification.
///
/// Before this, kind numbers were magic literals scattered across features
/// (`37001` in memberships, `9041` in studio, `kind: 5` for deletions in
/// two places, `kind == 9735` in zap code). A number with a name is the
/// whole point of a registry — a reader should not need the NIPs repo open
/// to know what a filter matches.
///
/// Classification follows NIP-01 ranges (nostr-tools `kinds.ts` pattern):
/// - Regular: 1000–9999 (+ 1, 2, 4, 6, 7, 8, 16, 40–44)
/// - Replaceable: 10000–19999 (+ 0, 3)
/// - Ephemeral: 20000–29999
/// - Addressable: 30000–39999
class NostrKinds {
  NostrKinds._();

  // ── Core (NIP-01) ──────────────────────────────────────────────────
  static const int profile = 0;
  static const int textNote = 1;
  static const int recommendRelay = 2;
  static const int contacts = 3;
  static const int dmLegacy = 4; // NIP-04, superseded by NIP-17
  static const int deletion = 5;
  static const int repost = 6;
  static const int reaction = 7;
  static const int badgeAward = 8;
  static const int genericRepost = 16;
  static const int picture = 20;
  static const int video = 21; // NIP-71 landscape
  static const int videoShort = 22; // NIP-71 portrait (reels)

  // ── Chat / groups ──────────────────────────────────────────────────
  static const int groupChatMessage = 9; // NIP-29
  static const int groupChatReply = 10;
  static const int groupThread = 11;
  static const int groupReply = 12;
  static const int seal = 13; // NIP-59
  static const int dmRumor = 14; // NIP-17 rumor
  static const int fileRumor = 15; // NIP-17 file
  static const int giftWrap = 1059; // NIP-59
  static const int comment = 1111; // NIP-22
  static const int liveChatMessage = 1311; // NIP-53

  // ── NIP-29 group admin ─────────────────────────────────────────────
  static const int groupAddUser = 9000;
  static const int groupRemoveUser = 9001;
  static const int groupEditMetadata = 9002;
  static const int groupAdminEvent = 9005;
  static const int groupDeleteEvent = 9005;
  static const int groupCreateInvite = 9009;
  static const int groupJoinRequest = 9021;
  static const int groupLeaveRequest = 9022;

  // ── Polls / badges / reporting ─────────────────────────────────────
  static const int poll = 1068; // NIP-88
  static const int pollResponse = 1018;
  static const int report = 1984; // NIP-56
  static const int badgeDefinition = 30009; // NIP-58
  static const int profileBadges = 30008;

  // ── Lists (NIP-51) ─────────────────────────────────────────────────
  static const int muteList = 10000;
  static const int pinnedNotes = 10001;
  static const int relayList = 10002; // NIP-65
  static const int bookmarks = 10003;
  static const int communities = 10004; // NIP-72 joined list
  static const int followSet = 30000; // NIP-51 follow set
  static const int relaySet = 30002;
  static const int bookmarkSet = 30003;
  static const int interestSet = 30015;

  // ── Zaps (NIP-57 / NIP-75) ─────────────────────────────────────────
  static const int zapGoal = 9041; // NIP-75
  static const int zapRequest = 9734;
  static const int zapReceipt = 9735;

  // ── Wallet / ecash (NIP-60/61) ─────────────────────────────────────
  static const int walletInfo = 17375;
  static const int walletToken = 7375;
  static const int walletHistory = 7376;
  static const int nutZap = 9321;
  static const int nutZapInfo = 10019;

  // ── Long-form / communities / calendar ─────────────────────────────
  static const int longForm = 30023; // NIP-23
  static const int longFormDraft = 30024;
  static const int community = 34550; // NIP-72 definition
  static const int communityApproval = 4550; // NIP-72 approval
  static const int calendarDate = 31922; // NIP-52
  static const int calendarTime = 31923;
  static const int calendarRsvp = 31925;

  // ── Live streaming (NIP-53) ────────────────────────────────────────
  static const int liveActivity = 30311;

  // ── Market / P2P ───────────────────────────────────────────────────
  static const int marketListing = 30018;
  static const int p2pOrder = 30019;

  // ── Subscriptions (unmerged draft — see NIP.md) ────────────────────
  static const int subscriptionTier = 37001;

  // ── NIP-29 group metadata ──────────────────────────────────────────
  static const int groupMetadata = 39000;
  static const int groupAdmins = 39001;
  static const int groupMembers = 39002;

  // ── NIP-42 / NIP-98 auth ───────────────────────────────────────────
  static const int relayAuth = 22242; // NIP-42
  static const int httpAuth = 27235; // NIP-98

  // ── App data (NIP-78) ──────────────────────────────────────────────
  /// Addressable app-specific data. The AI gateway config note uses this
  /// with d-tag `nostrfeed-ai-config`, signed by the operator pubkey.
  static const int appData = 30078; // NIP-78

  // ── Classification (NIP-01 ranges) ─────────────────────────────────

  /// Replaceable: latest version per (pubkey, kind) wins — 0, 3, and
  /// 10000–19999 (mute lists, relay lists, bookmarks…).
  static bool isReplaceable(int kind) =>
      kind == profile ||
      kind == contacts ||
      (kind >= 10000 && kind < 20000);

  /// Ephemeral: not stored by relays — 20000–29999 (auth events, etc).
  static bool isEphemeral(int kind) => kind >= 20000 && kind < 30000;

  /// Addressable (parameterized replaceable): latest per
  /// (pubkey, kind, d-tag) wins — 30000–39999 (articles, lists, tiers,
  /// calendars, market listings…).
  static bool isAddressable(int kind) => kind >= 30000 && kind < 40000;

  /// Regular: stored forever, every copy — 1000–9999 (notes, reactions,
  /// deletions, DMs, polls, reports…).
  static bool isRegular(int kind) =>
      !isReplaceable(kind) && !isAddressable(kind) && !isEphemeral(kind);
}
