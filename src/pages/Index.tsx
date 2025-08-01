import { useSeoMeta } from '@unhead/react';
import { Layout } from '@/components/Layout';
import { Feed } from '@/components/Feed';

const Index = () => {
  useSeoMeta({
    title: 'NostrFeed - Decentralized Social Network',
    description: 'A modern Nostr client for decentralized social networking. Connect, share, and discover content on the open protocol.',
  });

  return (
    <Layout>
      <Feed />
    </Layout>
  );
};

export default Index;
