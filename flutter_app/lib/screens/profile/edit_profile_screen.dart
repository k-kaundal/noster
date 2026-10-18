import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  /// Show as a modal bottom sheet dialog
  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => const Padding(
        padding: EdgeInsets.only(top: 8),
        child: EditProfileScreen(),
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

  @override
  void initState() {
    super.initState();
    final profile = ref.read(authStateProvider).profile;
    _nameController = TextEditingController(text: profile?.name ?? '');
    _displayNameController = TextEditingController(text: profile?.displayName ?? '');
    _aboutController = TextEditingController(text: profile?.about ?? '');
    _pictureController = TextEditingController(text: profile?.picture ?? '');
    _bannerController = TextEditingController(text: profile?.banner ?? '');
    _websiteController = TextEditingController(text: profile?.website ?? '');
    _nip05Controller = TextEditingController(text: profile?.nip05 ?? '');
    _lud16Controller = TextEditingController(text: profile?.lud16 ?? '');
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Column(
          children: [
            // Handle
            Container(
              margin: const EdgeInsets.only(top: 8, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: scheme.onSurface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Edit Profile', style: theme.textTheme.titleLarge),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: Form(
                key: _formKey,
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  children: [
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
                      controller: _pictureController,
                      label: 'Avatar URL',
                      hint: 'https://example.com/avatar.png',
                      icon: Icons.image_outlined,
                      keyboardType: TextInputType.url,
                    ),
                    const SizedBox(height: 12),
                    _buildField(
                      controller: _bannerController,
                      label: 'Banner URL',
                      hint: 'https://example.com/banner.png',
                      icon: Icons.panorama_outlined,
                      keyboardType: TextInputType.url,
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
                    const SizedBox(height: 24),
                    FilledButton.icon(
                      onPressed: _isSaving ? null : _save,
                      icon: _isSaving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save),
                      label: Text(_isSaving ? 'Saving...' : 'Save Profile'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),
          ],
        );
      },
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
          borderRadius: BorderRadius.circular(12),
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
