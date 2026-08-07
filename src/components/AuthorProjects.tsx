import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AUTHOR, PROJECTS } from '@/components/layout/SiteFooter';
import { cn } from '@/lib/utils';

/**
 * The author's other work. Kept to names and links rather than descriptions,
 * so nothing here can drift out of date with the sites themselves.
 */
export function AuthorProjects({ className }: { className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Also by {AUTHOR.handle}</CardTitle>
      </CardHeader>

      <CardContent className="p-0 pb-2">
        <ul>
          {PROJECTS.map((project) => (
            <li key={project.url}>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-accent/60"
              >
                {/* Initials rather than a favicon service, which would leak a
                    request to a third party on every page render */}
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-[11px] font-semibold text-primary-foreground"
                >
                  {project.name.slice(0, 2).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new URL(project.url).hostname}
                  </p>
                </div>

                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
