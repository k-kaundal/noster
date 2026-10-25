import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/features/groups/application/group_providers.dart';

/// Create a NIP-29 group (kind 39000 metadata) with cover image upload.
class CreateGroupSheet extends ConsumerStatefulWidget {
  const CreateGroupSheet({super.key});

  @override
  ConsumerState<CreateGroupSheet> createState() => _CreateGroupSheetState();
}

class _CreateGroupSheetState extends ConsumerState<CreateGroupSheet> {
  final _nameCtrl = TextEditingController();
  final _aboutCtrl = TextEditingController();
  final _imageCtrl = TextEditingController();
  bool _isOpen = true; // anyone can join
  bool _isPublic = true; // readable by non-members
  bool _uploading = false;
  bool _publishing = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _aboutCtrl.dispose();
    _imageCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2048);
    if (file == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _imageCtrl.text = url;
      AppToast.success(context, 'Cover uploaded');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _create() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      AppToast.warning(context, 'Enter a group name');
      return;
    }
    setState(() => _publishing = true);
    try {
      final groupId = name
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-+|-+$'), '');
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createGroup(
        groupId: groupId.isEmpty ? 'group-${DateTime.now().millisecondsSinceEpoch}' : groupId,
        name: name,
        about: _aboutCtrl.text.trim(),
        picture: _imageCtrl.text.trim().isEmpty ? null : _imageCtrl.text.trim(),
        isOpen: _isOpen,
        isPublic: _isPublic,
      );
      await nostr.publishEvent(event);
      ref.invalidate(groupsProvider);
      if (!mounted) return;
      Navigator.pop(context);
      AppToast.success(context, 'Group created');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Create failed: $e');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Create Group',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const AppIcon('plus'),
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _nameCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Group name',
                hintText: 'e.g. Bitcoin Builders',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _aboutCtrl,
              decoration: const InputDecoration(
                labelText: 'About (optional)',
                hintText: 'What is this group about?',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            // Cover image: upload OR URL
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _imageCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Cover image URL (optional)',
                    ),
                    keyboardType: TextInputType.url,
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                _uploading
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const AppIcon('image'),
                        tooltip: 'Upload cover',
                        onPressed: _pickImage,
                      ),
              ],
            ),
            if (_imageCtrl.text.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.network(
                    _imageCtrl.text.trim(),
                    height: 90,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Open group'),
              subtitle: const Text('Anyone can join (off = invite only)'),
              value: _isOpen,
              onChanged: (v) => setState(() => _isOpen = v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Public group'),
              subtitle: const Text('Anyone can read messages (off = members only)'),
              value: _isPublic,
              onChanged: (v) => setState(() => _isPublic = v),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _publishing ? null : _create,
                icon: _publishing
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: colorScheme.onPrimary,
                        ),
                      )
                    : const AppIcon('plus'),
                label: const Text('Create Group'),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Note: groups work on relays that accept user-published group metadata.',
              style: TextStyle(fontSize: 11, color: colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
