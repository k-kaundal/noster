import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Copy,
  History,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FiatValue } from '@/components/FiatValue';
import { PaymentRequestDialog } from '@/components/wallet/PaymentRequestDialog';
import { useWalletActivity } from '@/hooks/useWalletActivity';
import { useToast } from '@/hooks/useToast';
import {
  describePayment,
  filterPayments,
  groupByDay,
  minutesLeft,
  timeAgo,
  type ActivityFilter,
  type WalletPayment,
} from '@/lib/payments';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

/** How many rows before the list asks to be expanded. */
const PAGE = 15;

/**
 * What the wallet has done, and what it is still waiting for.
 *
 * The list this replaces rendered LNbits' ledger rows more or less directly:
 * every row an amount and a time, with an unpaid invoice shown as an arrival
 * at reduced opacity. Two problems, and the second is the serious one. Money
 * that arrived and money that has merely been *asked for* looked the same, and
 * a request had no actions at all — no way to show it again, copy it, or find
 * out whether it had been paid.
 *
 * So requests are lifted out to the top, where they read as a to-do list, and
 * the history underneath is filterable, searchable and grouped by day.
 */
export function ActivityCard({ className }: { className?: string }) {
  const { payments, openRequests, month, isLoading, isFetching, refetch } =
    useWalletActivity();
  const { toast } = useToast();

  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showing, setShowing] = useState<WalletPayment | null>(null);

  const matching = useMemo(
    () => filterPayments(payments, filter, query),
    [payments, filter, query]
  );

  const days = useMemo(
    () => groupByDay(matching.slice(0, limit)),
    [matching, limit]
  );

  const requestCount = openRequests.length;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b bg-muted/30 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-4 w-4 text-primary" />
          </div>
          Activity
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 w-7 p-0"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh activity"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
            />
          </Button>
        </CardTitle>

        {/* The month in two numbers. A balance says what is left; this says
            what has been happening, which is the question a history is opened
            to answer. */}
        {(month.inSats > 0 || month.outSats > 0) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Summary label="In" sats={month.inSats} tone="in" />
            <Summary label="Out" sats={month.outSats} tone="out" />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4 p-0 pb-2">
        {requestCount > 0 && (
          <OpenRequests
            requests={openRequests}
            onShow={setShowing}
            onCopy={async (payment) => {
              await navigator.clipboard.writeText(payment.bolt11);
              toast({ title: 'Invoice copied' });
            }}
          />
        )}

        {(payments.length > 0 || filter !== 'all') && (
          <div className="space-y-3 px-6 pt-4">
            <Tabs
              value={filter}
              onValueChange={(value) => {
                setFilter(value as ActivityFilter);
                setLimit(PAGE);
              }}
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="in">In</TabsTrigger>
                <TabsTrigger value="out">Out</TabsTrigger>
                <TabsTrigger value="requests">
                  Requests
                  {requestCount > 0 && (
                    <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-[10px] font-semibold text-warning-strong">
                      {requestCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Only once there is enough to lose something in */}
            {payments.length > PAGE && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(PAGE);
                  }}
                  placeholder="Search notes, amounts, hashes"
                  className="h-9 pl-9 pr-9"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3 px-6 py-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : !matching.length ? (
          <Empty filter={filter} searching={!!query} anything={!!payments.length} />
        ) : (
          <div className="pt-2">
            {days.map((day) => (
              <section key={day.key}>
                <h3 className="sticky top-0 z-10 bg-background/95 px-6 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {day.label}
                </h3>

                <ul className="divide-y border-y">
                  {day.payments.map((payment) => (
                    <PaymentRow
                      key={payment.id}
                      payment={payment}
                      expanded={expanded === payment.id}
                      onToggle={() =>
                        setExpanded(expanded === payment.id ? null : payment.id)
                      }
                      onShow={() => setShowing(payment)}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {matching.length > limit && (
              <div className="px-6 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setLimit(limit + PAGE * 2)}
                >
                  Show more ({matching.length - limit} left)
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <PaymentRequestDialog
        request={showing}
        open={!!showing}
        onOpenChange={(next) => !next && setShowing(null)}
      />
    </Card>
  );
}

function Summary({
  label,
  sats,
  tone,
}: {
  label: string;
  sats: number;
  tone: 'in' | 'out';
}) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label} · 30 days
      </p>
      <p
        className={cn(
          'tabular text-sm font-semibold',
          tone === 'in' ? 'text-success' : 'text-foreground'
        )}
      >
        {tone === 'in' ? '+' : '−'}
        {formatSats(sats)}
      </p>
      <FiatValue sats={sats} className="text-xs text-muted-foreground" />
    </div>
  );
}

/**
 * Invoices still waiting, at the top where they can be acted on.
 *
 * These are the only rows in the whole list with something left to do, which
 * is why they are not left to be found among settled payments — an invoice
 * somebody is waiting to be paid is a task, not a record.
 */
function OpenRequests({
  requests,
  onShow,
  onCopy,
}: {
  requests: WalletPayment[];
  onShow: (payment: WalletPayment) => void;
  onCopy: (payment: WalletPayment) => void;
}) {
  return (
    <div className="border-b border-warning/30 bg-warning/8 px-6 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-warning-strong" />
        <p className="text-sm font-semibold text-warning-strong">
          {requests.length === 1
            ? 'Awaiting payment'
            : `${requests.length} awaiting payment`}
        </p>
      </div>

      <ul className="space-y-2">
        {requests.slice(0, 3).map((request) => {
          const left = minutesLeft(request);

          return (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning/40 bg-background/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {formatSats(request.sats)}
                  {request.memo ? ` · ${request.memo}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {left === null
                    ? 'Waiting'
                    : `Expires in ${left} ${left === 1 ? 'minute' : 'minutes'}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onShow(request)}
                >
                  Show
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  aria-label="Copy invoice"
                  onClick={() => onCopy(request)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {requests.length > 3 && (
        <p className="mt-2 text-xs text-muted-foreground">
          And {requests.length - 3} more in the Requests tab.
        </p>
      )}
    </div>
  );
}

function PaymentRow({
  payment,
  expanded,
  onToggle,
  onShow,
}: {
  payment: WalletPayment;
  expanded: boolean;
  onToggle: () => void;
  onShow: () => void;
}) {
  const copy = describePayment(payment);
  const incoming = payment.direction === 'incoming';
  const settled = payment.state === 'received' || payment.state === 'sent';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={expanded}
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            payment.state === 'received' && 'bg-success/10',
            payment.state === 'sent' && 'bg-muted',
            payment.state === 'request' && 'bg-warning/15',
            (payment.state === 'expired' || payment.state === 'failed') &&
              'bg-muted',
            payment.state === 'sending' && 'bg-muted'
          )}
        >
          {payment.state === 'request' || payment.state === 'expired' ? (
            <Clock
              className={cn(
                'h-5 w-5',
                payment.state === 'request'
                  ? 'text-warning-strong'
                  : 'text-muted-foreground'
              )}
            />
          ) : payment.state === 'sending' ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : incoming ? (
            <ArrowDownLeft className="h-5 w-5 text-success" />
          ) : (
            <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {copy.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[copy.detail, timeAgo(payment.createdAt)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span
            className={cn(
              'tabular block text-sm font-semibold',
              payment.state === 'received' && 'text-success',
              !settled && 'text-muted-foreground',
              payment.state === 'failed' && 'text-destructive'
            )}
          >
            {/*
              A request is written without a sign. "+5,000" on an invoice
              nobody has paid states a balance that does not exist, which is
              exactly how the old list read.
            */}
            {settled ? (incoming ? '+' : '−') : ''}
            {formatSats(payment.sats)}
          </span>
          <FiatValue
            sats={payment.sats}
            className="block text-[11px] text-muted-foreground"
          />
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t bg-muted/30 px-6 py-3 text-xs">
          <Detail label="Status" value={statusWord(payment)} />
          {payment.feeSats > 0 && (
            <Detail label="Fee" value={`${formatSats(payment.feeSats)}`} />
          )}
          {payment.createdAt > 0 && (
            <Detail
              label="When"
              value={new Date(payment.createdAt).toLocaleString()}
            />
          )}
          {payment.hash && (
            <Detail label="Hash" value={payment.hash} mono truncate />
          )}

          {payment.state === 'request' && (
            <Button
              size="sm"
              variant="outline"
              className="mt-1 h-7 w-full text-xs"
              onClick={onShow}
            >
              Show this request
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function statusWord(payment: WalletPayment): string {
  switch (payment.state) {
    case 'request':
      return 'Awaiting payment';
    case 'expired':
      return 'Expired unpaid';
    case 'sending':
      return 'Not confirmed yet';
    case 'failed':
      return 'Failed';
    default:
      return 'Complete';
  }
}

function Detail({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right font-medium',
          mono && 'font-mono text-[10px]',
          truncate && 'max-w-[200px] truncate'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Empty({
  filter,
  searching,
  anything,
}: {
  filter: ActivityFilter;
  searching: boolean;
  anything: boolean;
}) {
  const message = searching
    ? 'Nothing matches that.'
    : !anything
      ? 'Nothing yet. Payments and zaps show up here.'
      : filter === 'requests'
        ? 'No payment requests. Invoices you create appear here until they are paid.'
        : filter === 'in'
          ? 'Nothing received yet.'
          : filter === 'out'
            ? 'Nothing sent yet.'
            : 'Nothing yet.';

  return (
    <div className="px-6 py-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
