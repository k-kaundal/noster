/// Universal share links — the HTTPS URL that opens the APP when installed
/// (Android App Link / iOS Universal Link) and a WEB PREVIEW when it isn't
/// (the site's `/api/preview` renders the post for anyone without the app).
///
/// The old share text was `nostr:note1…` — only Nostr clients understand
/// that scheme, so sharing to WhatsApp/Telegram/a browser/Play Store landed
/// as a dead string. A proper https:// link opens the app to the exact
/// thread when installed and degrades to a web page otherwise.
class ShareLinks {
  ShareLinks._();

  /// The public web origin the app links verify against. Keep in sync with
  /// `assetlinks.json` / the AASA file (they bind the app to this host).
  static const origin = 'https://nostrfeed.com';

  /// Post/thread link from a bech32 id (`note1…` or `nevent1…`).
  static String forNote(String bech32Id) => '$origin/$bech32Id';

  /// Profile link from a bech32 id (`npub1…` or `nprofile1…`).
  static String forProfile(String bech32Id) => '$origin/$bech32Id';
}
