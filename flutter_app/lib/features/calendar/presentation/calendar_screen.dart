import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/calendar/application/calendar_providers.dart';

class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  void _showNewEventSheet(BuildContext context) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to create events');
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
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
    final eventsAsync = ref.watch(upcomingEventsProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'Calendar',
      body: AsyncFeedList<NostrEvent>(
        value: eventsAsync,
        onRefresh: () => ref.refresh(calendarEventsProvider.future),
        emptyState: EmptyState(
          icon: Icons.calendar_month_outlined,
          title: 'No upcoming events',
          subtitle: 'Calendar events from Nostr will appear here.',
          action: auth.isLoggedIn
              ? FilledButton.icon(
                  onPressed: () => _showNewEventSheet(context),
                  icon: const AppIcon('calendar'),
                  label: const Text('Create an event'),
                )
              : null,
        ),
        separator: const SizedBox(height: 12),
        padding: const EdgeInsets.all(16),
        itemBuilder: (context, event) => EventCard(event: event),
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => _showNewEventSheet(context),
              icon: const AppIcon('calendar'),
              label: const Text('New Event'),
            )
          : null,
    );
  }
}

// ─── Event card with real NIP-52 RSVP ───────────────────────────────

class EventCard extends ConsumerWidget {
  final NostrEvent event;
  const EventCard({super.key, required this.event});

  String get _coordinate {
    final d = event.getTag('d') ?? '';
    return '${event.kind}:${event.pubkey}:$d';
  }

  bool get _isDateBased => event.kind == 31922;

  DateTime? get _startDate {
    final start = event.getTag('start');
    if (start == null) return null;
    if (_isDateBased) {
      return DateTime.tryParse(start); // YYYY-MM-DD
    }
    final ts = int.tryParse(start);
    return ts != null
        ? DateTime.fromMillisecondsSinceEpoch(ts * 1000)
        : null;
  }

  Future<void> _rsvp(BuildContext context, WidgetRef ref, String status) async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to RSVP');
      return;
    }
    try {
      final nostr = ref.read(nostrServiceProvider);
      final rsvp = nostr.createCalendarRsvp(
        calendarEvent: event,
        status: status,
      );
      await nostr.publishEvent(rsvp);
      ref.invalidate(rsvpsProvider(_coordinate));
      ref.invalidate(myRsvpProvider(_coordinate));
      ref.invalidate(rsvpCountsProvider(_coordinate));
      if (context.mounted) {
        final label = switch (status) {
          'accepted' => 'Going',
          'tentative' => 'Maybe',
          _ => 'Can\'t go',
        };
        AppToast.success(context, 'RSVP: $label');
      }
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'RSVP failed: $e');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Untitled Event';
    final location = event.getTag('location');
    final startDate = _startDate;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final rsvpCountsAsync = ref.watch(rsvpCountsProvider(_coordinate));
    final myRsvpAsync = ref.watch(myRsvpProvider(_coordinate));

    final counts = rsvpCountsAsync.valueOrNull;
    final myStatus = myRsvpAsync.valueOrNull;
    final isLoggedIn =
        ref.watch(authStateProvider.select((a) => a.isLoggedIn && !a.isReadOnly));

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: AppShapes.radiusLg,
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Date badge
            if (startDate != null)
              Container(
                width: 58,
                padding: const EdgeInsets.symmetric(
                    vertical: AppSpacing.sm - 2),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: AppShapes.radiusMd,
                ),
                child: Column(
                  children: [
                    Text(
                      DateFormat('MMM').format(startDate).toUpperCase(),
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: scheme.onPrimaryContainer,
                            letterSpacing: 0.5,
                          ),
                    ),
                    Text(
                      '${startDate.day}',
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: scheme.onPrimaryContainer,
                          ),
                    ),
                  ],
                ),
              )
            else
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: AppShapes.radiusMd,
                ),
                child: AppIcon('calendar', color: scheme.onSurfaceVariant),
              ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      AppIcon(
                        _isDateBased ? 'calendar' : 'clock',
                        size: AppIconSize.xs,
                        color: scheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        startDate != null
                            ? _isDateBased
                                ? DateFormat('EEE, MMM d yyyy')
                                    .format(startDate)
                                : DateFormat('EEE, MMM d • h:mm a')
                                    .format(startDate)
                            : 'Date TBD',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                  if (location != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        AppIcon('globe', size: AppIconSize.xs, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            location,
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 6),
                  // Organizer + RSVP counts
                  Row(
                    children: [
                      SafeAvatar(
                        imageUrl: profileAsync.value?.picture,
                        radius: 10,
                        fallback: const AppIcon('users', size: 10),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          'by ${profileAsync.value?.displayNameOrName ?? '${event.pubkey.substring(0, 8)}…'}',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (counts != null &&
                          (counts.accepted > 0 || counts.tentative > 0))
                        Text(
                          [
                            if (counts.accepted > 0)
                              '${counts.accepted} going',
                            if (counts.tentative > 0)
                              '${counts.tentative} maybe',
                          ].join(' · '),
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: scheme.primary,
                              ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  // RSVP buttons
                  if (isLoggedIn)
                    Row(
                      children: [
                        _RsvpButton(
                          label: 'Going',
                          selected: myStatus == 'accepted',
                          onTap: () => _rsvp(context, ref, 'accepted'),
                        ),
                        const SizedBox(width: 6),
                        _RsvpButton(
                          label: 'Maybe',
                          selected: myStatus == 'tentative',
                          onTap: () => _rsvp(context, ref, 'tentative'),
                        ),
                        const SizedBox(width: 6),
                        _RsvpButton(
                          label: 'Can\'t go',
                          selected: myStatus == 'declined',
                          onTap: () => _rsvp(context, ref, 'declined'),
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
      borderRadius: AppShapes.radiusFull,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusFull,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40, minWidth: 56),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color:
                      selected ? scheme.onPrimary : scheme.onSurfaceVariant,
                ),
          ),
        ),
      ),
    );
  }
}

// ─── New event sheet (kind 31923 time-based + date-based option) ────

class _NewEventSheet extends ConsumerStatefulWidget {
  const _NewEventSheet();

  @override
  ConsumerState<_NewEventSheet> createState() => _NewEventSheetState();
}

class _NewEventSheetState extends ConsumerState<_NewEventSheet> {
  final _titleController = TextEditingController();
  final _locationController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _tagsController = TextEditingController();
  DateTime _start = DateTime.now().add(const Duration(days: 1));
  DateTime? _end;
  bool _allDay = false;
  bool _publishing = false;

  @override
  void dispose() {
    _titleController.dispose();
    _locationController.dispose();
    _descriptionController.dispose();
    _tagsController.dispose();
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
    if (_allDay) {
      setState(() => _start = date);
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_start),
    );
    if (time == null || !mounted) return;
    setState(() {
      _start = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _pickEnd() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _end ?? _start,
      firstDate: _start,
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
    );
    if (date == null || !mounted) return;
    if (_allDay) {
      setState(() => _end = date);
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_end ?? _start),
    );
    if (time == null || !mounted) return;
    setState(() {
      _end = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  Future<void> _publish() async {
    if (_titleController.text.trim().isEmpty) {
      AppToast.warning(context, 'Title is required');
      return;
    }
    setState(() => _publishing = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final startTs = _allDay
          ? DateTime(_start.year, _start.month, _start.day)
                  .millisecondsSinceEpoch ~/
              1000
          : _start.millisecondsSinceEpoch ~/ 1000;
      final endMs = _end?.millisecondsSinceEpoch;
      final endTs = endMs != null ? endMs ~/ 1000 : null;
      final tags = _tagsController.text
          .split(RegExp(r'[,\s]+'))
          .map((t) => t.trim().replaceAll(RegExp(r'^#'), ''))
          .where((t) => t.isNotEmpty)
          .toList();
      final event = nostr.createCalendarEvent(
        title: _titleController.text.trim(),
        start: startTs,
        end: endTs,
        location: _locationController.text.trim().isEmpty
            ? null
            : _locationController.text.trim(),
        description: _descriptionController.text.trim(),
        hashtags: tags.isEmpty ? null : tags,
      );
      await nostr.publishEvent(event);
      if (!mounted) return;
      ref.invalidate(calendarEventsProvider);
      Navigator.of(context).pop();
      AppToast.success(context, 'Event published');
    } catch (e) {
      if (!mounted) return;
      setState(() => _publishing = false);
      AppToast.error(context, 'Publish failed: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: SingleChildScrollView(
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
                  icon: const AppIcon('plus'),
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
            // All-day toggle
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('All-day event'),
              subtitle: const Text('No specific time (date-based)'),
              value: _allDay,
              onChanged: (v) => setState(() => _allDay = v),
            ),
            OutlinedButton.icon(
              onPressed: _pickStart,
              icon: const AppIcon('clock'),
              label: Text(
                _allDay
                    ? DateFormat('EEE, MMM d yyyy').format(_start)
                    : DateFormat('EEE, MMM d • h:mm a').format(_start),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _pickEnd,
              icon: const AppIcon('calendar'),
              label: Text(
                _end == null
                    ? 'Add end time (optional)'
                    : _allDay
                        ? 'Ends ${DateFormat('EEE, MMM d yyyy').format(_end!)}'
                        : 'Ends ${DateFormat('EEE, MMM d • h:mm a').format(_end!)}',
              ),
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
            const SizedBox(height: 12),
            TextField(
              controller: _tagsController,
              decoration: const InputDecoration(
                labelText: 'Hashtags, comma separated (optional)',
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
                  : const AppIcon('share'),
              label: const Text('Publish Event'),
            ),
          ],
        ),
      ),
    );
  }
}
