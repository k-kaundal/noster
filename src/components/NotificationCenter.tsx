/**
 * Professional notification center for feed activity
 * Displays likes, replies, reposts, and other engagement
 */

import { useState } from 'react';
import {
  Bell,
  Heart,
  MessageCircle,
  Repeat2,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface Notification {
  id: string;
  type: 'like' | 'reply' | 'repost' | 'follow' | 'mention';
  actor: {
    name: string;
    pubkey: string;
    avatar?: string;
  };
  content?: string;
  postId?: string;
  timestamp: Date;
  read: boolean;
}

interface NotificationCenterProps {
  notifications?: Notification[];
  onNotificationClick?: (notification: Notification) => void;
  className?: string;
}

/**
 * Professional notification dropdown with categorized activity
 */
export function NotificationCenter({
  notifications = [],
  onNotificationClick,
  className,
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'like':
        return Heart;
      case 'reply':
        return MessageCircle;
      case 'repost':
        return Repeat2;
      case 'follow':
      case 'mention':
        return User;
    }
  };

  const getLabel = (type: Notification['type']) => {
    switch (type) {
      case 'like':
        return 'liked your post';
      case 'reply':
        return 'replied to your post';
      case 'repost':
        return 'reposted your post';
      case 'follow':
        return 'followed you';
      case 'mention':
        return 'mentioned you';
    }
  };

  const getColor = (type: Notification['type']) => {
    switch (type) {
      case 'like':
        return 'text-red-500 bg-red-50 dark:bg-red-950';
      case 'reply':
        return 'text-blue-500 bg-blue-50 dark:bg-blue-950';
      case 'repost':
        return 'text-green-500 bg-green-50 dark:bg-green-950';
      case 'follow':
      case 'mention':
        return 'text-purple-500 bg-purple-50 dark:bg-purple-950';
    }
  };

  return (
    <div className={cn('relative', className)}>
      {/* Bell Icon Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="relative h-10 w-10 p-0"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </Button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          <Card className="absolute top-full mt-2 right-0 w-96 rounded-xl shadow-lg border-0 z-50 max-h-96 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/30 sticky top-0 bg-card/95 backdrop-blur-sm">
              <h3 className="font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    // Mark all as read
                  }}
                >
                  Mark all as read
                </Button>
              )}
            </div>

            {/* Notifications List */}
            {notifications.length > 0 ? (
              <div className="divide-y">
                {notifications.map((notif) => {
                  const Icon = getIcon(notif.type);
                  return (
                    <button
                      key={notif.id}
                      onClick={() => {
                        onNotificationClick?.(notif);
                        setIsOpen(false);
                      }}
                      className={cn(
                        'w-full text-left p-4 hover:bg-background/50 transition-colors',
                        !notif.read && 'bg-primary/5'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            'h-10 w-10 rounded-full flex items-center justify-center shrink-0',
                            getColor(notif.type)
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {notif.actor.name}
                            <span className="text-muted-foreground font-normal">
                              {' '}
                              {getLabel(notif.type)}
                            </span>
                          </div>

                          {notif.content && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              "{notif.content}"
                            </p>
                          )}

                          <span className="text-xs text-muted-foreground mt-1 block">
                            {formatTime(notif.timestamp)}
                          </span>
                        </div>

                        {!notif.read && (
                          <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No notifications yet</p>
              </div>
            )}
          </Card>

          {/* Overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
