import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Communities home: browse NIP-72 moderated communities (kind 34550).
class CommunitiesScreen extends ConsumerStatefulWidget {
  const CommunitiesScreen({super.key});

  @override
  ConsumerState<CommunitiesScreen> createState() => _CommunitiesScreenState();
}

class _CommunitiesScreenState extends ConsumerState<CommunitiesScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final communities = ref.watch(communitiesProvider);
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Communities'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: SearchBar(
              hintText: 'Search communities…',
              leading: const AppIcon('search'),
              elevation: const WidgetStatePropertyAll(0),
              backgroundColor: WidgetStatePropertyAll(
                Theme.of(context).colorScheme.surfaceContainerHighest,
              ),
              onChanged: (v) => setState(() => _query = v.toLowerCase()),
            ),
          ),
        ),
      ),
      body: AsyncFeedList<NostrEvent>(
        value: communities,
        onRefresh: () => ref.refresh(communitiesProvider.future),
        emptyState: const EmptyState(
          icon: Icons.groups_outlined,
          title: 'No communities yet',
          subtitle: 'Be the first to create a community on Nostr.',
        ),
        padding: const EdgeInsets.all(16),
        itemBuilder: (context, event) {
          // Client-side search filter.
          if (_query.isNotEmpty) {
            final name = sanitizeText(event.getTag('name')).toLowerCase();
            final desc = sanitizeText(event.getTag('description')).toLowerCase();
            if (!name.contains(_query) && !desc.contains(_query)) {
              return const SizedBox.shrink();
            }
          }
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _CommunityCard(event: event),
          );
        },
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => _showCreateSheet(context, ref),
              icon: const AppIcon('plus'),
              label: const Text('Create'),
            )
          : null,
    );
  }

  void _showCreateSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => const _CreateCommunitySheet(),
    );
  }
}

/// Create-community sheet with cover image upload (Blossom) + URL option.
class _CreateCommunitySheet extends ConsumerStatefulWidget {
  const _CreateCommunitySheet();

  @override
  ConsumerState<_CreateCommunitySheet> createState() =>
      _CreateCommunitySheetState();
}

class _CreateCommunitySheetState extends ConsumerState<_CreateCommunitySheet> {
  final _nameCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _imageCtrl = TextEditingController();
  bool _uploading = false;
  bool _publishing = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _descCtrl.dispose();
    _imageCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2048,
    );
    if (file == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _imageCtrl.text = url;
      AppToast.success(context, 'Cover image uploaded');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _create() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      AppToast.warning(context, 'Enter a community name');
      return;
    }
    setState(() => _publishing = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final d = name
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-+|-+$'), '');
      final auth = ref.read(authStateProvider);
      final event = nostr.authService.signEvent(
        privateKey: auth.privateKey!,
        kind: 34550,
        content: _descCtrl.text.trim(),
        tags: [
          ['d', d.isEmpty ? 'community' : d],
          ['name', name],
          if (_imageCtrl.text.trim().isNotEmpty)
            ['image', _imageCtrl.text.trim()],
          ['p', auth.pubkey!, '', 'moderator'],
          ['client', 'nostrfeed'],
        ],
      );
      await nostr.publishEvent(event);
      ref.invalidate(communitiesProvider);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(
        const SnackBar(content: Text('Community created')),
      );
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
            Text(
              'Create Community',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _nameCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Community name',
                hintText: 'e.g. Bitcoin Builders',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(labelText: 'Description'),
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            // Cover image: upload OR paste URL
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
                        tooltip: 'Upload cover image',
                        onPressed: _pickImage,
                      ),
              ],
            ),
            if (_imageCtrl.text.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ClipRRect(
                  borderRadius: AppShapes.radiusMd,
                  child: Image.network(
                    _imageCtrl.text.trim(),
                    height: 100,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
            const SizedBox(height: 20),
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
                    : const AppIcon('check'),
                label: const Text('Create'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommunityCard extends ConsumerWidget {
  final NostrEvent event;
  const _CommunityCard({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    // Sanitize relay data — malformed UTF-16 crashes the text engine.
    final name = sanitizeText(event.getTag('name')).isEmpty
        ? 'Unnamed Community'
        : sanitizeText(event.getTag('name'));
    final description = sanitizeText(event.getTag('description'));
    final image = event.getTag('image');
    final moderators = event
        .getTags('p')
        .where((t) => true)
        .length; // p tags = moderators in NIP-72

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/communities/detail', extra: event),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Cover image
            SizedBox(
              height: 90,
              width: double.infinity,
              child: image != null
                  ? CachedNetworkImage(
                      httpHeaders: kImageHttpHeaders,
                      imageUrl: image,
                      fit: BoxFit.cover,
                      placeholder: (_, _) =>
                          Container(color: scheme.surfaceContainerHighest),
                      errorWidget: (_, _, _) => _BannerFallback(scheme: scheme),
                    )
                  : _BannerFallback(scheme: scheme),
            ),
            Padding(
              padding: AppSpacing.paddingSm,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    name,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    description.isEmpty ? 'A Nostr community' : description,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  // Member/mod count + open hint — no fake "Join" button.
                  Row(
                    children: [
                      AppIcon('users', size: AppIconSize.sm, color: scheme.onSurfaceVariant),
                      const SizedBox(width: AppSpacing.xxs),
                      Expanded(
                        child: Text(
                          '$moderators moderator${moderators == 1 ? '' : 's'}',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      AppIcon('chevron_r', size: AppIconSize.md, color: scheme.onSurfaceVariant),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BannerFallback extends StatelessWidget {
  final ColorScheme scheme;
  const _BannerFallback({required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: scheme.surfaceContainerHigh,
      child: Center(
        child: AppIcon('group', color: scheme.onSurfaceVariant,
          size: AppIconSize.xl,
        ),
      ),
    );
  }
}
