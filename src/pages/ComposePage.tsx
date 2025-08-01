import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Compose } from '@/components/Compose';

const ComposePage = () => {
  useSeoMeta({
    title: 'Compose - NostrFeed',
    description: 'Create a new post on the decentralized social network.',
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