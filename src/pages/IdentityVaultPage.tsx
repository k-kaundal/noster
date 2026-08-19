import { KeyRound } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { IdentityVault } from '@/components/identity/IdentityVault';
import { useSeo } from '@/hooks/useSeo';

/**
 * Your key, the names pointing at it, and what can sign with it here.
 *
 * The description used to promise signing devices, connected apps and session
 * history, and the page delivered all three by inventing them. Two of those
 * are things no Nostr client can know — a key leaves no record of where it has
 * been used, and NIP-46 grants live in the signer rather than the client — so
 * the heading now claims only what `IdentityVault` can actually show.
 */
export function IdentityVaultPage() {
  useSeo({
    title: 'Identity Vault',
    description: 'Your Nostr key, the names that point at it, and what can sign with it in this browser.',
    path: '/identity',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={KeyRound}
          title="Identity Vault"
          description="Your key, the names that point at it, and what can sign with it in this browser."
        />

        <IdentityVault />
      </div>
    </Layout>
  );
}

export default IdentityVaultPage;
