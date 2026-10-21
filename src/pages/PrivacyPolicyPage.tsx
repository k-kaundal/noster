import { Layout } from '@/components/Layout';
import { useSeo } from '@/hooks/useSeo';

const EFFECTIVE_DATE = 'October 21, 2026';
const CONTACT_EMAIL = 'kk@kaundal.vip';
const APP_NAME = 'Nostr Feed';

/**
 * Privacy Policy.
 *
 * Public, non-editable, worldwide-accessible page — required by Google Play
 * and linked from the store listing and from within the app.
 */
export default function PrivacyPolicyPage() {
  useSeo({
    title: 'Privacy Policy',
    description:
      'How Nostr Feed collects, uses, and protects your data. Covers your Nostr keys, relays, wallets, and what is stored where.',
  });

  return (
    <Layout>
      <article className="mx-auto max-w-2xl space-y-8 px-1 py-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        <p className="text-sm leading-relaxed text-muted-foreground">
          This Privacy Policy explains how {APP_NAME} ("we", "our", or "the
          app") handles your information when you use our website, mobile
          application, and related services (collectively, the "Service"). By
          using the Service, you agree to the practices described here.
        </p>

        <Section title="1. Who we are">
          <p>
            {APP_NAME} is an independent Nostr client built and maintained by
            an individual developer ({' '}
            <a
              href="https://x.com/k_k_kaundal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              @k_k_kaundal
            </a>
            ). For any privacy question, contact us at{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="2. The short version">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Your keys stay with you.</strong> Your Nostr private key
              (nsec) is generated and stored only on your device. We never see
              it, transmit it to our servers, or have access to it.
            </li>
            <li>
              <strong>No accounts on our servers.</strong> There is no email,
              password, or phone-number signup. Your identity is your Nostr
              public key.
            </li>
            <li>
              <strong>Public by design.</strong> Notes, reactions, profile
              details, and anything you publish on Nostr are public by
              protocol design and are copied to independent relays worldwide.
              They cannot be fully deleted once published.
            </li>
            <li>
              <strong>No ads, no trackers, no sale of data.</strong> We do not
              run third-party advertising SDKs, analytics trackers, or sell
              your data to anyone.
            </li>
          </ul>
        </Section>

        <Section title="3. Information we handle">
          <h3 className="text-sm font-semibold text-foreground">
            3.1 Stored only on your device
          </h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Nostr private key (nsec) — in platform secure storage</li>
            <li>Login sessions and signer preferences</li>
            <li>Theme, relay, and UI settings</li>
            <li>Cached content for offline reading and performance</li>
            <li>Drafts and local outbox for messages awaiting send</li>
          </ul>

          <h3 className="mt-4 text-sm font-semibold text-foreground">
            3.2 Published to Nostr relays (public)
          </h3>
          <p>
            When you post, react, repost, zap, update your profile, or send a
            message, that event is signed by your key and sent to the Nostr
            relays you choose. Relays are independent servers run by third
            parties around the world. Content you publish includes:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your public key (npub) — attached to everything you publish</li>
            <li>Text notes, articles, comments, and media descriptions</li>
            <li>Profile metadata you choose to share (name, avatar, about)</li>
            <li>Reactions, reposts, follows, lists, and bookmarks</li>
            <li>Lightning zap receipts when you send or receive zaps</li>
          </ul>

          <h3 className="mt-4 text-sm font-semibold text-foreground">
            3.3 Private messages (DMs)
          </h3>
          <p>
            Direct messages use NIP-04 or NIP-17 gift-wrapped encryption. Only
            you and the recipient hold the keys to read them. However, the
            fact that a message exists, its approximate size, and the public
            keys involved may be visible to the relays that carry it. We
            cannot read your DMs.
          </p>
        </Section>

        <Section title="4. Third-party services your device talks to">
          <p>
            To function, the app connects directly from your device to these
            categories of third-party services. Their own privacy policies
            apply to that traffic:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Nostr relays</strong> — carry your public events and
              encrypted DMs. Each relay is independently operated.
            </li>
            <li>
              <strong>Media / Blossom servers</strong> — host images, video,
              and audio you upload or view.
            </li>
            <li>
              <strong>Lightning wallets and LNURL services</strong> — process
              zaps and payments you initiate (e.g. WebLN, Nostr Wallet
              Connect).
            </li>
            <li>
              <strong>Cashu mints</strong> — issue and redeem ecash tokens if
              you use the wallet features.
            </li>
            <li>
              <strong>Link-preview and image proxies</strong> — fetch metadata
              for links you open.
            </li>
          </ul>
          <p className="mt-2">
            Your IP address and standard request metadata will be visible to
            whichever of these services you connect to, as with any internet
            traffic.
          </p>
        </Section>

        <Section title="5. What we do NOT do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>We do not run advertising SDKs or sell your data</li>
            <li>We do not use third-party analytics or behavioral tracking</li>
            <li>We do not store your private key on any server</li>
            <li>We do not require your real name, email, or phone number</li>
            <li>We do not read your encrypted direct messages</li>
          </ul>
        </Section>

        <Section title="6. Data retention and deletion">
          <p>
            <strong>On your device:</strong> you can clear the app's local
            data at any time by signing out and clearing app storage, which
            removes your key and cached content from that device.
          </p>
          <p>
            <strong>On Nostr relays:</strong> content you publish is copied
            across independent relays. NIP-09 deletion requests are honored by
            relays that support them, but we cannot guarantee that every relay
            or every copy will be removed. Treat anything you publish as
            permanent.
          </p>
        </Section>

        <Section title="7. Delete your account and data">
          <p>
            You can delete your account and associated data at any time.
            Because {APP_NAME} has no central account system — your identity
            is your Nostr key — deletion has two parts:
          </p>

          <h3 className="text-sm font-semibold text-foreground">
            7.1 Delete from the app (on-device data)
          </h3>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Open the app and go to <strong>Settings</strong></li>
            <li>Tap <strong>Sign out</strong> — this removes your keys, sessions, and cached content from the device</li>
            <li>Optionally, uninstall the app or clear its storage in your device settings to remove any remaining local files</li>
          </ol>
          <p>
            This deletes everything stored on your device: your private key
            (nsec), login sessions, drafts, cached feed data, wallet tokens,
            and app preferences.
          </p>

          <h3 className="mt-4 text-sm font-semibold text-foreground">
            7.2 Delete content published to Nostr relays
          </h3>
          <p>
            To remove content you have already published (notes, profile,
            reactions, etc.):
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>In the app, go to your profile or the specific post</li>
            <li>Use the <strong>Delete</strong> option on individual posts — this publishes a NIP-09 deletion request to relays</li>
            <li>To remove your entire profile, update it with empty fields or publish a deletion request for your metadata event</li>
          </ol>

          <h3 className="mt-4 text-sm font-semibold text-foreground">
            7.3 Request deletion by email
          </h3>
          <p>
            If you cannot access the app, email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Account%20deletion%20request`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{' '}
            with the subject <strong>"Account deletion request"</strong> from
            any address, including:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Your Nostr public key (npub) so we can identify your content</li>
            <li>A signed Nostr event (kind 5 deletion request) if possible, proving you control the key</li>
          </ul>
          <p>
            We will publish deletion requests to the relays we operate within
            7 days. Note that third-party relays are independent — we cannot
            force them to delete copies, and content others have quoted,
            reposted, or screenshotted cannot be recalled.
          </p>

          <h3 className="mt-4 text-sm font-semibold text-foreground">
            7.4 What is deleted and what is retained
          </h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Deleted:</strong> on-device keys, sessions, cache, drafts, and wallet tokens (immediately on sign-out)</li>
            <li><strong>Deletion requested:</strong> your published events on relays that honor NIP-09</li>
            <li><strong>May persist:</strong> copies on independent third-party relays, content other users have reposted or quoted, and encrypted DMs already delivered to recipients' devices</li>
          </ul>
        </Section>

        <Section title="8. Children's privacy">
          <p>
            The Service is not directed at children under 13, and we do not
            knowingly collect personal information from children. Because the
            Service requires no personal information to use, no such data is
            gathered.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            Your private key is stored in your platform's secure storage
            (Android Keystore / iOS Keychain / browser storage) and is never
            transmitted to us. All traffic to relays and wallets is encrypted
            in transit over TLS. No method of transmission or storage is 100%
            secure; please back up your nsec and keep it private.
          </p>
        </Section>

        <Section title="10. International users">
          <p>
            The Service is accessible worldwide. Nostr relays are operated
            globally by independent parties, so content you publish may be
            processed in any country where those relays operate.
          </p>
        </Section>

        <Section title="11. Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. The
            "Effective date" at the top will be revised when we do, and
            continued use of the Service after a change means you accept the
            updated policy.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about this policy or your data? Email{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </article>
    </Layout>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
