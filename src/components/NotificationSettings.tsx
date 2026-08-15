import { useState } from 'react';
import { Bell, BellOff, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { NOTIFY_PREF_KEY } from '@/hooks/useSystemNotifications';
import {
  badgingSupported,
  permissionState,
  requestPermission,
  type PermissionState,
} from '@/lib/systemNotify';

/**
 * Turning system notifications on, and being honest about their limits.
 *
 * The paragraph about the app needing to be running is not a disclaimer bolted
 * on — it is the difference between this feature working as expected and
 * looking broken. Somebody who turns this on, closes the tab and gets nothing
 * overnight will conclude the app is faulty rather than that they asked for
 * something it cannot do.
 */
export function NotificationSettings() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useLocalStorage(NOTIFY_PREF_KEY, false);
  const [permission, setPermission] = useState<PermissionState>(permissionState);

  const supported = permission !== 'unsupported';

  const toggle = async (next: boolean) => {
    if (!next) {
      setEnabled(false);
      return;
    }

    /**
     * Permission is requested here, inside the click. Browsers reject a
     * request without a user gesture, and some hold it against the origin
     * afterwards.
     */
    const result = await requestPermission();
    setPermission(result);

    if (result === 'granted') {
      setEnabled(true);
      return;
    }

    setEnabled(false);

    toast({
      title:
        result === 'denied'
          ? 'Notifications are blocked'
          : 'Permission not given',
      description:
        result === 'denied'
          ? 'Your browser is blocking them for this site. The site settings in your address bar can undo that — this app cannot ask again.'
          : 'Nothing was changed.',
      variant: 'destructive',
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {enabled && permission === 'granted' ? (
            <Bell className="h-4 w-4" />
          ) : (
            <BellOff className="h-4 w-4" />
          )}
          Notifications
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            This browser has no notification support. The list in the app still
            works.
          </p>
        ) : (
          <>
            <Label className="flex cursor-pointer items-start justify-between gap-4 font-normal">
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  Alert me about zaps, payments, follows, replies and mentions
                </span>
                <span className="block text-sm text-muted-foreground">
                  Shown only when you are looking at something else — never for
                  something already on your screen.
                </span>
              </span>

              <Switch
                checked={enabled && permission === 'granted'}
                onCheckedChange={toggle}
                disabled={permission === 'denied'}
              />
            </Label>

            {permission === 'denied' && (
              <p className="text-sm text-destructive">
                Your browser is blocking notifications for this site. Only the
                site settings in your address bar can undo that.
              </p>
            )}

            {/*
              The limit, stated up front rather than discovered. Delivering
              anything while the app is closed needs a server holding a push
              subscription, and there isn't one.
            */}
            <div className="flex gap-2.5 rounded-lg border border-dashed p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  These arrive while NostrFeed is running — a background tab, or
                  the installed app left open. Closing it entirely stops them.
                </p>
                <p>
                  Waking a closed app needs a server watching the relays for
                  you, which this one deliberately does not have: it talks to
                  relays from your browser and nowhere else.
                </p>
              </div>
            </div>

            {badgingSupported() && (
              <p className="text-sm text-muted-foreground">
                The unread count also shows on the app icon once installed, with
                no permission needed.
              </p>
            )}

            {permission === 'granted' && enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast({
                    title: 'Switch to another tab',
                    description:
                      'Notifications are suppressed while this one is in front — that is the intended behaviour.',
                  })
                }
              >
                Why am I not seeing any?
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
