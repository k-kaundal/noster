import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { useSeo } from '@/hooks/useSeo';
import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import { PostPage } from '@/components/PostPage';
import { AddressableView } from '@/components/AddressableView';
import NotFound from './NotFound';

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  useSeo({
    title: 'NostrFeed',
    description:
      'View a note, profile or article on the decentralized Nostr network.',
  });

  if (!identifier) {
    return <NotFound />;
  }

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  const { type, data } = decoded;

  switch (type) {
    case 'npub':
      return (
        <Layout>
          <Profile pubkey={data} />
        </Layout>
      );

    case 'nprofile':
      return (
        <Layout>
          <Profile pubkey={data.pubkey} />
        </Layout>
      );

    case 'note':
      return (
        <Layout>
          <PostPage eventId={data} />
        </Layout>
      );

    case 'nevent':
      return (
        <Layout>
          <PostPage eventId={data.id} />
        </Layout>
      );

    case 'naddr':
      return (
        <Layout>
          <AddressableView
            kind={data.kind}
            pubkey={data.pubkey}
            identifier={data.identifier}
          />
        </Layout>
      );

    default:
      return <NotFound />;
  }
}