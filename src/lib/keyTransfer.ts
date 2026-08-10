import { nip19 } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip49';

/**
 * Moving a Nostr key from one device to another.
 *
 * The key is the account: there is no reset, no support line, and no way to
 * take it back once someone else has it. So the two ways out of this app are
 * deliberately different in kind — a plain key, which any client can read and
 * so can anyone looking at the screen, and a NIP-49 encrypted key, which is
 * useless to a passer-by or a photograph without the passphrase.
 */

export function isNsec(value: string): boolean {
  return /^nsec1[02-9ac-hj-np-z]{58}$/.test(value.trim());
}

export function isNcryptsec(value: string): boolean {
  return /^ncryptsec1[02-9ac-hj-np-z]+$/.test(value.trim());
}

/** Either form, which is all a login field needs to know before trying. */
export function isSecretKeyInput(value: string): boolean {
  return isNsec(value) || isNcryptsec(value);
}

/**
 * Wraps a key in a passphrase.
 *
 * Slow on purpose — NIP-49 uses scrypt, so a weak passphrase still costs a
 * long time per guess. That also means this blocks for a second or two and
 * should not be called on a keystroke.
 */
export function encryptKey(nsec: string, passphrase: string): string {
  if (!isNsec(nsec)) throw new Error('That is not an nsec.');
  if (passphrase.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters.');
  }

  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== 'nsec') throw new Error('That is not an nsec.');

  return encrypt(decoded.data, passphrase);
}

/**
 * Unwraps an encrypted key back to an nsec.
 *
 * A wrong passphrase and a corrupt payload are the same failure to a person
 * standing at a login screen, so they get the same message — one that names
 * the likely cause rather than the cryptographic one.
 */
export function decryptToNsec(ncryptsec: string, passphrase: string): string {
  let secret: Uint8Array;

  try {
    secret = decrypt(ncryptsec.trim(), passphrase);
  } catch {
    throw new Error(
      'That passphrase does not open this key. Check it and try again.'
    );
  }

  return nip19.nsecEncode(secret);
}

/**
 * What a QR should actually contain.
 *
 * The bare bech32 string, with no `nostr:` prefix. Signer apps and clients
 * scanning a login code expect the key itself, and a prefixed one is read as
 * a URI they then fail to decode.
 */
export function keyQrValue(key: string): string {
  return key.trim();
}
