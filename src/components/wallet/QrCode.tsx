import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';

interface QrCodeProps {
  value: string;
  /** Announced to screen readers, which cannot read the code itself. */
  label: string;
  size?: number;
  className?: string;
}

/**
 * A scannable code on a white panel, in both themes.
 *
 * Deliberately not themed. A dark-mode QR with inverted colours scans badly on
 * many phone cameras, and a payment that fails to scan is worse than one that
 * looks slightly out of place.
 */
export function QrCode({ value, label, size = 208, className }: QrCodeProps) {
  return (
    <div
      className={cn(
        'mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/10',
        className
      )}
      role="img"
      aria-label={label}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={0}
        bgColor="#ffffff"
        fgColor="#000000"
      />
    </div>
  );
}
