import { Code } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { NotBuiltYet } from '@/components/NotBuiltYet';
import { useSeo } from '@/hooks/useSeo';

/**
 * Mini apps: third-party extensions, discoverable from inside NostrFeed.
 *
 * The catalogue here was invented, down to install counts and star ratings for
 * apps that do not exist and authors who were never asked. See `NotBuiltYet`.
 */
export function MiniAppsPage() {
  useSeo({
    title: 'Mini Apps',
    description: 'Community-built extensions for NostrFeed.',
    path: '/mini-apps',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Code}
          title="Mini Apps"
          description="Extensions other people build, discoverable from here."
        />

        <NotBuiltYet
          what="Mini apps will let other developers publish something that runs inside NostrFeed, and let you install it."
          plan="NIP-89 already covers announcing an app and what it handles, so the directory can be read off the network rather than kept here — the part still missing is what a mini app is allowed to do once it is running."
        />
      </div>
    </Layout>
  );
}

export default MiniAppsPage;
