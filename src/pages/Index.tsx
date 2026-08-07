import { useSeo, useSiteStructuredData } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Feed } from '@/components/Feed';

const Index = () => {
  useSeo({
    title: 'NostrFeed — Decentralized Social Network on Nostr',
    description:
      'A fast, open Nostr client. Read and publish notes, watch short videos, zap creators over Lightning, and control exactly which relays you use.',
    path: '/',
  });
  useSiteStructuredData();

  return (
    <Layout>
      <Feed />
    </Layout>
  );
};

export default Index;
