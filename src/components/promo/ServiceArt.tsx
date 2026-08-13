import { useId } from 'react';
import type { Service } from '@/lib/services';
import { cn } from '@/lib/utils';

/**
 * Artwork for the three services.
 *
 * Drawn rather than photographed, and drawn as vectors rather than shipped as
 * images: these sit in a sidebar at a dozen different sizes, and a PNG that
 * looks right at one of them is soft at the rest. It is also three fewer
 * network requests on a page that already makes plenty.
 *
 * Each piece carries its own dark gradient rather than reading colours from
 * the theme. A promotional tile is meant to look the same in both modes — the
 * card around it adapts, the artwork inside it is the brand.
 */

interface ArtProps {
  service: Service['id'];
  className?: string;
}

export function ServiceArt({ service, className }: ArtProps) {
  const common = cn('block h-full w-full', className);

  if (service === 'names') return <NamesArt className={common} />;
  if (service === 'lightning') return <LightningArt className={common} />;
  if (service === 'mint') return <MintArt className={common} />;
  return <WalletArt className={common} />;
}

/**
 * The name itself, wearing its checkmark.
 *
 * What is being sold is a string of text, so the artwork is that string —
 * drawn rather than typed, because the point is the shape of `you@getzap.me`
 * rather than any particular person's name. The ✓ sits against it the way it
 * will sit against their posts.
 */
function NamesArt({ className }: { className?: string }) {
  const id = useId();

  return (
    <Frame className={className} label="GetZap">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a0620" />
          <stop offset="55%" stopColor="#3f0d4a" />
          <stop offset="100%" stopColor="#140418" />
        </linearGradient>

        <linearGradient id={`${id}-pill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0abfc" />
          <stop offset="100%" stopColor="#c026d3" />
        </linearGradient>

        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e879f9" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#e879f9" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="320" height="180" fill={`url(#${id}-bg)`} />
      <circle cx="160" cy="90" r="88" fill={`url(#${id}-glow)`} />

      {/* The name, as a card rather than as text: real letters here would be
          one person's name, and this is about the shape of having one */}
      <rect
        x="58"
        y="58"
        width="204"
        height="64"
        rx="32"
        fill={`url(#${id}-pill)`}
      />

      {/* `you` — three short strokes, then the @, then the domain */}
      <rect x="82" y="84" width="30" height="10" rx="5" fill="#faf5ff" opacity="0.95" />
      <circle cx="126" cy="89" r="8" fill="none" stroke="#faf5ff" strokeWidth="3" opacity="0.9" />
      <rect x="142" y="84" width="58" height="10" rx="5" fill="#faf5ff" opacity="0.8" />

      {/* The checkmark it comes with, on its own disc so it reads as a badge */}
      <circle cx="222" cy="89" r="17" fill="#0f172a" opacity="0.35" />
      <circle cx="222" cy="89" r="15" fill="#22c55e" />
      <path
        d="M215 89 L220 94 L230 83"
        fill="none"
        stroke="#f0fdf4"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Zaps arriving at it from both sides */}
      {[
        { x: 30, y: 46, r: 6, o: 0.8 },
        { x: 46, y: 132, r: 4.5, o: 0.55 },
        { x: 286, y: 52, r: 5, o: 0.7 },
        { x: 272, y: 138, r: 3.5, o: 0.45 },
      ].map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill="#f5d0fe"
          opacity={dot.o}
        />
      ))}
    </Frame>
  );
}

/** Shared frame: 16:9, rounded by the container, never distorted. */
function Frame({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <svg
      viewBox="0 0 320 180"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/**
 * A bolt, and the sats it moves.
 *
 * The bolt is the one symbol everyone already reads as "lightning", so it is
 * drawn large and unadorned rather than decorated into ambiguity.
 */
function LightningArt({ className }: { className?: string }) {
  const id = useId();

  return (
    <Frame className={className} label="NostrFeed Lightning">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1206" />
          <stop offset="55%" stopColor="#3b2408" />
          <stop offset="100%" stopColor="#120d04" />
        </linearGradient>

        <linearGradient id={`${id}-bolt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>

        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="320" height="180" fill={`url(#${id}-bg)`} />
      <circle cx="160" cy="90" r="86" fill={`url(#${id}-glow)`} />

      {/* Speed lines: the bolt is arriving, not sitting still */}
      {[38, 62, 118, 142].map((y, index) => (
        <rect
          key={y}
          x={index % 2 ? 24 : 40}
          y={y}
          width={index % 2 ? 66 : 48}
          height="3"
          rx="1.5"
          fill="#fbbf24"
          opacity={0.18 + index * 0.04}
        />
      ))}

      <path
        d="M172 26 L118 96 L152 96 L140 154 L200 80 L164 80 Z"
        fill={`url(#${id}-bolt)`}
      />

      {/* Sats leaving to the right, getting smaller as they go */}
      {[
        { x: 224, y: 60, r: 7 },
        { x: 250, y: 92, r: 5 },
        { x: 274, y: 122, r: 3.5 },
        { x: 292, y: 46, r: 2.5 },
      ].map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill="#fcd34d"
          opacity="0.85"
        />
      ))}
    </Frame>
  );
}

/**
 * A coin being struck, and the blinding that makes it private.
 *
 * The concentric rings are the point: the mint signs the outer ring without
 * ever seeing the token at the centre.
 */
function MintArt({ className }: { className?: string }) {
  const id = useId();

  return (
    <Frame className={className} label="NostrFeed Mint">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#04160f" />
          <stop offset="55%" stopColor="#06301f" />
          <stop offset="100%" stopColor="#031009" />
        </linearGradient>

        <linearGradient id={`${id}-coin`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      <rect width="320" height="180" fill={`url(#${id}-bg)`} />

      {/* The blinding: rings the mint signs across without reading */}
      {[74, 60, 46].map((r, index) => (
        <circle
          key={r}
          cx="160"
          cy="90"
          r={r}
          fill="none"
          stroke="#34d399"
          strokeOpacity={0.12 + index * 0.08}
          strokeWidth="1.5"
          strokeDasharray={index === 0 ? '4 6' : undefined}
        />
      ))}

      {/* Milled edge, the way a struck coin is actually made */}
      {Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2;
        const inner = 35;
        const outer = 39;

        return (
          <line
            key={angle}
            x1={160 + Math.cos(angle) * inner}
            y1={90 + Math.sin(angle) * inner}
            x2={160 + Math.cos(angle) * outer}
            y2={90 + Math.sin(angle) * outer}
            stroke="#6ee7b7"
            strokeOpacity="0.35"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}

      <circle cx="160" cy="90" r="34" fill={`url(#${id}-coin)`} />
      <circle
        cx="160"
        cy="90"
        r="34"
        fill="none"
        stroke="#a7f3d0"
        strokeOpacity="0.5"
        strokeWidth="1.5"
      />

      {/* The blind: a band laid across the coin the mint signs through. No
          currency glyph — this is not any country's money, and borrowing a
          symbol that belongs to one would say the wrong thing */}
      <clipPath id={`${id}-coin-clip`}>
        <circle cx="160" cy="90" r="34" />
      </clipPath>

      <g clipPath={`url(#${id}-coin-clip)`}>
        <rect
          x="112"
          y="78"
          width="96"
          height="13"
          fill="#ecfdf5"
          opacity="0.5"
          transform="rotate(-28 160 90)"
        />
        <rect
          x="112"
          y="96"
          width="96"
          height="7"
          fill="#ecfdf5"
          opacity="0.28"
          transform="rotate(-28 160 90)"
        />
      </g>

      {/* Tokens leaving the mint, one already handed on */}
      {[
        { x: 62, y: 54, r: 11, o: 0.9 },
        { x: 44, y: 116, r: 8, o: 0.6 },
        { x: 268, y: 62, r: 9, o: 0.75 },
        { x: 284, y: 124, r: 6, o: 0.45 },
      ].map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill="#34d399"
          opacity={dot.o}
        />
      ))}
    </Frame>
  );
}

/**
 * Cards fanned out behind a scannable square.
 *
 * Says "a wallet you open" rather than "a wallet you install": what is drawn
 * is a screen, not a device.
 */
function WalletArt({ className }: { className?: string }) {
  const id = useId();

  return (
    <Frame className={className} label="NostrFeed Wallet">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#120a24" />
          <stop offset="55%" stopColor="#291452" />
          <stop offset="100%" stopColor="#0d0719" />
        </linearGradient>

        <linearGradient id={`${id}-card`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>

        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="320" height="180" fill={`url(#${id}-bg)`} />
      <circle cx="160" cy="92" r="90" fill={`url(#${id}-glow)`} />

      {/* Two cards behind, one in front: a stack, not a single screen */}
      <rect
        x="76"
        y="40"
        width="150"
        height="86"
        rx="12"
        fill="#c4b5fd"
        opacity="0.22"
        transform="rotate(-8 151 83)"
      />
      <rect
        x="84"
        y="46"
        width="150"
        height="86"
        rx="12"
        fill="#c4b5fd"
        opacity="0.35"
        transform="rotate(-4 159 89)"
      />
      <rect
        x="92"
        y="52"
        width="150"
        height="86"
        rx="12"
        fill={`url(#${id}-card)`}
      />

      {/* Balance, abstracted to bars so no number here can ever be wrong */}
      <rect x="106" y="68" width="44" height="6" rx="3" fill="#ede9fe" opacity="0.7" />
      <rect x="106" y="82" width="76" height="11" rx="5.5" fill="#ffffff" opacity="0.95" />
      <rect x="106" y="102" width="30" height="6" rx="3" fill="#ede9fe" opacity="0.55" />
      <rect x="142" y="102" width="30" height="6" rx="3" fill="#ede9fe" opacity="0.55" />

      {/* A scannable code: how a wallet is actually handed something. The
          three corner squares are what makes a QR read as a QR at this size —
          without them it is just a grid of dots */}
      <rect x="194" y="70" width="42" height="42" rx="6" fill="#1c0f38" opacity="0.9" />

      {[
        [199, 75],
        [222, 75],
        [199, 98],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect
            x={x}
            y={y}
            width="9"
            height="9"
            rx="1.5"
            fill="none"
            stroke="#ddd6fe"
            strokeWidth="2"
          />
          <rect x={x + 3.5} y={y + 3.5} width="2" height="2" fill="#ddd6fe" />
        </g>
      ))}

      {[
        [223, 99],
        [227, 99],
        [231, 99],
        [223, 103],
        [231, 103],
        [227, 107],
        [223, 107],
        [212, 87],
        [216, 87],
        [212, 91],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="3"
          height="3"
          fill="#ddd6fe"
          opacity="0.85"
        />
      ))}
    </Frame>
  );
}
