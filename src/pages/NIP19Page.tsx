import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import NotFound from './NotFound';

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  useSeoMeta({
    title: 'NostrFeed',
    description: 'View content on the decentralized social network.',
  });

  if (!identifier) {
    return <NotFound />;
  }

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  const { type, data } = decoded;

  switch (type) {
    case 'npub':
      return (
        <Layout>
          <Profile pubkey={data} />
        </Layout>
      );

    case 'nprofile':
      return (
        <Layout>
          <Profile pubkey={data.pubkey} />
        </Layout>
      );

    case 'note':
      // AI agent should implement note view here
      return (
        <Layout>
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2">Note View</h2>
            <p className="text-muted-foreground">Note view coming soon...</p>
          </div>
        </Layout>
      );

    case 'nevent':
      // AI agent should implement event view here
      return (
        <Layout>
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2">Event View</h2>
            <p className="text-muted-foreground">Event view coming soon...</p>
          </div>
        </Layout>
      );

    case 'naddr':
      // AI agent should implement addressable event view here
      return (
        <Layout>
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold mb-2">Addressable Event View</h2>
            <p className="text-muted-foreground">Addressable event view coming soon...</p>
          </div>
        </Layout>
      );

    default:
      return <NotFound />;
  }
}