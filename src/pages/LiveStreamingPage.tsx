import { Play, Zap } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LiveStreamCard, type LiveStream } from '@/components/creator/LiveStreamCard';
import { useRouteSeo } from '@/hooks/useSeo';

/**
 * Live Streaming Page: Stream content and earn sats in real-time.
 *
 * Features:
 * - Live broadcasting with viewer count
 * - Real-time sats tips during stream
 * - Scheduled streams with reminders
 * - Stream replay and VOD support
 * - Creator earnings dashboard
 */
export function LiveStreamingPage() {
  useRouteSeo('/live');

  // Mock livestream data
  const mockStreams: LiveStream[] = [
    {
      id: '1',
      title: 'Building Bitcoin Apps with Nostr 🚀',
      creatorName: 'bitcoindev',
      creatorImage: 'https://i.pravatar.cc/150?u=bitcoindev',
      viewers: 2547,
      duration: 3661, // 1h 1m 1s in seconds
      tipsReceived: 487_500, // sats
      status: 'live',
      startTime: new Date(Date.now() - 61 * 60 * 1000), // started 1 hour ago
      description: 'Live coding session: Building a Bitcoin marketplace on Nostr',
    },
    {
      id: '2',
      title: 'Lightning Network Basics - Q&A Session',
      creatorName: 'ln-educator',
      creatorImage: 'https://i.pravatar.cc/150?u=ln-educator',
      viewers: 0,
      duration: 0,
      tipsReceived: 0,
      status: 'scheduled',
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // starts in 2 hours
      description: 'Learn how Lightning Network works and ask your questions live',
    },
    {
      id: '3',
      title: 'Nostr Protocol Deep Dive',
      creatorName: 'nostr-researcher',
      creatorImage: 'https://i.pravatar.cc/150?u=nostr-researcher',
      viewers: 0,
      duration: 5400, // 1.5 hours in seconds
      tipsReceived: 325_000,
      status: 'ended',
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // ended yesterday
      description: 'Comprehensive exploration of Nostr NIPs and event types',
    },
    {
      id: '4',
      title: 'Community AMA - Tips Fund Bounties',
      creatorName: 'community-lead',
      creatorImage: 'https://i.pravatar.cc/150?u=community-lead',
      viewers: 1823,
      duration: 1800, // 30 minutes
      tipsReceived: 125_000,
      status: 'live',
      startTime: new Date(Date.now() - 30 * 60 * 1000), // started 30 min ago
      description: 'Ask anything about our community. All tips go to bounty fund!',
    },
    {
      id: '5',
      title: 'Weekly Music Stream - Free Sats Drops',
      creatorName: 'dj-bitcoin',
      creatorImage: 'https://i.pravatar.cc/150?u=dj-bitcoin',
      viewers: 0,
      duration: 0,
      tipsReceived: 0,
      status: 'scheduled',
      startTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // in 5 days
      description: 'Chill beats while I host sats drops for chat participants',
    },
    {
      id: '6',
      title: 'Wallet Setup Tutorial',
      creatorName: 'wallet-expert',
      creatorImage: 'https://i.pravatar.cc/150?u=wallet-expert',
      viewers: 0,
      duration: 2700, // 45 minutes
      tipsReceived: 50_000,
      status: 'ended',
      startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
      description: 'Step-by-step guide to setting up your first Lightning wallet',
    },
  ];

  const liveStreams = mockStreams.filter(s => s.status === 'live');
  const scheduledStreams = mockStreams.filter(s => s.status === 'scheduled');
  const endedStreams = mockStreams.filter(s => s.status === 'ended');

  const totalViewers = liveStreams.reduce((sum, s) => sum + s.viewers, 0);
  const totalEarnings = mockStreams.reduce((sum, s) => sum + s.tipsReceived, 0);

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Play}
            title="Live Streaming"
            description="Broadcast live content and earn sats from your viewers."
          />
          <Button size="sm">
            <Play className="mr-2 h-4 w-4" />
            Go Live
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Live Now"
            value={String(liveStreams.length)}
            subtitle="active streams"
          />
          <StatCard
            label="Total Viewers"
            value={totalViewers.toLocaleString()}
            subtitle="watching now"
          />
          <StatCard
            label="All Time Earnings"
            value={`${(totalEarnings / 1_000_000).toFixed(1)}M`}
            subtitle="sats"
          />
        </div>

        {/* Live Streams */}
        {liveStreams.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">
              🔴 Now Live ({liveStreams.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {liveStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          </div>
        )}

        {/* Scheduled Streams */}
        {scheduledStreams.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">
              📅 Scheduled ({scheduledStreams.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scheduledStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          </div>
        )}

        {/* Past Streams */}
        {endedStreams.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">
              ✓ Past Streams ({endedStreams.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {endedStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          </div>
        )}

        {/* Info Card */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">How Live Streaming Works</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="font-bold text-foreground">1.</span>
                <span>
                  Click "Go Live" to start broadcasting with your webcam or screen
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">2.</span>
                <span>
                  Viewers can "Watch Now" to join your stream and see your content
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">3.</span>
                <span>
                  Audience can send tips while watching — all sats go directly to you
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">4.</span>
                <span>
                  Schedule streams ahead of time so followers can set reminders
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">5.</span>
                <span>
                  Streams automatically save as VOD (video on demand) for later viewing
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Creator Tips */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Zap className="h-5 w-5 text-warning" />
              Monetization Tips
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span>•</span>
                <span>
                  <strong>Announce tips:</strong> Let viewers know tips help you create better content
                </span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>
                  <strong>Tier rewards:</strong> Offer special recognition for top tippers (shoutouts, exclusive content)
                </span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>
                  <strong>Combo with memberships:</strong> Members get ad-free streams and exclusive content
                </span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>
                  <strong>Schedule consistently:</strong> Regular streams build loyal audiences
                </span>
              </li>
              <li className="flex gap-2">
                <span>•</span>
                <span>
                  <strong>Share on Nostr:</strong> Post stream announcements to reach more potential viewers
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </p>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveStreamingPage;
