import { useRouteSeo, useSiteStructuredData } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Feed } from '@/components/Feed';

const Index = () => {
  useRouteSeo('/');
  useSiteStructuredData();

  return (
    <Layout>
      <Feed />
    </Layout>
  );
};

export default Index;
