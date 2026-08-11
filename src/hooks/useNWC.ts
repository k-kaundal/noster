import { useState, useCallback, useEffect } from 'react';
import { useAccountStored } from '@/hooks/useStore';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { defineKey, readStore, removeStore } from '@/lib/store';
import { useToast } from '@/hooks/useToast';
import type { LN } from '@getalby/sdk';

/**
 * The Alby SDK, fetched the first time a wallet is actually used.
 *
 * `NWCProvider` mounts at the app root, so a static import here put the whole
 * SDK — the single largest dependency in the tree — into the chunk the browser
 * has to parse before it can paint anything. Almost nobody has a remote wallet
 * connected, and nobody at all needs it to read a feed.
 *
 * Cached in a module-level promise so the second payment doesn't wait again.
 */
let sdk: Promise<typeof import('@getalby/sdk')> | undefined;

function loadSdk() {
  sdk ??= import('@getalby/sdk');
  return sdk;
}

/** Bounds a wallet round trip, which has no timeout of its own. */
async function withNwcTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 15000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface NWCConnection {
  connectionString: string;
  alias?: string;
  isConnected: boolean;
  client?: LN;
}

export interface NWCInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  methods?: string[];
  notifications?: string[];
}

/**
 * Where connections used to live: one list, shared by every account.
 *
 * Read once per account so an upgrade does not look like a wallet
 * disappearing, then cleared.
 */
const LEGACY_CONNECTIONS = 'nwc-connections';
const LEGACY_ACTIVE = 'nwc-active-connection';

export function useNWCInternal() {
  const { toast } = useToast();
  const { user } = useCurrentUser();

  /**
   * Connections belong to one account, not to the browser.
   *
   * These were kept under a single key shared by every login, so switching
   * Nostr accounts left the previous account's wallets connected — and an NWC
   * connection string is a spending credential, not a preference. The next
   * person to use the app could see that balance and pay from it.
   */
  const [connections, setConnections] = useAccountStored<NWCConnection[]>(
    'nwc:connections',
    []
  );
  const [activeConnection, setActiveConnection] = useAccountStored<
    string | null
  >('nwc:active', null);
  const [connectionInfo, setConnectionInfo] = useState<Record<string, NWCInfo>>({});

  /**
   * Adopts anything left in the old shared slot.
   *
   * Given to whichever account is signed in when the upgrade lands, because
   * that is who the app was already showing them to — the old storage records
   * no owner, so there is nothing better to go on, and dropping them would
   * disconnect a working wallet without saying so. Cleared afterwards, which
   * is what stops the sharing.
   *
   * Never while signed out: handing them to the anonymous scope would strand
   * them somewhere no real account can reach.
   */
  useEffect(() => {
    if (!user || connections.length) return;

    const legacy = readStore(
      defineKey<NWCConnection[]>(LEGACY_CONNECTIONS, [])
    );
    if (!legacy.length) return;

    const legacyActive = readStore(
      defineKey<string | null>(LEGACY_ACTIVE, null)
    );

    setConnections(legacy);
    if (legacyActive) setActiveConnection(legacyActive);

    removeStore(defineKey<NWCConnection[]>(LEGACY_CONNECTIONS, []));
    removeStore(defineKey<string | null>(LEGACY_ACTIVE, null));
  }, [user, connections.length, setConnections, setActiveConnection]);

  // Add new connection
  const addConnection = async (uri: string, alias?: string): Promise<boolean> => {
    const parseNWCUri = (uri: string): { connectionString: string } | null => {
      try {
        if (!uri.startsWith('nostr+walletconnect://') && !uri.startsWith('nostrwalletconnect://')) {
          console.error('Invalid NWC URI protocol:', { protocol: uri.split('://')[0] });
          return null;
        }
        return { connectionString: uri };
      } catch (error) {
        console.error('Failed to parse NWC URI:', error);
        return null;
      }
    };

    const parsed = parseNWCUri(uri);
    if (!parsed) {
      toast({
        title: 'Invalid NWC URI',
        description: 'Please check the connection string and try again.',
        variant: 'destructive',
      });
      return false;
    }

    const existingConnection = connections.find(c => c.connectionString === parsed.connectionString);
    if (existingConnection) {
      toast({
        title: 'Connection already exists',
        description: 'This wallet is already connected.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const testPromise = loadSdk().then(
        ({ LN }) => new LN(parsed.connectionString)
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Connection test timeout')), 10000);
      });

      try {
        await Promise.race([testPromise, timeoutPromise]) as LN;
        if (timeoutId) clearTimeout(timeoutId);
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }

      const connection: NWCConnection = {
        connectionString: parsed.connectionString,
        alias: alias || 'NWC Wallet',
        isConnected: true,
      };

      setConnectionInfo(prev => ({
        ...prev,
        [parsed.connectionString]: {
          alias: connection.alias,
          methods: ['pay_invoice'],
        },
      }));

      const newConnections = [...connections, connection];
      setConnections(newConnections);

      if (connections.length === 0 || !activeConnection)
        setActiveConnection(parsed.connectionString);

      toast({
        title: 'Wallet connected',
        description: `Successfully connected to ${connection.alias}.`,
      });

      return true;
    } catch (error) {
      console.error('NWC connection failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      toast({
        title: 'Connection failed',
        description: `Could not connect to the wallet: ${errorMessage}`,
        variant: 'destructive',
      });
      return false;
    }
  };

  // Remove connection
  const removeConnection = (connectionString: string) => {
    const filtered = connections.filter(c => c.connectionString !== connectionString);
    setConnections(filtered);

    if (activeConnection === connectionString) {
      const newActive = filtered.length > 0 ? filtered[0].connectionString : null;
      setActiveConnection(newActive);
    }

    setConnectionInfo(prev => {
      const newInfo = { ...prev };
      delete newInfo[connectionString];
      return newInfo;
    });

    toast({
      title: 'Wallet disconnected',
      description: 'The wallet connection has been removed.',
    });
  };

  // Get active connection
  const getActiveConnection = useCallback((): NWCConnection | null => {
    if (!activeConnection && connections.length > 0) {
      setActiveConnection(connections[0].connectionString);
      return connections[0];
    }

    if (!activeConnection) return null;

    const found = connections.find(c => c.connectionString === activeConnection);
    return found || null;
  }, [activeConnection, connections, setActiveConnection]);

  // Send payment using the SDK
  const sendPayment = useCallback(async (
    connection: NWCConnection,
    invoice: string
  ): Promise<{ preimage: string }> => {
    if (!connection.connectionString) {
      throw new Error('Invalid connection: missing connection string');
    }

    let client: LN;
    try {
      const { LN } = await loadSdk();
      client = new LN(connection.connectionString);
    } catch (error) {
      console.error('Failed to create NWC client:', error);
      throw new Error(`Failed to create NWC client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Payment timeout after 15 seconds')), 15000);
      });

      const paymentPromise = client.pay(invoice);

      try {
        const response = await Promise.race([paymentPromise, timeoutPromise]) as { preimage: string };
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      console.error('NWC payment failed:', error);

      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error('Payment timed out. Please try again.');
        } else if (error.message.includes('insufficient')) {
          throw new Error('Insufficient balance in connected wallet.');
        } else if (error.message.includes('invalid')) {
          throw new Error('Invalid invoice or connection. Please check your wallet.');
        } else {
          throw new Error(`Payment failed: ${error.message}`);
        }
      }

      throw new Error('Payment failed with unknown error');
    }
  }, []);

  /**
   * Asks a connected wallet for an invoice.
   *
   * The other half of NWC, and the half this app never used: `pay_invoice`
   * was wired up and `make_invoice` was not, so a wallet somebody connected
   * could spend but not receive. Being paid is most of what a wallet is for,
   * and the omission meant every incoming payment had to route through the
   * custodial wallet here instead of the one they chose.
   */
  const receivePayment = useCallback(async (
    connection: NWCConnection,
    amountSats: number,
    description?: string
  ): Promise<{ bolt11: string }> => {
    if (!connection.connectionString) {
      throw new Error('Invalid connection: missing connection string');
    }

    const { LN, SATS } = await loadSdk();
    const client = new LN(connection.connectionString);

    try {
      const request = await withNwcTimeout(
        client.requestPayment(SATS(amountSats), description ? { description } : undefined),
        'Timed out waiting for your wallet to make an invoice.'
      );

      /**
       * The SDK wraps the invoice in an object whose shape has moved between
       * versions. Both spellings are read rather than one being assumed —
       * getting this wrong hands somebody `[object Object]` to be paid.
       */
      const invoice = request.invoice as unknown as {
        invoice?: string;
        paymentRequest?: string;
      };

      const bolt11 = invoice?.invoice ?? invoice?.paymentRequest;
      if (!bolt11) {
        throw new Error('That wallet returned no invoice.');
      }

      return { bolt11 };
    } catch (error) {
      if (error instanceof Error) {
        // A wallet can be connected with send permission only, which is a
        // setting on their side rather than anything to retry here
        if (/not (supported|permitted)|unauthorized|method/i.test(error.message)) {
          throw new Error(
            'That wallet did not allow an invoice to be made. Its connection may be send-only.'
          );
        }

        throw error;
      }

      throw new Error('Could not get an invoice from that wallet.');
    }
  }, []);

  return {
    connections,
    activeConnection,
    connectionInfo,
    addConnection,
    removeConnection,
    setActiveConnection,
    getActiveConnection,
    sendPayment,
    receivePayment,
  };
}