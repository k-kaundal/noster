import { Star, Download, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface MiniApp {
  id: string;
  name: string;
  description: string;
  developer: string;
  developerImage?: string;
  rating: number; // 0-5
  reviews: number;
  installs: number;
  category: string;
  permissions: string[];
  url: string;
}

export function MiniAppCard({ app }: { app: MiniApp }) {
  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors flex flex-col">
      <CardContent className="p-5 flex-1 flex flex-col">
        {/* Header */}
        <div className="mb-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg leading-tight">{app.name}</h3>
              <p className="text-xs text-muted-foreground">by {app.developer}</p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {app.category}
            </Badge>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {app.description}
        </p>

        {/* Rating & Reviews */}
        <div className="flex items-center gap-2 mb-3 pb-3 border-b">
          <div className="flex items-center gap-1">
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3 w-3 ${
                    i < Math.floor(app.rating)
                      ? 'fill-warning text-warning'
                      : 'text-muted'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-semibold">{app.rating.toFixed(1)}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            ({app.reviews} reviews)
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Installs
            </p>
            <p className="font-bold">
              {app.installs >= 1000000
                ? `${(app.installs / 1000000).toFixed(1)}M`
                : app.installs >= 1000
                ? `${(app.installs / 1000).toFixed(0)}K`
                : app.installs}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              Permissions
            </p>
            <p className="font-bold text-sm">{app.permissions.length}</p>
          </div>
        </div>

        {/* Permissions */}
        <div className="mb-4 p-2 bg-muted/30 rounded text-xs space-y-1">
          <p className="font-semibold text-muted-foreground mb-2">Requires:</p>
          {app.permissions.map((permission, idx) => (
            <div key={idx} className="text-muted-foreground">
              • {permission}
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-auto">
          <Button className="flex-1" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Install
          </Button>
          <Button variant="outline" size="sm" className="px-3">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
