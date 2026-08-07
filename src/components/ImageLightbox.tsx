import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { LightboxContext } from '@/hooks/useLightbox';
import { cn } from '@/lib/utils';

interface LightboxState {
  /** Every image in the group, so arrows can move between them. */
  images: string[];
  index: number;
}

/**
 * Hosts a single lightbox for the whole app.
 *
 * One instance rather than one per note: only one can be open at a time, and
 * a note with four images should not mount four dialogs to prove it.
 */
export function ImageLightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);

  const open = useCallback((images: string[], index: number) => {
    if (!images.length) return;
    setState({ images, index: Math.max(0, Math.min(index, images.length - 1)) });
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <LightboxContext.Provider value={value}>
      {children}
      {state && (
        <Lightbox
          images={state.images}
          index={state.index}
          onIndexChange={(index) => setState({ ...state, index })}
          onClose={() => setState(null)}
        />
      )}
    </LightboxContext.Provider>
  );
}

interface LightboxProps {
  images: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function Lightbox({ images, index, onIndexChange, onClose }: LightboxProps) {
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const src = images[index];
  const hasMultiple = images.length > 1;

  const go = useCallback(
    (delta: number) => {
      setZoomed(false);
      onIndexChange((index + delta + images.length) % images.length);
    },
    [index, images.length, onIndexChange]
  );

  // Moving between images resets the zoom, so the next one starts fitted
  useEffect(() => setZoomed(false), [src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          if (hasMultiple) go(-1);
          break;
        case 'ArrowRight':
          if (hasMultiple) go(1);
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [go, hasMultiple, onClose]);

  // The page behind must not scroll while the overlay is up
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const filename = (() => {
    try {
      return decodeURIComponent(new URL(src).pathname.split('/').pop() || 'image');
    } catch {
      return 'image';
    }
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} of ${images.length}`}
      className="fixed inset-0 z-[100] flex animate-fade-in flex-col bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        if (!start || zoomed) return;

        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;

        // Only count a gesture that is clearly horizontal as a swipe
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (hasMultiple) go(dx < 0 ? 1 : -1);
        } else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
          onClose();
        }
        touchStart.current = null;
      }}
    >
      <div
        className="flex items-center justify-between gap-2 p-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="px-1 text-sm tabular-nums text-white/70">
          {hasMultiple ? `${index + 1} / ${images.length}` : ''}
        </span>

        <div className="flex items-center gap-1">
          <LightboxButton
            onClick={() => setZoomed((value) => !value)}
            label={zoomed ? 'Fit to screen' : 'Zoom in'}
          >
            {zoomed ? (
              <ZoomOut className="h-5 w-5" />
            ) : (
              <ZoomIn className="h-5 w-5" />
            )}
          </LightboxButton>

          <LightboxButton href={src} label="Open original">
            <ExternalLink className="h-5 w-5" />
          </LightboxButton>

          <LightboxButton href={src} download={filename} label="Download">
            <Download className="h-5 w-5" />
          </LightboxButton>

          <LightboxButton ref={closeRef} onClick={onClose} label="Close">
            <X className="h-5 w-5" />
          </LightboxButton>
        </div>
      </div>

      <div
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center',
          zoomed ? 'overflow-auto p-0' : 'overflow-hidden p-4'
        )}
      >
        <img
          src={src}
          alt=""
          onClick={(event) => {
            event.stopPropagation();
            setZoomed((value) => !value);
          }}
          className={cn(
            'animate-scale-in select-none',
            zoomed
              ? 'max-w-none cursor-zoom-out'
              : 'max-h-full max-w-full cursor-zoom-in object-contain'
          )}
        />

        {hasMultiple && !zoomed && (
          <>
            <NavButton side="left" onClick={() => go(-1)} />
            <NavButton side="right" onClick={() => go(1)} />
          </>
        )}
      </div>

      {hasMultiple && (
        <div
          className="flex justify-center gap-2 overflow-x-auto p-3 scrollbar-thin"
          onClick={(event) => event.stopPropagation()}
        >
          {images.map((image, position) => (
            <button
              key={`${image}-${position}`}
              type="button"
              onClick={() => {
                setZoomed(false);
                onIndexChange(position);
              }}
              aria-label={`Show image ${position + 1}`}
              aria-current={position === index}
              className={cn(
                'h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-opacity',
                position === index
                  ? 'border-white'
                  : 'border-transparent opacity-50 hover:opacity-90'
              )}
            >
              <img src={image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavButton({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={cn(
        'absolute top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 sm:block',
        side === 'left' ? 'left-3' : 'right-3'
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}

const TOOLBAR_BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

/** Toolbar action. Renders an anchor when given an href, a button otherwise. */
function LightboxButton({
  ref,
  label,
  children,
  onClick,
  href,
  download,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  label: string;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  download?: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        {...(download
          ? { download }
          : { target: '_blank', rel: 'noopener noreferrer' })}
        aria-label={label}
        title={label}
        className={TOOLBAR_BUTTON}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={TOOLBAR_BUTTON}
    >
      {children}
    </button>
  );
}
