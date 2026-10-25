import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';

/// State for a file upload.
class UploadState {
  final bool isUploading;
  final String? error;

  const UploadState({
    this.isUploading = false,
    this.error,
  });

  UploadState copyWith({
    bool? isUploading,
    String? error,
    bool clearError = false,
  }) {
    return UploadState(
      isUploading: isUploading ?? this.isUploading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Notifier that uploads files via Blossom.
class UploadNotifier extends Notifier<UploadState> {
  @override
  UploadState build() => const UploadState();

  /// Upload an image picked from gallery/camera. Returns the public URL.
  Future<String> uploadImage(XFile file) async =>
      (await uploadImageDetailed(file)).url;

  /// Upload an image, returning the full [UploadResult] for imeta tags.
  Future<UploadResult> uploadImageDetailed(XFile file) async {
    state = state.copyWith(isUploading: true, clearError: true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final service = UploadService(nostr.authService, nostr);
      final result = await service.uploadImageDetailed(file);
      state = state.copyWith(isUploading: false);
      return result;
    } catch (e) {
      state = state.copyWith(isUploading: false, error: e.toString());
      rethrow;
    }
  }

  /// Upload a FILE as a stream — never fully in memory. THE path for
  /// videos / large media (the old readAsBytes path OOM-killed the app on
  /// multi-hundred-MB reels). Returns the full [UploadResult].
  Future<UploadResult> uploadFile(XFile file, {String? mimeType}) async {
    state = state.copyWith(isUploading: true, clearError: true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final service = UploadService(nostr.authService, nostr);
      final result = await service.uploadStream(
        openStream: () => file.openRead(),
        length: () => file.length(),
        mimeType: mimeType ?? 'application/octet-stream',
        fileName: file.name,
      );
      state = state.copyWith(isUploading: false);
      return result;
    } catch (e) {
      state = state.copyWith(isUploading: false, error: e.toString());
      rethrow;
    }
  }
}

final uploadProvider = NotifierProvider<UploadNotifier, UploadState>(
  UploadNotifier.new,
);
