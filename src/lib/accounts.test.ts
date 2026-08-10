import { describe, it, expect } from 'vitest';
import {
  MAX_NICKNAME_LENGTH,
  accountName,
  accountSubtitle,
  withNickname,
} from './accounts';

describe('accountName', () => {
  it('prefers the private nickname', () => {
    // Someone who bothered to name an account has said what they want to see
    expect(
      accountName({ nickname: 'Alt', profileName: 'kkworld', fallback: 'x' })
    ).toBe('Alt');
  });

  it('falls back to the profile name, then to the key-derived one', () => {
    expect(accountName({ profileName: 'kkworld', fallback: 'x' })).toBe('kkworld');
    expect(accountName({ fallback: 'Quiet Otter' })).toBe('Quiet Otter');
  });

  it('treats whitespace as absent, so a stray space is not a name', () => {
    expect(
      accountName({ nickname: '   ', profileName: 'kkworld', fallback: 'x' })
    ).toBe('kkworld');
    expect(accountName({ profileName: '  ', fallback: 'Quiet Otter' })).toBe(
      'Quiet Otter'
    );
  });
});

describe('accountSubtitle', () => {
  it('shows the profile name under a nickname that differs', () => {
    expect(accountSubtitle({ nickname: 'Alt', profileName: 'kkworld' })).toBe(
      'kkworld'
    );
  });

  it('says nothing when it would only repeat the line above', () => {
    expect(
      accountSubtitle({ nickname: 'kkworld', profileName: 'kkworld' })
    ).toBeNull();
  });

  it('says nothing when there is no nickname to be under', () => {
    expect(accountSubtitle({ profileName: 'kkworld' })).toBeNull();
  });
});

describe('withNickname', () => {
  it('sets a name', () => {
    expect(withNickname({}, 'abc', 'Alt')).toEqual({ abc: 'Alt' });
  });

  it('removes the entry when cleared, rather than storing an empty string', () => {
    // Otherwise the object grows a tombstone for every name ever tried
    expect(withNickname({ abc: 'Alt', def: 'Main' }, 'abc', '')).toEqual({
      def: 'Main',
    });
    expect(withNickname({ abc: 'Alt' }, 'abc', '   ')).toEqual({});
  });

  it('does not mutate what it was given', () => {
    const labels = { abc: 'Alt' };
    withNickname(labels, 'abc', 'Changed');

    expect(labels).toEqual({ abc: 'Alt' });
  });

  it('trims and caps, so one long paste cannot break the menu', () => {
    const long = 'x'.repeat(MAX_NICKNAME_LENGTH + 20);

    expect(withNickname({}, 'abc', `  ${long}  `).abc).toHaveLength(
      MAX_NICKNAME_LENGTH
    );
  });
});
