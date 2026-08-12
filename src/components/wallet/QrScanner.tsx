import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  canScanQr,
  canUseCamera,
  extractToken,
  scanCamera,
  scanImage,
  type CameraScan,
} from '@/lib/qrScan';
import { cn } from '@/lib/utils';

/**
 * Scanning a token, by camera or from a picture.
 *
 * The picture path is not the fallback — it is the likelier one. A gift card
 * arrives as an image in a chat, and reading it off the file is the whole
 * journey; pointing a camera at another screen is the rarer case.
 */
export function QrScanner({
  onToken,
  className,
}: {
  onToken: (token: string) => void;
  className?: string;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isReading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const supported = canScanQr();
  const cameraSupported = canUseCamera();

  const handleFile = async (file: File) => {
    setProblem(null);
    setReading(true);

    try {
      const scanned = await scanImage(file);
      const token = scanned ? extractToken(scanned) : null;

      if (token) {
        onToken(token);
        return;
      }

      /**
       * Two different failures, said apart. A picture with no code in it is a
       * different problem from a code that turned out not to be a token, and
       * conflating them leaves somebody re-cropping a screenshot that was
       * never going to work.
       */
      setProblem(
        scanned
          ? "That code isn't an ecash token."
          : 'No QR code found in that image.'
      );
    } finally {
      setReading(false);
    }
  };

  if (!supported) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        This browser can't scan codes. Paste the token instead.
      </p>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-2">
        {cameraSupported && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => {
              setProblem(null);
              setCameraOpen(true);
            }}
          >
            <Camera className="h-3.5 w-3.5" />
            Scan with camera
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          asChild
        >
          <label>
            {isReading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            {isReading ? 'Reading…' : 'Scan from image'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isReading}
              onChange={(changed) => {
                const file = changed.target.files?.[0];
                if (file) void handleFile(file);
                // Cleared so the same file can be picked twice
                changed.target.value = '';
              }}
            />
          </label>
        </Button>
      </div>

      {problem && <p className="text-xs text-destructive">{problem}</p>}

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onToken={(token) => {
          setCameraOpen(false);
          onToken(token);
        }}
      />
    </div>
  );
}

function CameraDialog({
  open,
  onOpenChange,
  onToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToken: (token: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanRef = useRef<CameraScan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const found = useCallback(
    (value: string) => {
      const token = extractToken(value);

      if (!token) {
        setProblem("That code isn't an ecash token. Still looking…");
        return;
      }

      onToken(token);
    },
    [onToken]
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setProblem(null);

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;

      const scan = await scanCamera(video, found, setProblem);

      /**
       * The dialog can close while `getUserMedia` is still resolving. Without
       * this the camera light stays on after the dialog is gone, which reads
       * as the app watching you.
       */
      if (cancelled) scan.stop();
      else scanRef.current = scan;
    };

    void start();

    return () => {
      cancelled = true;
      scanRef.current?.stop();
      scanRef.current = null;
    };
  }, [open, found]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Point at the code</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-full object-cover"
            />

            {/* A frame to aim with, rather than a bare rectangle of video */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
            />
          </div>

          {problem ? (
            <p className="text-xs text-destructive">{problem}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Anything scanned here is redeemed into your wallet — only scan
              codes meant for you.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full gap-1.5"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
            Stop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
