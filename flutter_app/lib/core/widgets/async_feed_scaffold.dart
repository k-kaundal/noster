import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

/// Generic scaffold body for "a list of items from an AsyncValue".
///
/// Collapses the pattern that was previously copy-pasted into ~10 screens:
/// `RefreshIndicator` + `AsyncValue.when(data: ListView, error: _ErrorView,
/// loading: _XSkeleton)` + empty state.
///
/// Usage:
/// ```dart
/// AsyncFeedList<NostrEvent>(
///   value: ref.watch(groupsProvider),
///   onRefresh: () => ref.refresh(groupsProvider.future),
///   itemBuilder: (context, group) => GroupTile(group: group),
///   emptyState: const EmptyState(icon: Icons.group_outlined, title: 'No groups'),
/// )
/// ```
class AsyncFeedList<T> extends StatelessWidget {
  final AsyncValue<List<T>> value;

  /// Called on pull-to-refresh and on the error view's Retry button.
  /// Typically `() => ref.refresh(myProvider.future)`.
  final Future<void> Function() onRefresh;

  /// Builds a tile for one item.
  final Widget Function(BuildContext context, T item) itemBuilder;

  /// Shown when the loaded list is empty.
  final Widget emptyState;

  /// Loading placeholder. Defaults to [SkeletonList].
  final Widget? loadingView;

  /// Separator between items (e.g. `Divider`). Null = no separator.
  final Widget? separator;

  final EdgeInsetsGeometry? padding;

  const AsyncFeedList({
    super.key,
    required this.value,
    required this.onRefresh,
    required this.itemBuilder,
    required this.emptyState,
    this.loadingView,
    this.separator,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => loadingView ?? const SkeletonList(),
      error: (error, _) => ErrorView.fromError(error, onRetry: onRefresh),
      data: (items) {
        if (items.isEmpty) {
          // Still pull-to-refreshable when empty.
          return RefreshIndicator(
            onRefresh: onRefresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [SizedBox(height: 400, child: emptyState)],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: onRefresh,
          child: separator != null
              ? ListView.separated(
                  padding: padding,
                  itemCount: items.length,
                  separatorBuilder: (_, _) => separator!,
                  itemBuilder: (context, i) => itemBuilder(context, items[i]),
                )
              : ListView.builder(
                  padding: padding,
                  itemCount: items.length,
                  itemBuilder: (context, i) => itemBuilder(context, items[i]),
                ),
        );
      },
    );
  }
}
