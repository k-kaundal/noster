# NostrFeed Advanced Features Guide

A comprehensive guide to all advanced features and where to find them in NostrFeed.

## 🎯 Table of Contents

- [UI & Appearance](#ui--appearance)
- [Wallet Features](#wallet-features)
- [Discovery & Trending](#discovery--trending)
- [Profile Features](#profile-features)
- [Content & Engagement](#content--engagement)
- [Community Features](#community-features)
- [User Analytics](#user-analytics)
- [Advanced Settings](#advanced-settings)

---

## 🎨 UI & Appearance

### Professional UI Mode
**Location**: Settings → UI → Interface Enhancements

Enhanced post layout with professional design patterns inspired by Twitter/X. Includes:
- X-inspired post component (PostX) with clean header and engagement stats
- Better typography hierarchy
- Improved spacing and visual organization
- Cleaner action buttons

**How to use**:
1. Navigate to Settings
2. Click the "UI" tab
3. Toggle "Professional UI Mode" switch
4. Reload to see changes applied

### Advanced Themes (13+ Professional Presets)
**Location**: Settings → UI → Advanced Themes

Choose from premium theme collections:

#### Inspired Themes (Twitter/X-style)
- **X Light**: Clean, minimal light theme
- **X Dark**: High-contrast dark theme

#### Premium Corporate Themes
- **Premium Blue**: Professional blue with gold accents
- **Premium Purple**: Elegant purple with silver accents
- **Premium Teal**: Modern teal with rose gold accents

#### Corporate Theme
- **Corporate Slate**: Professional slate gray for enterprises

#### Minimal Themes (Distraction-free)
- **Minimal Air**: Ultra-light minimal design
- **Dark Charcoal**: Deep charcoal with subtle accents

#### Creative Themes (Expressive)
- **Sunset Gradient**: Warm sunset colors
- **Forest Deep**: Natural forest greens
- **Ocean Wave**: Cool ocean blues with seafoam

#### Crypto-themed (Web3)
- **Bitcoin Gold**: Bitcoin orange and gold
- **Lightning Electric**: Electric yellow

**How to use**:
1. Go to Settings → UI
2. Browse theme categories (Inspired, Premium, Corporate, Minimal, Creative, Crypto)
3. Click any theme card to apply instantly
4. Your preference saves automatically

---

## 🔍 Discovery & Trending

### Discovery Page
**Location**: Discovery page (`/discovery`)

A dedicated space to find trending and popular content across the platform:

#### Trending Posts
- Shows the most engaged-with posts in your selected time range
- Sorted by replies, reposts, and likes
- Click to view the full post and discussion

#### Trending Topics
- Most discussed hashtags and topics
- See what everyone is talking about
- Click to view all posts with that hashtag

#### Rising Users
- Users gaining followers rapidly
- Discover interesting creators
- Click to view their profile and posts

#### Active Communities
- Communities with most recent activity
- See where discussions are happening
- Join communities that interest you

#### Time Range Filtering
Select how far back to look:
- **Right now**: Last hour of activity
- **Last 24 hours**: Daily trends
- **Last 7 days**: Weekly trends
- **Last 30 days**: Monthly trends

**How to use**:
1. Navigate to Discovery (`/discovery`)
2. Browse trending content in each category
3. Select different time ranges to see how trends change
4. Click any item to explore further

### Understanding Engagement Scores
Each trending item displays an engagement score:
- **Engagement Score**: Combined metric of likes, replies, reposts, and impressions
- **Time Weighting**: Recent content weighted higher (decays over 7 days)
- **Activity Indicator**: ⚡ shows engagement level

---

## 💰 Wallet Features

### Enhanced Wallet Dashboard
**Location**: Wallet page (`/wallet`)

Professional wallet management interface with:
- Real-time balance display in sats
- Lightning address display for receiving zaps
- Quick access to send/receive functions

### Improved Activity Display
**Location**: Wallet → Activity section

Advanced transaction history with:
- **Sorted transactions**: Newest first with relative timestamps (just now, 2h ago, etc.)
- **Transaction count**: Shows total number of transactions
- **Expandable details**: Click any transaction to see:
  - Completion status (pending/completed)
  - Amount in millisats (msat)
  - Payment memo/description
  - Payment hash for verification
- **Pagination**: Shows latest 10 transactions with indicator of total
- **Visual indicators**: 
  - Incoming (green) vs. outgoing (gray) transactions
  - Pending status highlighting

**How to use**:
1. Navigate to your Wallet page
2. Scroll to the "Activity" section
3. View recent transactions with timestamps
4. Click any transaction to expand and see full details
5. Check payment hash for verification if needed

### Send & Receive Functions
**Location**: Wallet → Send/Receive buttons

- **Receive**: Get a Lightning invoice for incoming payments
- **Send**: Send sats to another Lightning address

### Lightning Address Management
**Location**: Wallet → Balance card

Your personal Lightning address (`name@address`) for receiving zaps from any Nostr client.

### Relay Access Purchase
**Location**: Wallet → Premium relay section

Use your sats to purchase relay access and other premium features.

---

## 👤 Profile Features

### Spotlight / Featured Items
**Location**: User Profile → Spotlight section (above Notes/Replies tabs)

Showcase your best content and connections:

#### Spotlight Types
- **Posts**: Featured note posts
- **Articles**: Long-form content
- **Communities**: Highlighted communities you're part of
- **Users**: Featured people you want to highlight

#### Using Spotlight (Own Profile)
1. Go to your profile
2. Look for the Spotlight section with star icon
3. Click "Add featured items" (or "Edit" if you have items)
4. Select posts, articles, communities, or users to feature
5. Arrange them in display order
6. Changes save automatically

#### Viewing Spotlight (Other Profiles)
- Visit any profile to see their featured items
- Click on any spotlight item to view that post, article, community, or user profile
- Spotlight items show type icon and description

**Storage**: Uses Nostr kind 30000 addressable event with d-tag "spotlight"

### Profile Statistics
**Location**: User Profile → Header card

View important stats:
- Total notes posted
- Following count (with link to following list)
- Followers count (with link to followers list)
- Join date (when first post was made)

### User Bio & Social Links
**Location**: User Profile → Bio section

Display:
- Profile bio/about text (supports links and mentions)
- Location (if set)
- Website link (clickable)
- Lightning address (for receiving zaps)
- Join date

### Profile Tabs
**Location**: User Profile → Below header

Browse user content organized by type:
- **Notes**: Original posts
- **Replies**: Responses to other posts
- **Articles**: Long-form published content
- **Media**: Posts with images or videos

---

## 💬 Content & Engagement

### X-Inspired Post Design (PostX)
**Location**: Feed and profile when Professional UI Mode is enabled

Modern post component featuring:
- Clean header with avatar, name, handle, timestamp
- Readable content area with proper typography
- Engagement stats (replies, reposts, likes, impressions)
- Action buttons with hover effects
- Responsive design for all screen sizes
- Better visual hierarchy

### Rich Post Content
**Location**: All posts

Posts support:
- Text content with proper formatting
- Links (clickable)
- Mentions (@username)
- Hashtags (#topic)
- Emojis
- Images and videos

### Comments System
**Location**: Individual posts → Comments section

NIP-22 based commenting:
- Add comments to any post
- Reply to other comments
- See nested comment threads
- Real-time comment updates

---

## 📊 User Analytics

### Personal Analytics Dashboard
**Location**: User Profile → Analytics section

Comprehensive statistics about your activity and engagement:

#### Key Metrics
- **Posts**: Total original notes you've published
- **Replies**: Responses and discussions you've participated in
- **Likes**: Reactions received (heart reactions)
- **Reposts**: Times others have reposted your content
- **Articles**: Long-form pieces published
- **Engagement Score**: Your daily engagement rate

#### Account Statistics
- **Account Age**: Days since your first post
- **Activity Breakdown**: Pie chart showing content distribution
  - Posts vs. Replies vs. Articles
  - Visual percentage breakdown
- **Last Active**: When you last posted

#### Using Analytics
1. Visit your profile
2. Look for the "Analytics" section
3. View your stats and trends:
   - Compare your content types
   - Track engagement over time
   - Identify your best-performing content

#### Engagement Score Calculation
Your engagement score is calculated as:
```
(Likes × 1 + Replies × 2 + Reposts × 3 + Posts × 0.5) / Account Age Days
```

This gives your average engagement per day, so newer accounts and highly active accounts both show accurately.

### Visitor Analytics (View Others' Stats)
When viewing someone else's profile, you can see their public analytics:
- See how active they are
- Understand their content mix
- Identify influential users in your network

---

## 👥 Community Features

### Community Profiles
**Location**: Navigate to community from profile or search

View community:
- Community information
- Member count
- Posts and discussions
- Community rules (if set)

### Featured Communities (Spotlight)
**Location**: User Profile → Spotlight section

Users can feature communities they're part of to highlight their affiliations and values.

### Community Spotlight Management
**Location**: Community page → Spotlight settings (admin only)

Community admins can feature:
- **Rising Members**: Highlight valuable community members
- **Featured Posts**: Showcase great discussions and content
- **Community Announcements**: Pin important updates

**How to use** (Community Admin):
1. Navigate to your community page
2. Access community settings
3. Manage spotlight items:
   - Add posts that exemplify community values
   - Feature members who contribute significantly
   - Organize items in display order
4. Changes apply immediately to community page

**Viewing Community Spotlight** (Members):
- Visit any community page
- See featured members and posts prominently displayed
- Click items to explore more

### Community Treasury
**Location**: Community page → Treasury section (if community has one)

Shared wallet for community funding:
- Pool resources for community initiatives
- Transparent transaction history
- Democratic fund allocation

---

## ⚙️ Advanced Settings

### Appearance Settings
**Location**: Settings → Appearance

- **Accent Color Picker**: Customize primary accent color
- **Light/Dark Mode Toggle**: Follow system, light, or dark mode

### Mute List Management
**Location**: Settings → Muted

Advanced content filtering:
- **Mute People**: Hide all posts from specific users
- **Mute Words**: Hide posts containing specific words (whole-word match)
- **Mute Hashtags**: Hide posts tagged with specific hashtags

### Private Message Relays (NIP-17)
**Location**: Settings → Messages

Configure where private messages are delivered:
- Select relays for NIP-17 message delivery
- Publish relay list for message routing
- Ensure others know where to send your messages

### Wallet Connections
**Location**: Wallet page → Account Card

Connect different wallet types:
- LNbits (custodial)
- WebLN (browser-based)
- Nostr Wallet Connect (NWC)

---

## 🔍 Finding Advanced Features

### Feature Discovery Checklist

**For UI Customization:**
- Settings → Appearance (colors, light/dark mode)
- Settings → UI (professional mode, themes)

**For Discovery & Trending:**
- Discovery page (`/discovery` or main menu)
- Trending sections for posts, topics, users, communities
- Time range filters (now, 24h, 7d, 30d)

**For Wallet Management:**
- Wallet page (balance, send/receive, activity)
- Transaction details (click to expand)

**For Profile Enhancement:**
- Profile page → Spotlight section (featured items)
- Profile page → Analytics section (stats and metrics)
- Profile page → Edit profile (bio, links, avatar)

**For Content Management:**
- Settings → Muted (filter posts)
- Settings → Messages (private message relays)

**For Analytics:**
- User Profile → Analytics (your stats)
- Other profiles → Analytics (view others' stats)

**For Community Management:**
- Community pages → Spotlight (featured items)
- Community Treasury (if enabled)

**For Engagement:**
- Comments on individual posts
- Spotlight items on profiles and communities
- Follow/Unfollow buttons
- Trending discovery

### Smart Search
Most advanced features are accessible through:
1. Main navigation (Wallet, Settings)
2. User profile settings (if on your own profile)
3. Direct page navigation (`/wallet`, `/settings`)

---

## 💡 Pro Tips

### Theme Customization
- Change themes instantly without page reload
- Themes persist across sessions
- Mix theme with light/dark mode for more options

### Wallet Activity
- Click transactions to see full details
- Use timestamps to track when payments occurred
- Check payment hash for verification with external services

### Spotlight Strategy
- Feature your best content to new visitors
- Highlight communities for credibility
- Showcase important users you collaborate with

### Content Filtering
- Use mute list to maintain a clean feed
- Mute words instead of people for better control
- Check mute list regularly to update preferences

### Privacy
- Review relay selections for private messages
- Understand which wallets have access to your funds
- Backup your profile regularly

---

## 🚀 Advanced Workflows

### Workflow 1: Professional Profile Setup
1. Customize appearance (Settings → Appearance)
2. Enable Professional UI (Settings → UI)
3. Choose premium theme (Settings → UI → Advanced Themes)
4. Add spotlight items (Profile → Spotlight)
5. Connect wallet (Wallet page)
6. Configure message relays (Settings → Messages)

### Workflow 2: Privacy-Focused Experience
1. Configure mute list (Settings → Muted)
2. Set up message relays (Settings → Messages)
3. Choose minimal UI theme (Settings → UI)
4. Disable optional tracking features
5. Review wallet privacy settings

### Workflow 3: Creator Monetization
1. Connect Lightning wallet (Wallet page)
2. Set up Lightning address (appears in Wallet)
3. Feature best content (Profile → Spotlight)
4. Enable zap notifications (Settings)
5. Share your Lightning address with audience

---

## 📚 Feature References

### Built-in Documentation
- **UI_OVERHAUL_GUIDE.md**: Detailed UI features and usage
- **BRANDING_GUIDE.md**: Brand identity and design standards
- **PROFESSIONAL_UI_INTEGRATION.md**: Professional UI component guide

### Nostr Resources
- Features built on Nostr protocol
- Compatible with other Nostr clients
- NIP-based standards for interoperability

---

## ❓ Troubleshooting

### Theme Not Applying
- Clear browser cache
- Refresh page after theme selection
- Verify localStorage is enabled

### Wallet Activity Not Showing
- Check relay connectivity
- Wait for relay sync (may take a few seconds)
- Verify wallet connection is active

### Spotlight Items Not Appearing
- Ensure you're on your own profile to edit
- Click "Edit" button if items exist
- Add items and they should appear immediately

### Profile Changes Not Saving
- Verify you're logged in
- Check internet connection
- Allow a few seconds for relay publication

---

## 🔗 Quick Links

- Wallet: `/wallet`
- Settings: `/settings`
- Discovery: `/discovery`
- Profile: `/` (your profile) or `/{npub}` (other profiles)
- Your Spotlight: Profile → Spotlight section
- Analytics: Profile → Analytics section

---

Last Updated: August 2026
Version: 1.1 (Added Discovery, Trending, Analytics, and Community Spotlight)
