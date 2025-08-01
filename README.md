# NostrFeed - Decentralized Social Network

A modern Twitter-like Nostr client built with React, TypeScript, and TailwindCSS. Connect to the decentralized social network and share your thoughts with the world.

## Features

### 🌟 Core Features
- **Twitter-like Feed**: Browse the latest posts from the Nostr network
- **User Profiles**: View detailed user profiles with posts, bio, and metadata
- **Post Creation**: Create text posts with image attachments (up to 4 images)
- **Image Upload**: Upload images via Blossom servers with NIP-94 compatibility
- **Trending Content**: Discover trending hashtags and popular posts
- **Explore Page**: Find diverse content, new users, and interesting posts
- **Real-time Updates**: Feed refreshes automatically every 30 seconds
- **Responsive Design**: Works perfectly on desktop and mobile devices

### 🎨 Modern UI/UX
- **Clean Design**: Modern, Twitter-inspired interface
- **Light/Dark Mode**: Toggle between light and dark themes
- **Inter Font**: Beautiful typography with Inter Variable font
- **Purple Accent**: Modern purple color scheme
- **Smooth Animations**: Polished interactions and transitions
- **Loading States**: Skeleton loading for better UX

### 🔐 Nostr Integration
- **NIP-07 Login**: Secure login with browser extensions (Alby, nos2x, etc.)
- **Multiple Accounts**: Switch between different Nostr accounts
- **Profile Management**: Edit your Nostr profile
- **NIP-19 Support**: Handle npub, note, nevent, naddr, and nprofile identifiers
- **Relay Selection**: Choose from multiple preset relays or add custom ones

### 🛠 Technical Features
- **TypeScript**: Full type safety throughout the application
- **React 18**: Latest React with hooks and concurrent rendering
- **TailwindCSS**: Utility-first CSS framework
- **Vite**: Fast development and build tooling
- **shadcn/ui**: High-quality, accessible UI components
- **React Query**: Efficient data fetching and caching
- **React Router**: Client-side routing with NIP-19 support

## Getting Started

### Prerequisites
- Node.js 18+
- A Nostr browser extension (Alby, nos2x, etc.) for login

### Installation
```bash
npm install
npm run dev
```

### Building for Production
```bash
npm run build
```

### Running Tests
```bash
npm test
```

## Usage

### 1. Connect to Nostr
- Install a Nostr browser extension like [Alby](https://getalby.com/) or [nos2x](https://github.com/fiatjaf/nos2x)
- Click "Log in" and authorize the connection
- Your profile will be loaded automatically

### 2. Browse the Feed
- The home page shows the latest posts from the network
- Posts are sorted by newest first
- Click the refresh button to manually update the feed
- Switch relays to see content from different sources

### 3. Create Posts
- Click "New Post" in the sidebar or navigate to `/compose`
- Write your message (up to 280 characters)
- Optionally attach up to 4 images
- Click "Post" to publish to the network

### 4. View Profiles
- Click on any user's name or avatar to view their profile
- See their bio, website, location, and post history
- NIP-19 identifiers (npub, nprofile) are automatically handled

### 5. Customize Experience
- Toggle between light and dark mode with the theme button
- Switch between different Nostr relays
- Manage multiple accounts if you have them

## Relay Configuration

The app comes with several preset relays:
- **Primal** (default): `wss://relay.primal.net`
- **Ditto**: `wss://ditto.pub/relay`
- **Nostr.Band**: `wss://relay.nostr.band`
- **Damus**: `wss://relay.damus.io`

You can switch relays using the relay selector in the header or when no content is found.

## NIP Support

This client implements several Nostr Improvement Proposals (NIPs):
- **NIP-01**: Basic protocol flow
- **NIP-07**: Browser extension signing
- **NIP-19**: Bech32-encoded identifiers
- **NIP-94**: File metadata (for image uploads)

## Architecture

### Components
- **Layout**: Main application layout with navigation
- **Feed**: Twitter-like feed component
- **Post**: Individual post display with actions
- **Compose**: Post creation form with image upload
- **Profile**: User profile display
- **ThemeToggle**: Light/dark mode switcher

### Hooks
- **useFeed**: Fetch and manage feed data
- **useProfile**: Fetch user profile and posts
- **useAuthor**: Get user metadata by pubkey
- **useNostrPublish**: Publish events to Nostr
- **useUploadFile**: Upload files via Blossom servers

### Routing
- `/` - Home feed
- `/compose` - Create new post
- `/trending` - Trending hashtags and popular posts
- `/explore` - Discover diverse content and new users
- `/{npub}` - User profile
- `/{note}` - Individual note (placeholder)
- `/{nevent}` - Event with context (placeholder)
- `/{naddr}` - Addressable event (placeholder)

## Contributing

This project is built with modern web technologies and follows best practices:
- TypeScript for type safety
- ESLint for code quality
- Prettier for code formatting
- Vitest for testing
- React Testing Library for component tests

## Credits

Built with [MKStack](https://soapbox.pub/mkstack) - A modern development stack for Nostr applications.

## License

MIT License - feel free to use this code for your own projects!