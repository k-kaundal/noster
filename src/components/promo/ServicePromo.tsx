import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ServiceArt } from '@/components/promo/ServiceArt';
import { SERVICES, type Service } from '@/lib/services';
import { cn } from '@/lib/utils';

/**
 * Which service to show beside a given page.
 *
 * Not random. Someone on the wallet page is already interested in money, so
 * they get the one they are not currently using rather than an advert for the
 * page they are on. Everyone else gets one chosen from the day, so the rail
 * is not a different thing every time a route changes — an advert that
 * reshuffles under a reader is noise, not variety.
 */
function pickService(pathname: string): Service {
  if (pathname.startsWith('/wallet')) {
    return SERVICES.find((entry) => entry.id === 'mint') ?? SERVICES[0];
  }

  if (pathname.startsWith('/ecash')) {
    return SERVICES.find((entry) => entry.id === 'lightning') ?? SERVICES[0];
  }

  const day = Math.floor(Date.now() / 86_400_000);
  const id = ROTATION[day % ROTATION.length];

  return SERVICES.find((entry) => entry.id === id) ?? SERVICES[0];
}

/**
 * The rotation, weighted rather than round-robin.
 *
 * A name comes up twice as often as anything else, and deliberately: the
 * wallet and the mint are infrastructure somebody reaches for when they
 * already know they want it, while a name is the thing a reader does not know
 * is available until it is put in front of them. Written out as a list so the
 * weighting is visible and editable, instead of hidden in arithmetic.
 */
const ROTATION: Service['id'][] = [
  'names',
  'lightning',
  'names',
  'mint',
  'wallet',
];

/**
 * The rail's promotional slot.
 *
 * Built as a card that says what the thing is, not as a banner. A sidebar
 * advert that looks like an advert gets ignored by everyone who has ever used
 * the web; one that reads as a recommendation gets read.
 */
export function ServicePromo({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const service = useMemo(() => pickService(pathname), [pathname]);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <a
        href={service.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition-opacity hover:opacity-95"
      >
        <div className="aspect-[16/9] w-full">
          <ServiceArt service={service.id} />
        </div>

        <div className="space-y-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug">{service.name}</p>
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {service.tagline}
          </p>
        </div>
      </a>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {service.host}
        </span>

        <Link
          to="/services"
          className="text-[11px] font-medium text-primary hover:underline"
        >
          All three
        </Link>
      </div>
    </Card>
  );
}
