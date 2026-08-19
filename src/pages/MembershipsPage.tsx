import { Users } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { NotBuiltYet } from '@/components/NotBuiltYet';
import { useSeo } from '@/hooks/useSeo';

/**
 * Memberships: recurring support, with tiers and a subscriber list.
 *
 * The tiers listed here were invented, along with their subscriber counts and
 * the monthly revenue figure computed from them — a creator reading this page
 * was shown earnings nobody had paid. See `NotBuiltYet`.
 *
 * Note that paid subscriptions *do* work in this app: see `lib/subscription`
 * and the wallet. What is missing is the public tier catalogue this page
 * describes, not the payments behind it.
 */
export function MembershipsPage() {
  useSeo({
    title: 'Memberships',
    description: 'Recurring memberships: sustainable creator revenue.',
    path: '/memberships',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Users}
          title="Memberships"
          description="Recurring support from the people who read you."
        />

        <NotBuiltYet
          what="Memberships will let you publish tiers people can subscribe to, and see who is subscribed to which."
          plan="Recurring payments already work in the wallet; what is missing is a published tier that a stranger's client can read and renew against without trusting this app to remember it."
        />
      </div>
    </Layout>
  );
}

export default MembershipsPage;
