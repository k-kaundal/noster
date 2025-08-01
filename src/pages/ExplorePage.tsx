import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Explore } from '@/components/Explore';

const ExplorePage = () => {
  useSeoMeta({
    title: 'Explore - NostrFeed',
    description: 'Explore diverse content, discover new people, and find interesting posts on the Nostr network.',
  });

  return (
    <Layout>
      <Explore />
    </Layout>
  );
};

export default ExplorePage;