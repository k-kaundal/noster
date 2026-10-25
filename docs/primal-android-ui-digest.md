# Primal Android — UI/UX Digest (portable patterns for Flutter port)

Repo: `PrimalHQ/primal-android-app` @ `main`. All values are exact from source.

## Shared theme constants (Ice = light, Midnight = dark)
Source: `theme/colors/Midnight.kt`, `theme/colors/Ice.kt`, `theme/AppTypography.kt`, `theme/AppShapes.kt`.

- Accent (primary/secondary): `#2394EF`; tertiary: `#0C7DD8` (both themes).
- Midnight: bg `#000000`, surface `#000000`, surfaceVariant `#000000`, outline `#222222`.
  extra: surfaceVariantAlt1 `#222222`, Alt2 `#121212`, Alt3 `#1A1A1A`; onSurfaceVariantAlt1 `#AAAAAA`, Alt2 `#AAAAAA`, Alt3 `#757575`, Alt4 `#666666`; onBrand `#D5D5D5`.
- Ice: bg `#F5F5F5`, surface `#F5F5F5`, surfaceVariant `#FFFFFF`, outline `#E5E5E5`.
  extra: surfaceVariantAlt1 `#E5E5E5`, Alt2 `#F5F5F5`, Alt3 `#EEEEEE`; onSurfaceVariantAlt1 `#111111`, Alt2 `#666666`, Alt3 `#808080`, Alt4 `#808080`; onBrand `#444444`.
- Semantic (zapped `#FFA02F`, liked `#F800C1`/`#CA079F`, reposted `#66E205`/`#52CE0A`, replied `#CCCCCC`/`#444444`, bookmarked `#0090F8`).
- Typography: font family "Nacelle". bodyLarge 18/22, bodyMedium 15/20, bodySmall 14/18, titleMedium 16/24 SemiBold, labelLarge 15/20, displayMedium 48/52 Bold. Shapes = Material3 defaults (small=8dp, medium=12dp, extraLarge=28dp rounded corners).
- `PrimalDivider` = 0.5dp `HorizontalDivider`, color `colorScheme.outline` (`core/compose/PrimalDivider.kt`).
- `PrimalDefaults.transparentOutlinedTextFieldColors()` — editor text fields (transparent bg/borders) (`core/compose/PrimalDefaults.kt`).

---

## 1. Notifications
File: `notifications/list/ui/NotificationListItem.kt` (+ `NotificationUi.kt` model).

- Item root: `Row`, background `colorScheme.surfaceVariant`, whole row clickable. Left icon column `padding(horizontal=16.dp)`, content column `fillMaxWidth`.
- Type icon: 32dp `Image`, `padding(top=12.dp)`; if reaction is a single emoji → render as `Text` 20sp `padding(top=16.dp)` instead.
- Extra stat under icon (zap/like/repost/reply totals): `padding(top=8.dp)`, `bodySmall`, `FontWeight.SemiBold`, color from `extraColorScheme` (zapped/liked/reposted/replied). Zap total = sum of `actionUserSatsZapped`.
- Grouped: `AvatarThumbnailsRow` (avatarOverlap=None, no border) then a `NostrUserText` line "X and N others <suffix>".
- Single: header = `WrappedContentWithSuffix` (avatar row + name + suffix text) with trailing timestamp.
- Unread indicator: Material `Badge` (dot) `containerColor = colorScheme.primary` at TopEnd next to timestamp.
- Timestamp: `bodySmall`, color `onSurfaceVariantAlt3`, `asBeforeNowFormat()`.
- Header paddings: top=12.dp, end=12.dp; bottom = 5.dp if referenced stream else 12.dp.
- Embedded note: `NoteContent` padded end=16.dp; `FeedNoteActionsRow` padded `vertical=16.dp, end=16.dp`.
- Replied-to notifications do NOT show the left icon; content gets `padding(start=16.dp)`.
- Suffix strings per `NotificationType` (follow/zap/like/repost/reply/mention/highlight/bookmark/live). Zap suffix variants: "zapped your post" vs "zapped your post for X sats"; live: "is live" / "was live".

---

## 2. Explore / Search
Files: `main/explore/ExploreHomeContent.kt`, `main/explore/landing/ExploreLanding.kt`, `explore/search/ui/SearchScreen.kt`, `explore/search/ui/UserProfileListItem.kt`, `explore/feed/ExploreFeedScreen.kt`.

- Explore top bar: `PrimalTopLevelAppBar` (title+subtitle+chevron) then a search "navbar" pill: `Row`, height 40.dp, `padding(horizontal=16.dp)`, clipped to `shapes.extraLarge`, bg `surfaceVariantAlt1`, leading `SearchFilled` icon + hint text (`onSurfaceVariantAlt3`), trailing `AdvancedSearch` icon 20.dp `padding(end=16.dp)`. Below: 16.dp spacer + `PrimalDivider`.
- Explore sections (HorizontalPager): Explore(landing), FeedGallery, FollowPacks, Zaps, Media.
- Landing: LazyColumn; sections spaced 24.dp top, horizontal padding 16.dp, inner spacing 16.dp. "Recent users": title `titleMedium` then grid of 4 columns; `UserCell` = avatar 44.dp + displayName `labelSmall` (alpha .7) centered, spacing 6.dp. "Recent searches": rows 42.dp high, `padding(horizontal=8.dp)`, query text 16sp `onSurfaceVariantAlt1`, trailing `ArrowUpLeftBlue` icon 12.dp in a 36.dp touch box; rows separated by `HorizontalDivider(outline)`.
- Search screen: `TopAppBar` title is an `OutlinedTextField` (transparent borders, single line, `ImeAction.Search`, autofocus). Leading back `ArrowBack`, trailing `AdvancedSearch` `AppBarIcon`. Results: a "search content" `ListItem` (search icon + query bold + scope label `onSurfaceVariantAlt4`) bracketed by dividers, then `UserProfileListItem`s.
- `UserProfileListItem`: `ListItem` container `surfaceVariant`; leading `UniversalAvatarThumbnail` 48.dp (default); headline displayName `bodyMedium` Bold maxLines 1; supporting nip05 formatted, color `onSurfaceVariantAlt4`; trailing = optional followers column (count Bold + "followers" `onSurfaceVariantAlt4`) and optional `FollowUnfollowButton` (minWidth 92.dp, height 36.dp). Whole row clickable.
- Explore feed screen (`ExploreFeedScreen`): `PrimalTopAppBar` with back + `PrimalLoadingButton` "save feed"/"remove feed" (height 36.dp, fontSize 14.sp, SemiBold, contentPadding h=18.dp, `padding(end=6.dp)`). Body: `NoteFeedList` (list) or `MediaFeedGrid` (grid) or `ArticleFeedList` (reads).

---

## 3. Note editor (compose)
Files: `editor/NoteEditorScreen.kt`, `editor/ui/NoteOutlinedTextField.kt`, `editor/ui/NoteAttachmentPreview.kt`, `editor/ui/MiniFloatingIconButton.kt`, `editor/ui/NoteUserTaggingLazyColumn.kt`, `editor/ui/poll/PollEditorSection.kt`.

- Scaffold: `PrimalTopAppBar` title="" nav `Icons.Outlined.Close`, `showDivider=true`, action = `PrimalLoadingButton` (publish) `padding(end=8.dp)`, height 34.dp, fontSize 14.sp, `FontWeight.Normal`, contentPadding h=24.dp. Publish text varies: "Post/Quote/Reply" (+ "...ing" while publishing), "Uploading..." while attachments upload. Disabled while publishing/uploading or attachment error; enabled when content non-blank or has attachments/gif.
- Layout: `LazyColumn` (bg `surfaceVariant`) + bottom footer; `imePadding()`. Editor row: `UniversalAvatarThumbnail` avatarSize 42.dp at `padding(start=16.dp, top=8.dp)`, tapping avatar (when no attachments) opens account switcher. Text field is offset x=-8.dp, fills width, transparent colors, placeholder/body `bodyMedium` lineHeight 20.sp, placeholder color `onSurfaceVariantAlt3`.
- Reply mode: `ReplyingToText` padded `start=68.dp(avatarsColumnWidth), end=16.dp, top=8.dp`. A 2.dp connection line (`StrokeCap.Square`, `outline` color) drawn vertically from avatar center up/down (x offset = 40.dp). Reply-to notes render `FeedNoteHeader` + `NoteContent` with the same connection line.
- Key dp constants: `avatarSizeDp=42`, `connectionLineOffsetXDp=40`, `attachmentsHeightDp=160`, `avatarsColumnWidthDp=avatarSize+24=66`, `contentEndPadding=16`.
- Attachments: `LazyRow` height 160.dp, contentPadding start=66/end=16, spacing 8.dp. `NoteAttachmentPreview`: image clipped `shapes.medium`, `ContentScale.FillHeight`, maxWidth = row max width. While uploading (`remoteUrl==null`): black overlay alpha 0.7 + centered `CircularProgressIndicator` (color `secondary`, track `Black`, round cap; determinate if byte progress known, min 5%). Error → centered retry `MiniFloatingIconButton` (Refresh). Discard = `MiniFloatingIconButton` (Close) at TopEnd.
- `MiniFloatingIconButton`: 32.dp circle, bg `Black.copy(alpha=0.5)`, 24.dp white icon, outer padding 4.dp (`editor/ui/MiniFloatingIconButton.kt`).
- Referenced nostr URIs (quoted notes/articles/invoices/highlights/streams): padded `start=68, end=16, bottom=8`; loading → 100.dp box with 48.dp `PrimalLoadingSpinner`; dismiss = TopEnd circle button bg `Black.copy(alpha=0.6)`, 24.dp `IconButton` white Close icon (`padding(top=8,end=8)`).
- Pending GIF: full-width image `heightIn(max=200.dp)`, clipped `shapes.medium`; uploading → black overlay alpha 0.4 + 36.dp white spinner; failed → overlay alpha 0.5 + "retry" TextButton (white text). Same dismiss button pattern.
- Footer: `HorizontalDivider(surfaceVariantAlt1)` then either mention-autocomplete list (`NoteTagUserLazyColumn`, `heightIn(0..288.dp)`, rows = `UserProfileListItem` with `containerColor=surface`) or action row.
- Action row: `padding(horizontal=2, vertical=4)`; icon buttons tinted `onSurfaceVariantAlt2`: gallery (`ImportPhotosIconButton`), GIF, camera (`TakePhotoIconButton`), Poll toggle, `@` mention (`Icons.Default.AlternateEmail`). In poll mode: trailing "remove poll" TextButton — 14.dp Delete icon + text, color `#FA3C3C`, `bodySmall`.
- Mention insertion: typing `@` triggers tagging mode; selecting a user replaces `@query` with handle + trailing space, cursor after handle. Tagged users highlighted with `colorScheme.secondary`.
- Poll editor (`PollEditorSection`): choice fields (shape `PollEditorDefaults.choiceFieldShape`), "+ add choice" row (Add icon 20.dp `secondary` + text `secondary`), dividers `outline` padded start/end, settings rows 44.dp high (label `onSurfaceVariantAlt2`, value `onSurface`), poll length = 3 numeric fields (days/hours/min, each `height 44.dp`, container `surfaceVariantAlt2`, contentPadding 10/6), zap-poll adds min/max zap amount rows (tap-to-edit → numeric field width 96.dp). Publish requires ≥2 non-blank choices and min≤max zap.

---

## 4. Messages / DMs
Files: `messages/conversation/MessageConversationListScreen.kt`, `messages/chat/ChatScreen.kt`.

- Conversation list: `PrimalTopAppBar` title "Messages" + footer tabs. Tabs "FOLLOWS"/"OTHER" (`bodySmall`, `onSurface`, minHeight 32.dp, no ripple), animated 4.dp indicator bar (primary, `shapes.small`) that slides/resizes between measured tab widths, offset -4.dp. Trailing "mark all read" (`bodySmall`, primary, minHeight 32.dp).
- FAB: 64.dp circle, bg `colorScheme.primary`, `NewDM` icon white, zero elevation.
- `ConversationListItem` (`ListItem`, container `surfaceVariant`): leading `UniversalAvatarThumbnail` (default 48). Headline = `NostrUserText` (name + verified badge) with suffix `" | <timestamp>"` styled `onSurfaceVariantAlt2`/`bodySmall` italic; trailing unread = 12.dp primary dot (CircleShape). Supporting = last message snippet: `renderContentAsAnnotatedString` (hashtags/links highlighted primary), prefixed "You: " when from user, `padding(top=4.dp)`, maxLines 2, `bodySmall`, color `onSurfaceVariantAlt2`. Rows separated by `PrimalDivider`.
- Chat screen: `PrimalTopAppBar` title=username, subtitle=nip05, trailing 32.dp avatar (tappable → profile). List bg `surfaceVariant`, `reverseLayout=true`, 8.dp spacers top/bottom.
- Bubbles (`ChatMessageListItem`): aligned End (mine) / Start (theirs). Colors: mine = `colorScheme.tertiary` (`#0C7DD8`) with white text/highlights; theirs = `extraColorScheme.surfaceVariantAlt1` with `onSurface` text / primary highlights. Shape depends on grouping:
  - First-in-group: mine `RoundedCornerShape(8,8,8,2)` (topStart,bottomStart,topEnd,bottomEnd), theirs `(8,2,8,8)`.
  - Continuation: mine `(8,8,2,2)`, theirs `(2,2,8,8)`.
  - Horizontal inset: my side free margin = 25% of max width on the opposite side, 16.dp on own side. Inner padding `horizontal=16, vertical=8`. Bottom padding 2.dp if timestamp shown else 4.dp.
- Timestamp shown when gap to next message > 15 min or sender changes: below bubble, `padding(horizontal=16.dp, bottom=8.dp)`, `bodySmall` 12.sp color `onSurfaceVariantAlt4`, long "before now" format.
- Input bar: `Column` bg `surface` + `PrimalDivider`; `MessageOutlinedTextField` padded h=8/v=8 with `imePadding`. Field = `CompactTextField` weight 1f, maxLines 6, shape `RoundedCornerShape(25%)`, placeholder "Message <user>". Send = 40.dp circle `padding(start=8)`, bg primary when enabled else `outline`, 24.dp white `ArrowUpward` (or `HourglassBottom` while sending).
- `CompactTextField` defaults (`core/compose/CompactTextField.kt`): bg `surfaceVariantAlt1`, contentPadding h=16/v=10, minHeight 20.dp, shape 50% rounded, cursor primary; disabled alpha 0.38.

---

## 5. Wallet
Files: `wallet/dashboard/ui/WalletDashboard.kt`, `WalletActions.kt`, `WalletCallToActionBox.kt`, `BtcAmountText.kt`, `wallet/transactions/list/TransactionListItem.kt`, `TransactionIcon.kt`, `TransactionsHeaderListItem.kt`, `wallet/WalletStaticColors.kt`.

- Dashboard: centered `Column`. Balance = `AnimatedContent` (SATS↔FIAT): `BtcAmountText`/`FiatAmountTextFromBtc` textSize 48.sp, tappable to toggle currency, `padding(vertical=16.dp)`, `padding(start=32.dp)`. `BtcAmountText`: number in `displayMedium` (48sp) with `TextAutoSize.StepBased` (min 50% of size), " sats" suffix in `bodyMedium` color `onSurfaceVariantAlt3` padded bottom = textSize/6.
- `WalletActionsRow`: `SpaceEvenly`; each action `PrimalCircleButton` 80.dp (`padding(horizontal=4)`), container `surfaceVariantAlt1` (disabled → `surfaceVariantAlt2`), icon 24.dp `onSurface`; label below = uppercase `bodySmall` color `onSurfaceVariantAlt3`, `padding(vertical=8)`. Haptic LongPress on tap. Actions: Send (`WalletPay`), Scan (`QrCode`), Receive (`WalletReceive`).
- Static colors (`WalletStaticColors.kt`): deposit/success `#2CA85E`, withdraw `#CC331E`, tx icon bg `#222222`, lightning tx icon radial gradient `#3CC9FC`→`#198AE5` (alpha 0.33).
- `TransactionListItem` (`ListItem`, container `surfaceVariant`): leading = other user's `UniversalAvatarThumbnail` (tappable) OR `TransactionIcon` 48.dp (on-chain: bitcoin glyph tinted `zapped` on `#222222` circle; lightning: `LightningBlue` on radial-gradient circle, 8.dp inner padding). Pending → 18.dp `Schedule` icon badge bottom-end + whole-row alpha pulsing 1.0↔0.5 (1s infinite reverse).
- Headline: `WrappedContentWithSuffix` — displayName (or "Bitcoin"/"Lightning") `bodyLarge` Bold + suffix `" | HH:mm"` (or "| pending") `bodyMedium` `onSurfaceVariantAlt4`.
- Supporting: txNote if present else "Zap received/sent" / "Payment received/sent"; `bodyMedium` `onSurfaceVariantAlt1`.
- Trailing: column (end-aligned) amount `bodyLarge` Bold + suffix "sats"/"USD" `bodySmall` `onSurfaceVariantAlt1`, then 16.dp direction icon — `WalletReceive` tinted `#2CA85E` (deposit) or `WalletPay` tinted `#CC331E` (withdraw); row spacing 8.dp, amount minWidth 45.dp, `AnimatedContent` on currency toggle.
- Day section headers (`TransactionsHeaderListItem`): centered text over a full-width 0.5.dp divider; text bg `surfaceVariant`, `padding(horizontal=8)`, `bodySmall` `onSurfaceVariantAlt3`; container `padding(vertical=8)`.
- Empty/CTA: `WalletCallToActionBox` — centered message `bodyMedium` `onSurfaceVariantAlt4` `padding(16)` + full-width `PrimalFilledButton`. Wallet setup: title `bodyLarge` Bold, description `bodyMedium` `onSurfaceVariantAlt4`, primary "restore" filled button full-width, secondary "create new" TextButton (text `secondary`, SemiBold).

---

## 6. Drawer / main navigation
Files: `drawer/PrimalDrawer.kt`, `drawer/PrimalMainScaffold.kt`, `core/compose/PrimalNavigationBar.kt`.

- Drawer: full-height `Column`, `navigationBarsPadding`, `padding(top=16.dp)`. Header `Row` padded `start=24, end=12`: left column = `NostrUserText` (name + 24.dp verified badge + legendary) + QR `IconButton` (tint `onSurfaceVariantAlt2`), nip05 below (`labelLarge` `onSurfaceVariantAlt2`), stats row `padding(top=16)`: "<following> Following   <followers> Followers" — numbers `onBrand`, labels `onSurfaceVariantAlt3` (`labelLarge`). Right = `AccountSwitcher`.
- Menu: `LazyVerticalGrid` 3 columns, spacing 10.dp, `contentPadding h=16`, `padding(top=32.dp)`. Tile = `Surface` aspectRatio 1f, `RoundedCornerShape(12.dp)`, bg `surfaceVariantAlt1`; content `Column` padded v=14/h=8, spacing 14: 28.dp icon in `BadgedBox` + label `labelLarge` centered maxLines 2, all tinted `onSurfaceVariantAlt2`. Badge = 8.dp primary dot offset (6,-6) shown on Premium (if `showPremiumBadge`) and Messages (if unread>0). Destinations: Profile, Premium, Messages, Bookmarks, ScanCode(QrCode), RemoteLogin, Settings, SignOut. Bottom: `PrimalOverlayBottomBar` with close button.
- Bottom nav (`PrimalNavigationBar`): top `PrimalDivider`, bar height 64.dp (`NavigationBarFullHeightDp`), bg `surface`, plus a system-nav-insets spacer below (bg `surface`). 5 destinations: Feeds, Reads, Wallet, Alerts, Explore.
  - Sliding "pill": 72.dp wide × 52.dp high, `CircleShape`, bg `surfaceVariantAlt1`, top offset 4.dp; x offset animated with spring(dampingRatio 0.75, stiffness Medium) centered under active item; item width = (maxWidth - 24)/5, horizontal padding 12.dp.
  - Item: `Column` centered, 24.dp icon in `BadgedBox` + 8.dp gap + label `bodySmall` 10.sp/10; selected tint `onSurface`, unselected `onSurface` alpha 0.75. Badge = primary dot (only Alerts wired to `unreadNotificationsCount`). Tapping active destination → scroll-to-top callback.
  - Scroll behavior (`PrimalMainScaffold`): bottom bar collapses with top app bar (`collapsedFraction`); FAB fades/rotates (max 45°) and translates down; "new data" pill host at top padding 42.dp; focus mode when collapsedFraction > 0.5.

---

## 7. Core compose kit (reusable primitives)
Dir: `core/compose/` (root files + `button/`, `fab/`, `bubble/`, `zaps/`, `indicator/`).

- `PrimalDivider` — 0.5.dp, `colorScheme.outline`.
- `PrimalTopAppBar` — `CenterAlignedTopAppBar`, container `surface`; nav = 32.dp avatar or 22.dp `AppBarIcon`; title `IconText` (20.sp icon) + optional subtitle `bodySmall` `onSurfaceVariantAlt3`; optional footer slot + bottom divider (`showDivider` default true).
- `PrimalScaffold` — standard scaffold wrapper; `PrimalTopLevelAppBar` variant with pager tabs & avatar.
- Buttons (`core/compose/button/`):
  - `PrimalFilledButton` / `PrimalLoadingButton`: height default 58.dp, shape `shapes.extraLarge` (28dp), container `primary`, content white; disabled container `surfaceVariantAlt1`, disabled content `onSurfaceVariantAlt2`. Loading = 12.dp `CircularProgressIndicator` stroke 2.dp. Default text `bodyLarge` SemiBold.
  - `FollowUnfollowButton`: follow → container `onSurface`/content `surface`; following → container `surfaceVariantAlt1`/content `onSurface`; text lowercase, `titleMedium` 14sp; contentPadding h=4/v=8.
  - `PrimalCircleButton`: circular bg + unbounded ripple; default container `primary`, content white (`core/compose/PrimalCircleButton.kt`).
- Avatars:
  - `UniversalAvatarThumbnail` — size param (default 48.dp); outer+inner border sizes scale with size (outer: 3.5dp ≥121, 2.5dp 112-120, 1.5dp 64-112, 1dp 32-64, 0.5dp 24-32; inner: 1.5dp ≥121, 1dp 64-120, 0.5dp 24-64). Legendary glow = gradient border brush from `legendaryStyle.primaryBrush` + inner background ring (`colorScheme.background`). `isLive` adds primary-color border + `LiveChip` at bottom center. Default placeholder = `AvatarDefault` icon on `surfaceVariantAlt1`. Combined click/long-click.
  - `AvatarThumbnailsRow` — overlap modes Start/End/None; avatarSize 32.dp, spacing 4.dp, overlap 25%, border 2.dp; overflow "+N" chip (bg `#C8C8C8`, text `#111111`, 12.sp).
  - `LiveChip` — black pill (`shapes.extraLarge`) with red dot + "LIVE" white ExtraBold; all metrics scale from avatar size (dot 8%, h-padding 9%, v-padding 3.6%, font 14%, letterSpacing 1.1% of width).
- Text fields: `PrimalOutlinedTextField`, `CompactTextField` (see §4), `PrimalIconTextField`, `OtpTextField`, `NoteOutlinedTextField` (see §3). `PrimalDefaults.outlinedTextFieldColors` default container `surfaceVariantAlt1` both states, error border `error` α0.5.
- Empty/loading states:
  - `ListNoContent` — fades in after 500ms; centered message (`padding h=32`) + "REFRESH" TextButton (uppercase) optional.
  - `PulsingListItemPlaceholder` / `heightAdjustableLoadingLazyListPlaceholder` / `GridLoadingPlaceholder` — Lottie shimmer (`primal_loader_generic_square_dark/light`), shape `shapes.small`, scale 25f.
  - `PrimalLoadingSpinner` — centered spinner (48.dp typical).
  - `ListLoadingError` — error + retry.
- Misc: `NostrUserText` (name + verified badge + legendary + suffix builder), `IconText` (text + leading/trailing icon), `ReplyingToText`, `PrimalBottomSheetDragHandle`, `PrimalOverlayBottomBar`/`PrimalOverlayCloseButton`, `ConfirmActionAlertDialog`, `PremiumFeedPaywall`, `WrappedContentWithSuffix` (flex text + fixed suffix), `HorizontalPagerIndicator`, `AppBarIcon`, `ImportPhotosIconButton`/`TakePhotoIconButton`, bubble/`AnchoredBubble` (tooltip anchors).

---

## 8. Stream / live
Files: `stream/ui/StreamLiveIndicator.kt`, `LiveStreamColors.kt`, `LiveStreamOverlay.kt`, `stream/ui/*` (LiveStreamScreen.kt, LiveStreamMiniPlayer.kt, LiveStreamPlayerControls.kt, StreamChatItem.kt, ChatMessageDetailsSection.kt, StreamTopZapsSection.kt).

- Overlay architecture: `LiveStreamOverlay` wraps app content; `StreamMode.Expanded` → full `LiveStreamScreen`; `Minimized`/`Hidden` → draggable `LiveStreamMiniPlayer` (width = screen/2, height per 16:9 ratio, padding `PADDING`, offsets animated; tap to expand, close to stop). Back from Expanded → minimize (or stop if finished). PiP supported.
- `StreamLiveIndicator`: Row spacing 4.dp; 6.dp dot (CircleShape) — live `#EE0000`, not-live `#757575` (dark) / `#666666` (light); optional "LIVE" text default 14.sp, color `onSurfaceVariantAlt4`.
- Stream chat colors (`LiveStreamColors.kt`): zap message border `#E47C00`, zap message bg `#E47C00` @ 20% alpha; zap sender handle `#FFA02F` (dark) / `#E47C00` (light). Bottom sheets: primary bg `#121212`/`#F5F5F5`, secondary bg `#222222`/`#E5E5E5`, divider `#333333`/`#D5D5D5`. Chat bg black (dark) / white (light).
- `ChatMessageDetailsSection` (moderation sheet): `Column` padded 16.dp spacing 12.dp; "Message" label `bodyLarge` 15.sp (`onSurfaceVariantAlt4` dark / `Alt2` light); content slot; report button = `PrimalFilledButton` height 37.dp, container `ReportButtonHandleColor` (`#333`/`#D5D5D5`), content `onSurface`, icon 20.dp + "Report message", contentPadding h=18.
- Top zaps section (`StreamTopZapsSection.kt`) and zap leaderboard bottom sheet (`StreamZapLeaderboardBottomSheet.kt`) reuse `EventZapItem`/`ZappersAvatarThumbnailRow` patterns (see §7/zaps).

---

## 9. Zap bottom sheet
File: `notes/feed/zaps/ZapBottomSheet.kt` (+ `UnableToZapBottomSheet.kt`, `ZapPollBottomSheet.kt`; defaults in `domain/primal/.../ContentZapConfigItem.kt`; `ZAP_ACTION_DELAY=1100` in `core/compose/zaps/Constants.kt`).

- `ModalBottomSheet` `containerColor = extraColorScheme.surfaceVariantAlt2`, `tonalElevation=0`, `skipPartiallyExpanded=true`. Content `Column` centered, `padding(bottom=8.dp)`.
- Title: single annotated `Text` centered, `padding(horizontal=16)`: "ZAP <NAME> " (`onSurfaceVariantAlt1`, Bold, 20.sp) + "<amount> " (`onSurfaceVariant`, Black, 20.sp) + "SATS" (`onSurfaceVariantAlt1`, Bold, 14.sp). Amount live-updates with selection.
- Preset grid: `LazyVerticalGrid` 3 columns, contentPadding 12.dp. `ZapOption` cell: `padding(12.dp)`, `requiredSize(88.dp)` square, clip `shapes.small`, bg = selected ? `colorScheme.surface` : `surfaceVariantAlt1`; selected adds 1.dp border `colorScheme.tertiary`. Inside: emoji 28.sp Black `padding(bottom=8)` + amount `shortened()` 20.sp SemiBold color `onPrimary`. Default presets: 👍21, 🚀420, ☕1k, 🍻5k, 🍷10k, 👑100k (each with default message).
- Custom amount field: `OutlinedTextField` full-width `padding(horizontal=24)`, single line, transparent borders (`PrimalDefaults.outlinedTextFieldColors` unfocused/focused = Transparent), shape `RoundedCornerShape(8.dp)`, numeric keyboard + `ImeAction.Done`; digits only, ≤8 chars, >0.
- Comment field: same styling, single line, placeholder "Add a comment..." (`onSurfaceVariantAlt4`). 16.dp spacers between fields.
- Zap CTA: `PrimalLoadingButton` full-width height 56.dp `padding(horizontal=24)`, text "Zap" + leading zap drawable icon; hidden while keyboard visible. 1.1s cooldown to prevent double-tap; dismisses then fires `onZap(amount, comment)`.
- Default single-tap zap (long-press opens sheet): `ContentZapDefault(amount=42, message="Onward 🫡")`.

---

### Cross-cutting interactions worth porting
- Currency toggle: tap balance/amounts to switch SATS↔FIAT with `AnimatedContent`.
- Pending states: pulsing alpha (1.0↔0.5, 1s) on pending wallet txs; black overlay + spinner on uploading media.
- Unread indicators: 12.dp primary dots (DMs), `Badge` dots (notifications, drawer, bottom nav).
- Timestamps: `asBeforeNowFormat()` short in lists, long in chat bubbles; 15-min grouping threshold in chat.
- Haptics: LongPress feedback on wallet action buttons.
- Scroll-linked chrome: top app bar + bottom bar collapse together; FAB rotates/fades.
