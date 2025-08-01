import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Trending } from '@/components/Trending';

const TrendingPage = () => {
  useSeoMeta({
    title: 'Trending - NostrFeed',
    description: 'Discover trending hashtags, popular posts, and most mentioned users on the Nostr network.',
  });

  return (
    <Layout>
      <Trending />
    </Layout>
  );
};

export default TrendingPage;