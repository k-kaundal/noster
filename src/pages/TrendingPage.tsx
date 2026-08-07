import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Trending } from '@/components/Trending';

const TrendingPage = () => {
  useSeo({
    title: 'Trending on Nostr',
    description:
      'The hashtags, notes and people getting the most attention on your relays over the last 24 hours.',
    path: '/trending',
  });

  return (
    <Layout>
      <Trending />
    </Layout>
  );
};

export default TrendingPage;