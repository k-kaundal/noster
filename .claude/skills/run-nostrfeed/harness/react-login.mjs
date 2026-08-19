/**
 * Runtime stand-in for `@nostrify/react/login`.
 *
 * Signs the harness in as the first fixture actor by default, because almost
 * every screen worth reviewing is behind a login: the composer, Studio, the
 * wallet, notifications, the community post box. A logged-out harness can only
 * screenshot the sign-in wall.
 *
 * Set `window.__NOSTRFEED_SIGNED_OUT__ = true` before load — or pass
 * `--signed-out` to the driver — to review the logged-out design instead.
 */
import * as React from 'react';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';

import { ME } from './fixtures.mjs';

const LoginContext = React.createContext(undefined);

/** A signer that really signs, using a fixture secret key. */
function signerFor(secret) {
  return {
    getPublicKey: async () => getPublicKey(secret),
    signEvent: async (template) => finalizeEvent(template, secret),
    nip04: {
      encrypt: async (_pubkey, plaintext) => btoa(plaintext),
      decrypt: async (_pubkey, ciphertext) => atob(ciphertext),
    },
    /*
     * Base64 rather than real NIP-44. The app only needs encrypt/decrypt to
     * round-trip so that private lists and DMs render; reviewing the design of
     * a screen does not require the ciphertext to be sound, and pulling in a
     * real implementation would mean vendoring the whole cipher.
     *
     * Never point this shim at anything but fixtures.
     */
    nip44: {
      encrypt: async (_pubkey, plaintext) => btoa(unescape(encodeURIComponent(plaintext))),
      decrypt: async (_pubkey, ciphertext) => decodeURIComponent(escape(atob(ciphertext))),
    },
  };
}

const nsecLogin = (actor) => ({
  id: `nsec-${actor.pubkey.slice(0, 8)}`,
  type: 'nsec',
  createdAt: new Date().toISOString(),
  pubkey: actor.pubkey,
  nsec: nip19.nsecEncode(actor.secret),
});

export function NostrLoginProvider({ children }) {
  const signedOut =
    typeof window !== 'undefined' && window.__NOSTRFEED_SIGNED_OUT__ === true;

  const [logins, setLogins] = React.useState(() =>
    signedOut ? [] : [nsecLogin(ME)]
  );

  const value = React.useMemo(
    () => ({
      logins,
      addLogin: (login) =>
        setLogins((held) => [login, ...held.filter((l) => l.id !== login.id)]),
      removeLogin: (id) => setLogins((held) => held.filter((l) => l.id !== id)),
      setLogin: (id) =>
        setLogins((held) => {
          const found = held.find((l) => l.id === id);
          return found ? [found, ...held.filter((l) => l.id !== id)] : held;
        }),
    }),
    [logins]
  );

  return React.createElement(LoginContext.Provider, { value }, children);
}

export function useNostrLogin() {
  const context = React.useContext(LoginContext);
  if (!context) throw new Error('useNostrLogin outside NostrLoginProvider');
  return context;
}

export const NLogin = {
  fromNsec(nsec) {
    const { data } = nip19.decode(nsec);
    return {
      id: `nsec-${getPublicKey(data).slice(0, 8)}`,
      type: 'nsec',
      createdAt: new Date().toISOString(),
      pubkey: getPublicKey(data),
      nsec,
    };
  },
  async fromBunker() {
    throw new Error('[harness] bunker login is not available offline');
  },
  async fromExtension() {
    throw new Error('[harness] no NIP-07 extension in the harness browser');
  },
};

export const NUser = {
  fromNsecLogin(login) {
    const { data } = nip19.decode(login.nsec);
    return { pubkey: getPublicKey(data), signer: signerFor(data) };
  },
  fromBunkerLogin(login) {
    return { pubkey: login.pubkey, signer: signerFor(ME.secret) };
  },
  fromExtensionLogin(login) {
    return { pubkey: login.pubkey, signer: signerFor(ME.secret) };
  },
};
