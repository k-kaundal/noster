import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../services/upload_service.dart';
import 'app_providers.dart';

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
class UploadNotifier extends StateNotifier<UploadState> {
  UploadNotifier(this._ref) : super(const UploadState());

  final Ref _ref;

  /// Upload an image picked from gallery/camera. Returns the public URL.
  Future<String> uploadImage(XFile file) async {
    state = state.copyWith(isUploading: true, clearError: true);
    try {
      final nostr = _ref.read(nostrServiceProvider);
      final service = UploadService(nostr.authService, nostr);
      final url = await service.uploadImage(file);
      state = state.copyWith(isUploading: false);
      return url;
    } catch (e) {
      state = state.copyWith(isUploading: false, error: e.toString());
      rethrow;
    }
  }

  /// Upload raw bytes. Returns the public URL.
  Future<String> uploadBytes(
    Uint8List bytes, {
    required String filename,
    String? mimeType,
  }) async {
    state = state.copyWith(isUploading: true, clearError: true);
    try {
      final nostr = _ref.read(nostrServiceProvider);
      final service = UploadService(nostr.authService, nostr);
      final url = await service.uploadBytes(
        bytes,
        mimeType ?? 'application/octet-stream',
        filename,
      );
      state = state.copyWith(isUploading: false);
      return url;
    } catch (e) {
      state = state.copyWith(isUploading: false, error: e.toString());
      rethrow;
    }
  }
}

final uploadProvider =
    StateNotifierProvider<UploadNotifier, UploadState>((ref) {
  return UploadNotifier(ref);
});
