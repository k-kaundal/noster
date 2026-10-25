import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  /// Show as a full-screen page rather than a bottom sheet.
  static void show(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const EditProfileScreen(),
        fullscreenDialog: true,
      ),
    );
  }

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _displayNameController;
  late final TextEditingController _aboutController;
  late final TextEditingController _pictureController;
  late final TextEditingController _bannerController;
  late final TextEditingController _websiteController;
  late final TextEditingController _nip05Controller;
  late final TextEditingController _lud16Controller;
  bool _isSaving = false;
  bool _isLoadingProfile = true;

  // Image upload state
  bool _isUploadingPicture = false;
  bool _isUploadingBanner = false;
  String? _uploadError;

  final _imagePicker = ImagePicker();

  @override
  void initState() {
    super.initState();
    // Initialize with empty controllers — will be populated by _loadProfile()
    _nameController = TextEditingController();
    _displayNameController = TextEditingController();
    _aboutController = TextEditingController();
    _pictureController = TextEditingController();
    _bannerController = TextEditingController();
    _websiteController = TextEditingController();
    _nip05Controller = TextEditingController();
    _lud16Controller = TextEditingController();

    // Fetch the latest profile from the relay — authStateProvider.profile
    // may be stale or empty if the app restarted and hasn't fetched yet
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    try {
      final auth = ref.read(authStateProvider);
      final pubkey = auth.pubkey;
      if (pubkey == null) {
        setState(() => _isLoadingProfile = false);
        return;
      }

      // Fetch from relay — this is the authoritative source
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();
      final profile = await nostr.fetchProfile(pubkey);

      if (mounted && profile != null) {
        _nameController.text = profile.name ?? '';
        _displayNameController.text = profile.displayName ?? '';
        _aboutController.text = profile.about ?? '';
        _pictureController.text = profile.picture ?? '';
        _bannerController.text = profile.banner ?? '';
        _websiteController.text = profile.website ?? '';
        _nip05Controller.text = profile.nip05 ?? '';
        _lud16Controller.text = profile.lud16 ?? '';
      }
    } catch (_) {
      // Fall back to whatever auth state has — even empty is fine
    } finally {
      if (mounted) setState(() => _isLoadingProfile = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _displayNameController.dispose();
    _aboutController.dispose();
    _pictureController.dispose();
    _bannerController.dispose();
    _websiteController.dispose();
    _nip05Controller.dispose();
    _lud16Controller.dispose();
    super.dispose();
  }

  String? _emptyToNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  // ── Image upload ─────────────────────────────────────────────────────

  Future<void> _pickAndUploadImage({required bool isBanner}) async {
    setState(() => _uploadError = null);

    // Let user choose camera or gallery
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const AppIcon('image'),
              title: const Text('Gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            ListTile(
              leading: const AppIcon('image'),
              title: const Text('Camera'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    final picked = await _imagePicker.pickImage(
      source: source,
      maxWidth: isBanner ? 2048 : 1024,
      maxHeight: isBanner ? 2048 : 1024,
      imageQuality: 85,
    );
    if (picked == null) return;

    setState(() {
      if (isBanner) {
        _isUploadingBanner = true;
      } else {
        _isUploadingPicture = true;
      }
      _uploadError = null;
    });

    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(picked);

      setState(() {
        if (isBanner) {
          _bannerController.text = url;
        } else {
          _pictureController.text = url;
        }
      });

      if (mounted) {
        AppToast.success(context, '${isBanner ? 'Banner' : 'Profile picture'} uploaded — save to publish it');
      }
    } catch (e) {
      setState(() => _uploadError = e.toString());
      if (mounted) {
        AppToast.error(context, 'Upload failed: $e');
      }
    } finally {
      setState(() {
        if (isBanner) {
          _isUploadingBanner = false;
        } else {
          _isUploadingPicture = false;
        }
      });
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    try {
      final current = ref.read(authStateProvider).profile;
      final updated = (current ?? const NostrProfile()).copyWith(
        name: _emptyToNull(_nameController.text),
        displayName: _emptyToNull(_displayNameController.text),
        about: _emptyToNull(_aboutController.text),
        picture: _emptyToNull(_pictureController.text),
        banner: _emptyToNull(_bannerController.text),
        website: _emptyToNull(_websiteController.text),
        nip05: _emptyToNull(_nip05Controller.text),
        lud16: _emptyToNull(_lud16Controller.text),
      );

      await ref.read(authStateProvider.notifier).updateProfile(updated);

      if (mounted) {
        AppToast.success(context, 'Profile updated');
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Failed to save: $e');
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final profile = ref.watch(authStateProvider).profile;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const AppIcon('plus'),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text('Edit Profile'),
        actions: [
          FilledButton(
            onPressed: _isSaving ? null : _save,
            child: _isSaving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _isLoadingProfile
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
            // ── Banner section ─────────────────────────────────────
            _ImageSection(
              label: 'Banner',
              hint: 'Wide image shown at the top of your profile',
              url: _bannerController.text,
              previewType: _PreviewType.wide,
              isUploading: _isUploadingBanner,
              onUpload: () => _pickAndUploadImage(isBanner: true),
              onUrlChanged: (v) => _bannerController.text = v,
              scheme: scheme,
            ),
            const SizedBox(height: 24),

            // ── Avatar section ─────────────────────────────────────
            _ImageSection(
              label: 'Profile Picture',
              hint: 'Square photo shown as your avatar',
              url: _pictureController.text,
              previewType: _PreviewType.square,
              isUploading: _isUploadingPicture,
              onUpload: () => _pickAndUploadImage(isBanner: false),
              onUrlChanged: (v) => _pictureController.text = v,
              scheme: scheme,
            ),
            const SizedBox(height: 24),

            if (_uploadError != null) ...[
              Card(
                color: scheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      AppIcon('eye_off', color: scheme.error),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _uploadError!,
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: scheme.onErrorContainer),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],

            // ── Text fields ────────────────────────────────────────
            _buildField(
              controller: _displayNameController,
              label: 'Display Name',
              hint: 'Your public display name',
              icon: Icons.badge_outlined,
            ),
            const SizedBox(height: 12),
            _buildField(
              controller: _nameController,
              label: 'Name',
              hint: 'Short username',
              icon: Icons.person_outline,
            ),
            const SizedBox(height: 12),
            _buildField(
              controller: _aboutController,
              label: 'About',
              hint: 'Tell people about yourself',
              icon: Icons.info_outline,
              maxLines: 4,
            ),
            const SizedBox(height: 12),
            _buildField(
              controller: _websiteController,
              label: 'Website',
              hint: 'https://yourwebsite.com',
              icon: Icons.link,
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),
            _buildField(
              controller: _nip05Controller,
              label: 'NIP-05 Identifier',
              hint: 'you@example.com',
              icon: Icons.verified_outlined,
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 12),
            _buildField(
              controller: _lud16Controller,
              label: 'Lightning Address',
              hint: 'you@walletofsatoshi.com',
              icon: Icons.bolt_outlined,
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 32),

            // Preview hint
            if (profile != null)
              Center(
                child: Text(
                  'Changes will appear on your public profile once saved',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    int maxLines = 1,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextFormField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      enabled: !_isSaving,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(
          borderRadius: AppShapes.radiusMd,
        ),
        alignLabelWithHint: maxLines > 1,
      ),
      validator: (value) {
        if (keyboardType == TextInputType.url &&
            value != null &&
            value.trim().isNotEmpty) {
          final uri = Uri.tryParse(value.trim());
          if (uri == null || !uri.hasScheme) {
            return 'Please enter a valid URL';
          }
        }
        return null;
      },
    );
  }
}

// ── Image section widget ───────────────────────────────────────────────

enum _PreviewType { square, wide }

class _ImageSection extends StatelessWidget {
  final String label;
  final String hint;
  final String url;
  final _PreviewType previewType;
  final bool isUploading;
  final VoidCallback onUpload;
  final ValueChanged<String> onUrlChanged;
  final ColorScheme scheme;

  const _ImageSection({
    required this.label,
    required this.hint,
    required this.url,
    required this.previewType,
    required this.isUploading,
    required this.onUpload,
    required this.onUrlChanged,
    required this.scheme,
  });

  @override
  Widget build(BuildContext context) {
    final hasImage = url.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Row(
          children: [
            Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const Spacer(),
            if (hasImage)
              IconButton(
                icon: const AppIcon('plus', size: 18),
                tooltip: 'Remove',
                onPressed: () => onUrlChanged(''),
              ),
          ],
        ),
        Text(
          hint,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 12),

        // Preview + upload button
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Preview
            Container(
              width: previewType == _PreviewType.square ? 80 : 160,
              height: previewType == _PreviewType.square ? 80 : 90,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: AppShapes.radiusMd,
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.5),
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasImage
                  ? CachedNetworkImage(
                      httpHeaders: kImageHttpHeaders,
                      imageUrl: url,
                      fit: BoxFit.cover,
                      placeholder: (_, _) => Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: scheme.primary,
                          ),
                        ),
                      ),
                      errorWidget: (_, _, _) => Center(
                        child: Icon(
                          Icons.broken_image_outlined,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    )
                  : Center(
                      child: Icon(
                        previewType == _PreviewType.square
                            ? Icons.person_outline
                            : Icons.panorama_outlined,
                        size: 32,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
            ),
            const SizedBox(width: 16),

            // Upload button + URL field
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FilledButton.tonalIcon(
                    onPressed: isUploading ? null : onUpload,
                    icon: isUploading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const AppIcon('share', size: 18),
                    label: Text(
                      isUploading
                          ? 'Uploading…'
                          : hasImage
                              ? 'Change Image'
                              : 'Upload Image',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: url,
                    onChanged: onUrlChanged,
                    decoration: InputDecoration(
                      hintText: 'https://…',
                      prefixIcon: const AppIcon('link', size: 18),
                      border: OutlineInputBorder(
                        borderRadius: AppShapes.radiusMd,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                    keyboardType: TextInputType.url,
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
