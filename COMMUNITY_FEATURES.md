# NostrFeed Community Features Guide

Based on Nostr protocol standards (NIP-72 and related NIPs), NostrFeed supports comprehensive community management.

## 📚 References

- [NIP-72: Moderated Communities](https://github.com/nostr-protocol/nips/blob/master/72.md) - Reddit-style communities with moderator approval
- [NIP-05: Nostr Address (Verification)](https://github.com/nostr-protocol/nips/blob/master/05.md) - DNS-based identity verification
- [Nostrbook: Groups Comparison](https://nostrbook.dev/groups) - Implementation guide

## 🏘️ Community Structure (NIP-72)

Communities are defined using **kind 34550** addressable events with the following structure:

### Community Metadata Tags

```json
{
  "kind": 34550,
  "tags": [
    ["d", "community-slug"],           // Unique identifier
    ["name", "Community Name"],         // Display name
    ["description", "About"],           // Community description
    ["image", "https://url/image.png"], // Banner/logo image
    ["p", "pubkey", "", "moderator"],  // Moderator (can be repeated)
    ["relay", "wss://relay.url"]       // Preferred relay (can be repeated)
  ]
}
```

### Key Features

- **Creator**: The author of the kind 34550 event (always a moderator)
- **Moderators**: Listed in `p` tags with `moderator` marker
- **Slug**: Unique `d` tag identifier (e.g., "general", "news")
- **Address**: `34550:pubkey:slug` - used to reference the community

## 🛡️ Moderator System

### Moderator Responsibilities

1. **Approve/Reject Posts** - Using kind 4550 approval events
2. **Manage Community** - Edit metadata, add/remove moderators
3. **Set Policies** - Via community description

### Verification

Moderators are verified through:
- **Cryptographic signatures** - Events signed with their private keys
- **Public key verification** - P tags with their pubkey in community definition
- **Relay attestation** - Optional relay endorsement (via NIP-65)
- **NIP-05 verification** - Optional DNS verification for moderators

## 📝 Community Editing

Only moderators can edit community properties:

- **Name**: Community display name
- **Description**: Community rules, purpose, topic
- **Image**: Banner or logo URL
- **Moderators**: Add/remove other moderators
- **Relays**: Set preferred relays for this community

### Edit Process

1. Moderator clicks "Edit Community"
2. Updates metadata in a form
3. Publishes new kind 34550 event
4. Changes take effect immediately

## ✅ Post Approval System (NIP-72)

### Post Submission

Users post with community `a` tag:
```json
{
  "kind": 1,
  "tags": [
    ["a", "34550:creator-pubkey:slug"],
    ["t", "topic"]
  ],
  "content": "Post content"
}
```

### Approval Process

Moderators issue **kind 4550** approval events:
```json
{
  "kind": 4550,
  "tags": [
    ["a", "34550:creator-pubkey:slug"],  // Which community
    ["e", "event-id"],                    // Post event ID
    ["p", "author-pubkey"]                // Author notification
  ]
}
```

Only approved posts show in the main feed. Unapproved posts are visible in "Awaiting Review" tab to moderators.

## 🔐 Verification System

### Community Verification Methods

1. **Moderator NIP-05**
   - Community creator has verified NIP-05 (e.g., admin@example.com)
   - Shows checkmark and domain name
   - Users can trust the domain

2. **Relay Endorsement**
   - Community listed on relay health pages
   - Relay reputation vouches for community
   - Based on: uptime, features, community feedback

3. **Badge System (Optional)**
   - Community moderators can badge-verify important members
   - Using kind 30382 badge definitions
   - Shows custom badge on member profile in community context

### How to Verify Your Community

1. Set up NIP-05 verification (domain recommended)
2. Add community to relay discovery lists
3. Have active, respected moderators with their own NIP-05
4. Maintain community through consistent moderation

## 👥 Moderator Management

### Adding Moderators

1. Click "Edit Community"
2. Add moderator pubkey (npub1... or hex)
3. Publish update
4. New moderator gains approval powers

### Removing Moderators

1. Click "Edit Community"
2. Remove moderator from list
3. Publish update
4. Moderator loses approval powers immediately

## 🎯 Best Practices

1. **Clear Rules**: Put community rules in description
2. **Active Moderation**: Review pending posts regularly
3. **Multiple Moderators**: Distribute responsibility
4. **Verified Moderators**: Use NIP-05 for your key team
5. **Relay Diversity**: Use multiple relays for availability
6. **Regular Updates**: Keep description/image current
7. **Transparent Process**: Explain approval criteria

## 🔗 Community Links

- Your community: `/naddr1:pubkey:34550:slug` (NIP-19 format)
- Direct address: Community displays as naddr1... or URL
- Share with: Copy naddr1 link from community page

## 📊 Community Analytics (Future)

Planned features:
- Member growth tracking
- Engagement metrics
- Post approval rate stats
- Moderator activity log
- Community health indicators

## 🚀 Advanced Features

### Relay Configuration

```json
["relay", "wss://relay.url", "read"],   // Read-only relay
["relay", "wss://relay.url", "write"]   // Write-only relay
["relay", "wss://relay.url"]            // Read & write
```

### Automatic Post Promotion

Relays can auto-approve posts from:
- Known good sources
- Verified members
- High-reputation users

### Community Treasury (Kind 34551)

Optional shared wallet for community funding - managed by moderators.

---

**Last Updated**: August 2026  
**Standards**: NIP-72, NIP-05, NIP-25, NIP-51, NIP-65
