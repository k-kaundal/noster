import { Link } from 'react-router-dom';
import { ArrowUpRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ServiceArt } from '@/components/promo/ServiceArt';
import type { Service } from '@/lib/services';
import { cn } from '@/lib/utils';

/**
 * One service, sold properly.
 *
 * Artwork, a promise, what it actually does, and one button. The order is
 * deliberate: nobody reads the third paragraph of an advert, so the claim
 * worth making goes in the line under the picture.
 */
export function ServiceCard({
  service,
  className,
}: {
  service: Service;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden hover-lift', className)}>
      <div className="aspect-[16/9] w-full">
        <ServiceArt service={service.id} />
      </div>

      <CardContent className="space-y-4 pt-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold leading-snug">{service.name}</h3>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {service.host}
            </span>
          </div>

          <p className="text-sm font-medium">{service.tagline}</p>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {service.body}
        </p>

        <ul className="space-y-1.5">
          {service.points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span className="text-muted-foreground">{point}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild>
            <a href={service.url} target="_blank" rel="noopener noreferrer">
              {service.cta}
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </a>
          </Button>

          {/* The version already in this app, when there is one. Sending
              someone to another site for something they can do here is an
              advert working against the product it is inside */}
          {service.internalPath && (
            <Button variant="ghost" asChild>
              <Link to={service.internalPath}>{service.internalLabel}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
