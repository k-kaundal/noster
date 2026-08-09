import { useState } from 'react';
import { Plus, Trash2, Lock, Radio, Link2, LogOut, MoreVertical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';

/**
 * Identity Vault: Central hub for Nostr identity management.
 *
 * Displays:
 * - npub + NIP-05 address
 * - Signing devices (bunker, extension, hardware, etc.)
 * - Connected relays
 * - Authorized apps + permissions
 * - Session history
 */
export function IdentityVault() {
  const { user } = useCurrentUser();
  const [activeTab, setActiveTab] = useState('devices');

  if (!user) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Sign in to access Identity Vault</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Identity Header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/8 to-transparent px-6 py-8">
          <h2 className="text-2xl font-bold mb-4">Your Nostr Identity</h2>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Public Key (npub)
              </p>
              <code className="block break-all text-sm font-mono bg-muted/50 rounded px-3 py-2">
                {user.pubkey}
              </code>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Lightning Address
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all text-sm font-mono bg-muted/50 rounded px-3 py-2">
                  user@nostrfeed.com
                </code>
                <span className="text-xs font-semibold text-success">✓ Active</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Vault Tabs */}
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
            <TabsTrigger value="devices" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <Lock className="mr-2 h-4 w-4" />
              Signing Devices
            </TabsTrigger>
            <TabsTrigger value="relays" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <Radio className="mr-2 h-4 w-4" />
              Relays
            </TabsTrigger>
            <TabsTrigger value="apps" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <Link2 className="mr-2 h-4 w-4" />
              Connected Apps
            </TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-none border-b-2 border-transparent px-4 py-3">
              <LogOut className="mr-2 h-4 w-4" />
              Sessions
            </TabsTrigger>
          </TabsList>

          {/* Signing Devices Tab */}
          <TabsContent value="devices" className="space-y-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Devices authorized to sign with your Nostr key
              </p>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add Device
              </Button>
            </div>

            <div className="space-y-3">
              <SigningDeviceItem
                name="MacBook Pro"
                type="bunker"
                status="active"
                lastUsed="10 minutes ago"
              />
              <SigningDeviceItem
                name="iPhone 15 Pro"
                type="bunker"
                status="active"
                lastUsed="2 hours ago"
              />
              <SigningDeviceItem
                name="Nostr Extension"
                type="extension"
                status="active"
                lastUsed="Just now"
              />
              <SigningDeviceItem
                name="Ledger Nano X"
                type="hardware"
                status="offline"
                lastUsed="5 days ago"
              />
            </div>
          </TabsContent>

          {/* Relays Tab */}
          <TabsContent value="relays" className="space-y-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Relays you publish to and subscribe from
              </p>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add Relay
              </Button>
            </div>

            <div className="space-y-3">
              <RelayItem
                url="relay.nostr.band"
                latency={82}
                read={true}
                write={true}
                status="online"
              />
              <RelayItem
                url="relay.damus.io"
                latency={124}
                read={true}
                write={true}
                status="online"
              />
              <RelayItem
                url="relay.primal.net"
                latency={145}
                read={true}
                write={false}
                status="online"
              />
              <RelayItem
                url="old-relay.example.com"
                latency={null}
                read={false}
                write={false}
                status="offline"
              />
            </div>

            <Button variant="outline" className="w-full mt-4">
              🔧 Optimize Relays (Auto-select fastest healthy)
            </Button>
          </TabsContent>

          {/* Connected Apps Tab */}
          <TabsContent value="apps" className="space-y-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                Apps that can access your Nostr identity
              </p>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Connect App
              </Button>
            </div>

            <div className="space-y-3">
              <ConnectedAppItem
                name="NostrFeed"
                url="nostrfeed.com"
                permissions={['Read events', 'Read DMs', 'Publish events']}
                expiresAt={null}
              />
              <ConnectedAppItem
                name="NDK App"
                url="ndk-app.example.com"
                permissions={['Read events']}
                expiresAt="Oct 7, 2026"
              />
              <ConnectedAppItem
                name="My Website"
                url="mywebsite.com"
                permissions={['Read profile', 'Read events', 'Publish events']}
                expiresAt="Aug 16, 2026"
              />
            </div>
          </TabsContent>

          {/* Sessions Tab */}
          <TabsContent value="sessions" className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground mb-4">
              Recent activity on your account
            </p>

            <div className="space-y-2">
              <SessionItem
                timestamp="Aug 9, 2026 • 10:42 AM"
                device="MacBook Pro"
                action="Sign in"
                icon="🔓"
              />
              <SessionItem
                timestamp="Aug 9, 2026 • 08:15 AM"
                device="iPhone 15 Pro"
                action="Approve app"
                icon="✓"
              />
              <SessionItem
                timestamp="Aug 8, 2026 • 11:30 PM"
                device="Nostr Extension"
                action="Publish post"
                icon="📝"
              />
              <SessionItem
                timestamp="Aug 8, 2026 • 09:22 AM"
                device="MacBook Pro"
                action="Send zap"
                icon="⚡"
              />
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function SigningDeviceItem({
  name,
  type,
  status,
  lastUsed,
}: {
  name: string;
  type: 'bunker' | 'extension' | 'hardware' | 'local';
  status: 'active' | 'offline';
  lastUsed: string;
}) {
  const typeLabel = {
    bunker: '📱 Remote Signer',
    extension: '🧩 Extension',
    hardware: '🔐 Hardware Wallet',
    local: '💻 Local',
  }[type];

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium">{name}</p>
          <span className="text-xs font-semibold px-2 py-1 rounded bg-muted text-foreground">
            {typeLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {status === 'active' ? `🟢 Active • ${lastUsed}` : `🔴 Offline • ${lastUsed}`}
        </p>
      </div>
      <Button variant="ghost" size="sm" className="text-destructive">
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Remove device</span>
      </Button>
    </div>
  );
}

function RelayItem({
  url,
  latency,
  read,
  write,
  status,
}: {
  url: string;
  latency: number | null;
  read: boolean;
  write: boolean;
  status: 'online' | 'offline';
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium font-mono text-sm">{url}</p>
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded',
            status === 'online'
              ? 'bg-success/20 text-success'
              : 'bg-destructive/20 text-destructive'
          )}>
            {status === 'online' ? '🟢' : '🔴'} {status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {latency && <span>Latency: {latency}ms</span>}
          {read && <span>✓ Read</span>}
          {write && <span>✓ Write</span>}
        </div>
      </div>
      <Button variant="ghost" size="sm">
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Remove relay</span>
      </Button>
    </div>
  );
}

function ConnectedAppItem({
  name,
  url,
  permissions,
  expiresAt,
}: {
  name: string;
  url: string;
  permissions: string[];
  expiresAt: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{url}</p>
        </div>
        <Button variant="ghost" size="sm">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Permissions:</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          {permissions.map((perm) => (
            <li key={perm}>✓ {perm}</li>
          ))}
        </ul>
      </div>

      {expiresAt && (
        <p className="text-xs text-muted-foreground">
          Expires: {expiresAt}
        </p>
      )}
    </div>
  );
}

function SessionItem({
  timestamp,
  device,
  action,
  icon,
}: {
  timestamp: string;
  device: string;
  action: string;
  icon: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <span className="text-lg mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{action}</p>
          <p className="text-xs text-muted-foreground">{device}</p>
        </div>
        <p className="text-xs text-muted-foreground">{timestamp}</p>
      </div>
    </div>
  );
}
