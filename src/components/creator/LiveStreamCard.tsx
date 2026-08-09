import { Play, Zap, Users, Clock, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface LiveStream {
  id: string;
  title: string;
  creatorName: string;
  creatorImage?: string;
  viewers: number;
  duration: number; // seconds
  tipsReceived: number; // sats
  status: 'live' | 'scheduled' | 'ended';
  startTime: Date;
  description?: string;
}

export function LiveStreamCard({ stream }: { stream: LiveStream }) {
  const statusConfig = {
    live: {
      label: 'LIVE',
      color: 'bg-destructive/20 text-destructive animate-pulse',
      icon: '🔴',
    },
    scheduled: {
      label: 'Scheduled',
      color: 'bg-primary/20 text-primary',
      icon: '📅',
    },
    ended: {
      label: 'Ended',
      color: 'bg-muted text-muted-foreground',
      icon: '✓',
    },
  };

  const config = statusConfig[stream.status];
  const durationMinutes = Math.floor(stream.duration / 60);

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      {/* Thumbnail / Video Container */}
      <div className="relative bg-gradient-to-br from-muted to-muted/50 aspect-video flex items-center justify-center group">
        <Play className="h-16 w-16 text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors" />

        {/* Status Badge */}
        <Badge
          variant="outline"
          className={cn(config.color, 'absolute top-3 left-3')}
        >
          {config.icon} {config.label}
        </Badge>

        {/* Viewer Count Overlay */}
        {stream.status === 'live' && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-destructive/90 text-white px-2 py-1 rounded text-sm font-semibold">
            <Users className="h-4 w-4" />
            {stream.viewers.toLocaleString()} watching
          </div>
        )}

        {/* Duration for ended streams */}
        {stream.status === 'ended' && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-black/50 text-white px-2 py-1 rounded text-xs font-semibold">
            <Clock className="h-3 w-3" />
            {durationMinutes}m
          </div>
        )}
      </div>

      <CardContent className="p-4">
        {/* Title & Creator */}
        <div className="mb-3">
          <h3 className="font-semibold text-base line-clamp-2 mb-1">{stream.title}</h3>
          <p className="text-xs text-muted-foreground">@{stream.creatorName}</p>
        </div>

        {/* Description */}
        {stream.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {stream.description}
          </p>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b">
          {stream.status === 'live' && (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Watching</p>
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="font-bold">{(stream.viewers / 1000).toFixed(1)}K</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Tips</p>
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-warning" />
                  <span className="font-bold">{(stream.tipsReceived / 1000).toFixed(0)}K</span>
                </div>
              </div>
            </>
          )}

          {stream.status === 'ended' && (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Duration</p>
                <span className="font-bold">{durationMinutes}m</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Tips Received</p>
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-warning" />
                  <span className="font-bold">{(stream.tipsReceived / 1000).toFixed(0)}K</span>
                </div>
              </div>
            </>
          )}

          {stream.status === 'scheduled' && (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Starts</p>
                <span className="font-bold text-sm">
                  {new Date(stream.startTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Date</p>
                <span className="font-bold text-sm">
                  {new Date(stream.startTime).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Action Button */}
        <Button className="w-full" size="sm">
          {stream.status === 'live' && (
            <>
              <Play className="mr-2 h-4 w-4" />
              Watch Now
            </>
          )}
          {stream.status === 'scheduled' && (
            <>
              <Clock className="mr-2 h-4 w-4" />
              Set Reminder
            </>
          )}
          {stream.status === 'ended' && (
            <>
              <ArrowUpRight className="mr-2 h-4 w-4" />
              View Replay
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
