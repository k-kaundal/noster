import { nip19 } from 'nostr-tools';
import { Navigate, useParams } from 'react-router-dom';
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

  /**
   * A bare 64-character hex key, redirected to its `npub`.
   *
   * `nip19.decode` throws on these, so they used to 404 — and they are not
   * hypothetical: this app published them itself from the trending list, and
   * other clients link profiles this way too. Fixing the links that generate
   * them does nothing for the ones already shared or bookmarked.
   *
   * Read as a public key rather than an event id. Both are 32 bytes of hex and
   * nothing in the URL distinguishes them, but events are shared as `note1`
   * and `nevent1` in practice while raw keys turn up constantly. Redirecting
   * rather than rendering in place also canonicalises the address, so what
   * gets copied from the bar afterwards is the identifier everything else
   * understands.
   */
  if (/^[0-9a-f]{64}$/i.test(identifier)) {
    try {
      return <Navigate to={`/${nip19.npubEncode(identifier.toLowerCase())}`} replace />;
    } catch {
      return <NotFound />;
    }
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