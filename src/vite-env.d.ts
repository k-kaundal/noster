/// <reference types="vite/client" />

/**
 * Build-time configuration.
 *
 * Every one of these is inlined into the bundle by Vite and served to every
 * visitor, so all of them are public by definition. Nothing that can move
 * money belongs here.
 */
interface ImportMetaEnv {
  /** Base URL of the LNbits instance. */
  readonly VITE_LNBITS_URL?: string;
  /** Optional house wallet, used only to receive. */
  readonly VITE_LNBITS_WALLET_ID?: string;
  /** Invoice/read key for the house wallet. Cannot spend. */
  readonly VITE_LNBITS_INVOICE_KEY?: string;
  /** Base URL of the Cashu mint that issues this app's ecash. */
  readonly VITE_CASHU_MINT_URL?: string;
  /** Domain for user lightning addresses. Defaults to the LNbits host. */
  readonly VITE_LIGHTNING_ADDRESS_DOMAIN?: string;
  /** Any further domains we issue lightning addresses under, comma separated. */
  readonly VITE_LIGHTNING_ADDRESS_DOMAINS?: string;
  /**
   * Which of those domains give away assigned addresses. The rest are sold.
   * Defaults to the LNbits host, the one domain that answers for free.
   */
  readonly VITE_FREE_LIGHTNING_ADDRESS_DOMAIN?: string;
  readonly VITE_FREE_LIGHTNING_ADDRESS_DOMAINS?: string;
  /** LNbits pay link id for monthly relay access. */
  readonly VITE_PREMIUM_MONTHLY_LINK?: string;
  /** LNbits pay link id for lifetime relay write access. */
  readonly VITE_PREMIUM_LIFETIME_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
