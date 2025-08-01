import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import NotFound from '@/pages/NotFound';
import { nip19 } from 'nostr-tools';

const ProfilePage = () => {
  const { npub } = useParams<{ npub: string }>();

  useSeoMeta({
    title: 'Profile - NostrFeed',
    description: 'View user profile on the decentralized social network.',
  });

  // Decode npub to get pubkey
  let pubkey: string;
  try {
    if (!npub) throw new Error('No npub provided');
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') throw new Error('Invalid npub');
    pubkey = decoded.data;
  } catch {
    return <NotFound />;
  }

  return (
    <Layout>
      <Profile pubkey={pubkey} />
    </Layout>
  );
};

export default ProfilePage;