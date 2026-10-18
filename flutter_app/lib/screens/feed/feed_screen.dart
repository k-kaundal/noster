import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/nostr_models.dart';
import '../../services/nostr_service.dart';

/// Global service instance — created once, reused everywhere.
final nostrService = NostrService();

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  List<NostrEvent> _events = [];
  bool _loading = true;
  String? _error;
  int _relayCount = 0;
  List<String> _connectedRelays = [];

  @override
  void initState() {
    super.initState();
    _loadFeed();
  }

  Future<void> _loadFeed() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // Init service (connects to relays)
      if (!nostrService.isInitialized) {
        await nostrService.init();
      }

      _relayCount = nostrService.relayPool.connectedCount;
      _connectedRelays = nostrService.relayPool.connectedUrls;

      if (_relayCount == 0) {
        setState(() {
          _loading = false;
          _error = 'Could not connect to any relay. Check your internet connection.';
        });
        return;
      }

      // Fetch feed
      final events = await nostrService.fetchFeed(limit: 50);

      if (mounted) {
        setState(() {
          _events = events;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NostrFeed', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          // Relay status indicator
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Center(
              child: Text(
                '$_relayCount relays',
                style: TextStyle(
                  fontSize: 12,
                  color: _relayCount > 0 ? Colors.green : Colors.red,
                ),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadFeed,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Connecting to Nostr relays...'),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 64, color: Colors.red),
              const SizedBox(height: 16),
              const Text('Connection Error', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _loadFeed,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    if (_events.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.feed_outlined, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('No posts found', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 8),
            Text('Connected to $_relayCount relays', style: const TextStyle(color: Colors.grey)),
            Text('Relays: ${_connectedRelays.join(", ")}',
              style: const TextStyle(color: Colors.grey, fontSize: 11),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton(onPressed: _loadFeed, child: const Text('Refresh')),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadFeed,
      child: ListView.builder(
        itemCount: _events.length,
        itemBuilder: (context, index) => _PostTile(event: _events[index]),
      ),
    );
  }
}

/// Simple post tile — no external dependencies on providers.
class _PostTile extends StatefulWidget {
  final NostrEvent event;
  const _PostTile({required this.event});

  @override
  State<_PostTile> createState() => _PostTileState();
}

class _PostTileState extends State<_PostTile> {
  NostrProfile? _profile;
  int _replyCount = 0;
  int _reactionCount = 0;
  int _repostCount = 0;

  @override
  void initState() {
    super.initState();
    _loadMetadata();
  }

  Future<void> _loadMetadata() async {
    // Load author profile
    try {
      final profile = await nostrService.fetchProfile(widget.event.pubkey);
      if (mounted) setState(() => _profile = profile);
    } catch (_) {}

    // Load reaction counts
    try {
      final reactions = await nostrService.fetchReactions(widget.event.id);
      final replies = await nostrService.fetchReplies(widget.event.id);
      final reposts = await nostrService.fetchReposts(widget.event.id);
      if (mounted) {
        setState(() {
          _reactionCount = reactions.length;
          _replyCount = replies.length;
          _repostCount = reposts.length;
        });
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final event = widget.event;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);
    final timeAgo = timeago.format(timestamp);
    final name = _profile?.displayNameOrName ?? _truncatedKey(event.pubkey);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: InkWell(
        onTap: () => context.push('/thread', extra: event),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Author row
              Row(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundImage: _profile?.picture != null
                        ? CachedNetworkImageProvider(_profile!.picture!)
                        : null,
                    child: _profile?.picture == null
                        ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?')
                        : null,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        Text(
                          '${_profile?.nip05 ?? _truncatedKey(event.pubkey)} · $timeAgo',
                          style: TextStyle(color: Colors.grey[600], fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Content
              Text(event.content, style: const TextStyle(fontSize: 15)),
              const SizedBox(height: 10),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _action(Icons.chat_bubble_outline, _replyCount),
                  _action(Icons.repeat, _repostCount),
                  _action(Icons.favorite_border, _reactionCount),
                  _action(Icons.bolt, 0),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _action(IconData icon, int count) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: Colors.grey[600]),
          if (count > 0) ...[
            const SizedBox(width: 4),
            Text('$count', style: TextStyle(color: Colors.grey[600], fontSize: 13)),
          ],
        ],
      ),
    );
  }

  String _truncatedKey(String hex) {
    if (hex.length <= 12) return hex;
    return '${hex.substring(0, 6)}...${hex.substring(hex.length - 4)}';
  }
}
