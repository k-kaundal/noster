import { KeyRound } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { IdentityVault } from '@/components/identity/IdentityVault';
import { useSeo } from '@/hooks/useSeo';

/**
 * Identity Vault Page: Nostr identity OS hub.
 *
 * Central location for users to manage their complete Nostr identity:
 * - Signing devices
 * - Relays
 * - Connected apps & permissions
 * - Session history
 */
export function IdentityVaultPage() {
  useSeo({
    title: 'Identity Vault',
    description: 'Manage your Nostr identity, signing devices, relays, and connected applications.',
    path: '/identity',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={KeyRound}
          title="Identity Vault"
          description="Your Nostr identity in one place. Manage signing devices, relays, connected apps, and session security."
        />

        <IdentityVault />
      </div>
    </Layout>
  );
}

export default IdentityVaultPage;
