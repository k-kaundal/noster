import { useParams } from 'react-router-dom';
import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import NotFound from '@/pages/NotFound';
import { nip19 } from 'nostr-tools';

const ProfilePage = () => {
  const { npub } = useParams<{ npub: string }>();

  useSeo({
    title: 'Profile',
    description:
      'View a profile on the decentralized Nostr network.',
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