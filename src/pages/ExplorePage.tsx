import { useRouteSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Explore } from '@/components/Explore';

const ExplorePage = () => {
  useRouteSeo('/explore');

  return (
    <Layout>
      <Explore />
    </Layout>
  );
};

export default ExplorePage;