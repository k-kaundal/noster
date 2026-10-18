import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  DateTime _focusedMonth = DateTime.now();

  void _showNewEventSheet(BuildContext context) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to create events')),
      );
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: const _NewEventSheet(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final events = ref.watch(calendarProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(DateFormat('MMMM yyyy').format(_focusedMonth)),
        actions: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(() => _focusedMonth =
                DateTime(_focusedMonth.year, _focusedMonth.month - 1)),
          ),
          IconButton(
            icon: const Icon(Icons.today),
            onPressed: () => setState(() => _focusedMonth = DateTime.now()),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: () => setState(() => _focusedMonth =
                DateTime(_focusedMonth.year, _focusedMonth.month + 1)),
          ),
        ],
      ),
      body: events.when(
        loading: () => const _CalendarSkeleton(),
        error: (err, _) => _ErrorView(
          message: 'Failed to load events',
          onRetry: () => ref.invalidate(calendarProvider),
        ),
        data: (items) {
          if (items.isEmpty) return const _EmptyCalendar();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(calendarProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) => _EventCard(event: items[i]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showNewEventSheet(context),
        icon: const Icon(Icons.event),
        label: const Text('New Event'),
      ),
    );
  }
}

class _EventCard extends ConsumerWidget {
  final NostrEvent event;
  const _EventCard({required this.event});

  void _handleRsvp(BuildContext context, WidgetRef ref, String response) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to RSVP')),
      );
      return;
    }
    // NIP-52 RSVP is a kind 31925 reaction to a calendar event.
    // For now, send a reaction as acknowledgment — full RSVP kind support
    // needs the calendar event to be addressable (kind 31922/31923).
    final nostr = ref.read(nostrServiceProvider);
    nostr.publish(nostr.createReaction(event, content: response == 'yes' ? '✅' : '🤔'));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('RSVP "$response" sent')),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Untitled Event';
    final location = event.getTag('location');
    final startTs = event.getTag('start');
    final startDate = startTs != null
        ? DateTime.fromMillisecondsSinceEpoch(int.tryParse(startTs) != null
            ? int.parse(startTs) * 1000
            : event.createdAt * 1000)
        : DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);
    final attendees = event.getTags('p').length + 1;
    final profileAsync = ref.watch(profileProvider(event.pubkey));

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Date badge
            Container(
              width: 58,
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  Text(
                    DateFormat('MMM').format(startDate).toUpperCase(),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: scheme.onPrimaryContainer,
                      letterSpacing: 0.5,
                    ),
                  ),
                  Text(
                    '${startDate.day}',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: scheme.onPrimaryContainer,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 15),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.schedule,
                          size: 13, color: scheme.onSurfaceVariant),
                      const SizedBox(width: 4),
                      Text(
                        DateFormat('EEE, h:mm a').format(startDate),
                        style: TextStyle(
                            fontSize: 12, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                  if (location != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(Icons.location_on_outlined,
                            size: 13, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            location,
                            style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      // Attendee avatars — shrink to fit
                      Flexible(
                        flex: 0,
                        child: SizedBox(
                          height: 22,
                          width: 64,
                          child: Stack(
                            children: List.generate(
                              attendees > 4 ? 4 : attendees,
                              (i) => Positioned(
                                left: i * 14.0,
                                child: CircleAvatar(
                                  radius: 11,
                                  backgroundColor: scheme.secondaryContainer,
                                  backgroundImage: i == 0 &&
                                          profileAsync.value?.picture != null
                                      ? CachedNetworkImageProvider(
                                          profileAsync.value!.picture!)
                                      : null,
                                  child: i != 0 || profileAsync.value?.picture == null
                                      ? Icon(Icons.person,
                                          size: 10,
                                          color: scheme.onSecondaryContainer)
                                      : null,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          '$attendees attending',
                          style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _RsvpButton(
                        label: 'Yes',
                        selected: false,
                        onTap: () => _handleRsvp(context, ref, 'yes'),
                      ),
                      const SizedBox(width: 6),
                      _RsvpButton(
                        label: 'Maybe',
                        selected: false,
                        onTap: () => _handleRsvp(context, ref, 'maybe'),
                      ),
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

class _RsvpButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _RsvpButton(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.primary : scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44, minWidth: 60),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyCalendar extends StatelessWidget {
  const _EmptyCalendar();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.calendar_month_outlined, size: 64, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'No events this month',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Calendar events from Nostr will appear here.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _CalendarSkeleton extends StatelessWidget {
  const _CalendarSkeleton();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: 4,
      itemBuilder: (context, _) => Shimmer.fromColors(
        baseColor: base,
        highlightColor: Theme.of(context).colorScheme.surface,
        child: Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                    width: 58,
                    height: 70,
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12))),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(height: 14, width: 160, color: Colors.white),
                      const SizedBox(height: 8),
                      Container(height: 10, width: 100, color: Colors.white),
                      const SizedBox(height: 6),
                      Container(height: 10, width: 130, color: Colors.white),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 56, color: scheme.error),
          const SizedBox(height: 16),
          Text(message, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet for creating a NIP-52 calendar event (kind 31923, time-based).
class _NewEventSheet extends ConsumerStatefulWidget {
  const _NewEventSheet();

  @override
  ConsumerState<_NewEventSheet> createState() => _NewEventSheetState();
}

class _NewEventSheetState extends ConsumerState<_NewEventSheet> {
  final _titleController = TextEditingController();
  final _locationController = TextEditingController();
  final _descriptionController = TextEditingController();
  DateTime _start = DateTime.now().add(const Duration(days: 1));
  bool _publishing = false;

  @override
  void dispose() {
    _titleController.dispose();
    _locationController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickStart() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _start,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_start),
    );
    if (time == null || !mounted) return;
    setState(() {
      _start = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _publish() async {
    if (_titleController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Title is required')),
      );
      return;
    }

    setState(() => _publishing = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final startTs = _start.millisecondsSinceEpoch ~/ 1000;
      final event = nostr.createCalendarEvent(
        title: _titleController.text.trim(),
        start: startTs,
        location: _locationController.text.trim().isEmpty
            ? null
            : _locationController.text.trim(),
        description: _descriptionController.text.trim(),
      );
      nostr.publish(event);
      if (!mounted) return;
      ref.invalidate(calendarProvider);
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event published')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _publishing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to publish: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('New Event',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Title',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _pickStart,
              icon: const Icon(Icons.schedule),
              label: Text(DateFormat('EEE, MMM d • h:mm a').format(_start)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _locationController,
              decoration: const InputDecoration(
                labelText: 'Location (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descriptionController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Description',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _publishing ? null : _publish,
              icon: _publishing
                  ? SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: scheme.onPrimary,
                      ),
                    )
                  : const Icon(Icons.publish),
              label: const Text('Publish Event'),
            ),
          ],
        ),
      ),
    );
  }
}
