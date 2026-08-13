import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  applyUpdate,
  checkForUpdate,
  currentVersion,
  subscribeToUpdates,
} from '@/lib/serviceWorker';

/**
 * Which build is running, and a way to insist on a newer one.
 *
 * Updates arrive on their own — checked every half hour and whenever the app
 * is reopened, and applied silently on return from the background. This is for
 * the case that policy cannot cover: somebody has been told a fix is out, is
 * looking at the app right now, and wants it without waiting for a schedule or
 * for a reason to leave.
 *
 * The version is worth showing for its own sake. "Which version are you on" is
 * the first question of every bug report, and without this the honest answer
 * is that nobody can tell.
 */
export function AppVersionCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => subscribeToUpdates(setUpdateReady), []);

  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    checkForUpdate();

    /*
     * Held briefly on purpose. The check is a conditional request that usually
     * answers in milliseconds, and a spinner that appears and vanishes within
     * one frame reads as a button that did nothing.
     */
    await new Promise((resolve) => setTimeout(resolve, 1200));

    setChecking(false);
    setCheckedAt(Date.now());
  }, []);

  /*
   * Nothing to say without a worker. That is every development build and any
   * browser with service workers switched off, where there are no versions to
   * compare and no update to take.
   */
  if (!version) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Version</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-sm">{version}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {updateReady
                ? 'A newer version is ready to install.'
                : 'Updates install themselves when you reopen the app.'}
            </p>
          </div>

          {updateReady ? (
            <Button size="sm" onClick={applyUpdate} className="shrink-0">
              Update now
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void check()}
              disabled={checking}
              className="shrink-0"
            >
              {checking ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Check
            </Button>
          )}
        </div>

        {/*
          Said explicitly, because "nothing happened" is the same picture as
          "the button is broken" — and here nothing happening is the good
          outcome.
        */}
        {checkedAt !== null && !checking && !updateReady && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success-strong" />
            You're on the latest version.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
