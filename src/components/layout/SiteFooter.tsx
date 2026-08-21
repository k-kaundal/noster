import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** The author's other projects, promoted across the site. */
export const AUTHOR = {
  handle: '@kkworld',
  url: 'https://x.com/kkworld',
} as const;

/**
 * Where to find people rather than documentation.
 *
 * Kept here with the other outward links so there is one copy of the invite.
 * A Discord invite is a URL that can be revoked or regenerated, and the same
 * string pasted into four components is four places to miss when it changes.
 */
export const COMMUNITY = {
  name: 'Discord',
  url: 'https://discord.gg/QTbxqKEfef',
} as const;

export const PROJECTS = [
  { name: 'SecureEnv', url: 'https://secureenv.in' },
  { name: 'ForgeLearn', url: 'https://forgelearn.dev' },
] as const;

/** Compact link row shown at the foot of the discovery rail. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <nav
      className={cn(
        'flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground',
        className
      )}
    >
      <Link to="/explore" className="hover:text-foreground hover:underline">
        Explore
      </Link>
      <Link to="/trending" className="hover:text-foreground hover:underline">
        Trending
      </Link>
      <Link to="/docs" className="hover:text-foreground hover:underline">
        Help
      </Link>
      <Link to="/services" className="hover:text-foreground hover:underline">
        Wallet &amp; mint
      </Link>

      <a
        href={COMMUNITY.url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground hover:underline"
      >
        {COMMUNITY.name}
      </a>

      <a
        href={AUTHOR.url}
        target="_blank"
        rel="noopener noreferrer me"
        className="hover:text-foreground hover:underline"
      >
        Built by {AUTHOR.handle}
      </a>

      {PROJECTS.map((project) => (
        <a
          key={project.url}
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground hover:underline"
        >
          {project.name}
        </a>
      ))}

      <span>© {new Date().getFullYear()} nostrfeed.com</span>
    </nav>
  );
}
