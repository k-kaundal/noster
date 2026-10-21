import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Scaffold for pushed DETAIL routes (outside the tab shell): a proper
/// AppBar with a working back button, title, and optional actions.
///
/// Tab routes (/feed, /reels, /chat, /wallet) are wrapped by AppShell which
/// owns the AppBar. Everything ELSE (lists, calendar, communities, detail
/// pages) is a top-level route with NO shell — it needs its own AppBar or
/// there's no back button. This widget gives those screens a consistent one.
class DetailScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final List<Widget>? actions;
  final Widget? floatingActionButton;
  final PreferredSizeWidget? bottom;
  final Color? backgroundColor;
  final bool extendBodyBehindAppBar;

  const DetailScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions,
    this.floatingActionButton,
    this.bottom,
    this.backgroundColor,
    this.extendBodyBehindAppBar = false,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: backgroundColor,
      extendBodyBehindAppBar: extendBodyBehindAppBar,
      appBar: AppBar(
        title: Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          tooltip: 'Back',
          onPressed: () {
            HapticFeedback.lightImpact();
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            } else {
              // Deep-link entry with nothing to pop — go to the feed tab.
              Navigator.of(context).pushNamedAndRemoveUntil(
                '/feed',
                (route) => false,
              );
            }
          },
        ),
        actions: actions,
        bottom: bottom,
      ),
      body: body,
      floatingActionButton: floatingActionButton,
    );
  }
}
