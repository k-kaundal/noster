import { useRouteSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Trending } from '@/components/Trending';

const TrendingPage = () => {
  useRouteSeo('/trending');

  return (
    <Layout>
      <Trending />
    </Layout>
  );
};

export default TrendingPage;