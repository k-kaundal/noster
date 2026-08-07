import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Explore } from '@/components/Explore';

const ExplorePage = () => {
  useSeo({
    title: 'Explore Nostr',
    description:
      'Discover notes, media and people from across the Nostr network, updated as your relays deliver them.',
    path: '/explore',
  });

  return (
    <Layout>
      <Explore />
    </Layout>
  );
};

export default ExplorePage;