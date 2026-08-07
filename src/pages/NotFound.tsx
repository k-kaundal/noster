import { useSeo } from '@/hooks/useSeo';
import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Compass, Home, Search } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  const location = useLocation();

  useSeo({
    title: 'Page not found',
    description:
      'The page you are looking for could not be found. Return to the home page to keep browsing Nostr.',
    noindex: true,
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <Search className="h-7 w-7 text-muted-foreground" />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            404
          </p>
          <h1 className="text-2xl font-bold">This page doesn't exist</h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            The link may be broken, or the note or profile you're looking for
            isn't on this relay.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              Back home
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/explore">
              <Compass className="mr-2 h-4 w-4" />
              Explore
            </Link>
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default NotFound;
