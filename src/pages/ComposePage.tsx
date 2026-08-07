import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Compose } from '@/components/Compose';

const ComposePage = () => {
  useSeo({
    title: 'Compose a note',
    description:
      'Write and publish a note to the Nostr network.',
    path: '/compose',
    noindex: true,
  });

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <Compose />
      </div>
    </Layout>
  );
};

export default ComposePage;