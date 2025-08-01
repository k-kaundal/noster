import { useParams } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { FollowList } from '@/components/FollowList';
import NotFound from './NotFound';

export function FollowersPage() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  useSeoMeta({
    title: 'Followers - NostrFeed',
    description: 'View who follows this user on the decentralized social network.',
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
  } catch {
    return <NotFound />;
  }

  return (
    <Layout>
      <FollowList pubkey={pubkey} defaultTab="followers" />
    </Layout>
  );
}