import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

/// Shared context handed to every repository: the auth service plus a
/// live view of the current auth state.
///
/// Repositories use this to sign events without owning auth state
/// themselves (single source of truth stays in `NostrService`).
class NostrContext {
  final AuthService authService;
  final AuthState Function() _getAuth;

  NostrContext(this.authService, this._getAuth);

  AuthState get auth => _getAuth();
  bool get canSign =>
      auth.isLoggedIn && !auth.isReadOnly && auth.privateKey != null;

  void requireSigning() {
    if (!canSign) throw StateError('Must be logged in with signing key');
  }

  NostrEvent sign({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) {
    requireSigning();
    return authService.signEvent(
      privateKey: auth.privateKey!,
      kind: kind,
      content: content,
      tags: tags,
    );
  }
}
