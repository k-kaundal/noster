import { Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EXPIRY_CHOICES } from '@/lib/expiration';
import { cn } from '@/lib/utils';

interface ExpiryFieldProps {
  id?: string;
  /** The chosen `EXPIRY_CHOICES` id. */
  value: string;
  onChange: (id: string) => void;
  /**
   * Write relays known from their NIP-11 document not to support NIP-40.
   * Named so the warning can say which, rather than only that some.
   */
  unsupportedRelays?: string[];
  className?: string;
}

/**
 * The NIP-40 control.
 *
 * The warning is not decoration. An `expiration` tag is a request to relays,
 * not a delete: a relay MAY keep the event forever, anyone who already read it
 * keeps their copy, and archivers keep everything. Someone reaching for this
 * to unsay something needs to know that before they post, not after.
 */
export function ExpiryField({
  id = 'post-expiry',
  value,
  onChange,
  unsupportedRelays = [],
  className,
}: ExpiryFieldProps) {
  const expires = value !== 'never';

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={id}
          className="flex items-center gap-2 text-sm font-normal"
        >
          <Clock className="h-4 w-4 text-muted-foreground" />
          Ask relays to delete after
        </Label>

        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="h-8 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_CHOICES.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {expires && (
        <p className="text-xs text-muted-foreground">
          A request, not a guarantee. Relays may keep it anyway, and anyone who
          already read it keeps their copy — don't use this to post something
          you need taken back.
        </p>
      )}

      {expires && unsupportedRelays.length > 0 && (
        <p className="text-xs text-warning-strong">
          {unsupportedRelays.join(', ')}{' '}
          {unsupportedRelays.length === 1 ? "doesn't" : "don't"} support
          expiring events, so this won't be sent there.
        </p>
      )}
    </div>
  );
}
