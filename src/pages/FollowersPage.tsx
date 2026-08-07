import { useParams } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { FollowList } from '@/components/FollowList';
import NotFound from './NotFound';

export function FollowersPage() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  useSeo({
    title: 'Followers',
    description:
      'People who follow this account on the Nostr network.',
    noindex: true,
  });

  if (!identifier) {
    return <NotFound />;
  }

  let pubkey: string;
  try {
    const decoded = nip19.decode(identifier);
    if (decoded.type === 'npub') {
      pubkey = decoded.data;
    } else if (decoded.type === 'nprofile') {
      pubkey = decoded.data.pubkey;
    } else {
      return <NotFound />;
    }
  } catch (error) {
    console.error('Failed to decode NIP-19 identifier:', error);
    return <NotFound />;
  }

  return (
    <Layout>
      <FollowList pubkey={pubkey} defaultTab="followers" />
    </Layout>
  );
}