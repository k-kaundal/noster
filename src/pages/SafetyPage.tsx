import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useSeo } from '@/hooks/useSeo';

const EFFECTIVE_DATE = 'October 21, 2026';
const CONTACT_EMAIL = 'kk@kaundal.vip';
const APP_NAME = 'Nostr Feed';

/**
 * Child Safety Standards.
 *
 * Externally published standards against child sexual abuse and exploitation
 * (CSAE) — required by Google Play for all apps in the Social category, and
 * linked from the Play Console "Child safety standards" section.
 */
export default function SafetyPage() {
  useSeo({
    title: 'Child Safety Standards',
    description:
      'Nostr Feed standards against child sexual abuse and exploitation (CSAE): zero-tolerance policy, reporting, moderation, and how we cooperate with authorities.',
  });

  return (
    <Layout>
      <article className="mx-auto max-w-2xl space-y-8 px-1 py-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Child Safety Standards
          </h1>
          <p className="text-sm text-muted-foreground">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </header>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} is committed to keeping children safe. This page
          describes our standards against child sexual abuse and exploitation
          (CSAE), how users can report concerns, and how we respond. It is
          published publicly as required by Google Play's child safety
          standards policy.
        </p>

        <Section title="1. Zero-tolerance policy">
          <p>
            {APP_NAME} has a strict zero-tolerance policy toward child sexual
            abuse and exploitation. Any content that depicts, promotes, or
            facilitates the sexual abuse or exploitation of minors is
            prohibited. This includes, without limitation:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Child sexual abuse material (CSAM) of any kind</li>
            <li>Sexualization of minors, including fictional or AI-generated content</li>
            <li>Grooming or any attempt by an adult to contact a minor for sexual purposes</li>
            <li>Sextortion, trafficking, or any exploitation of minors</li>
            <li>Links to, or solicitation of, any of the above</li>
          </ul>
          <p>
            Accounts found sharing or seeking such content are blocked within
            the app, and content is reported to the relevant authorities as
            described below.
          </p>
        </Section>

        <Section title="2. How the app works (important context)">
          <p>
            {APP_NAME} is a client for the open Nostr protocol. Content is
            published by users to independent, third-party relays around the
            world — there is no central server we operate that stores all
            user content. We nonetheless take child safety seriously through:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Client-side blocking of reported accounts and content</li>
            <li>Support for NIP-56 report events, which propagate moderation signals to relays and other clients</li>
            <li>Keyword and media-hash screening on content surfaced through our default relays where technically possible</li>
            <li>Rapid response to reports sent to our safety contact</li>
          </ul>
        </Section>

        <Section title="3. How to report child safety concerns">
          <p>
            <strong>In the app:</strong> you can report any post or profile
            directly. Open the post or profile, tap the options menu, and
            choose <strong>Report</strong>, then select the child-safety
            reason. Reports publish a NIP-56 report event that relays and
            other clients can act on, and flag the content for our review.
          </p>
          <p>
            <strong>By email:</strong> report child safety concerns to our
            designated safety contact at{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Child%20safety%20report`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{' '}
            with the subject <strong>"Child safety report"</strong>. Include
            the public key (npub) or event ID involved and any relay where
            you saw the content.
          </p>
          <p>
            <strong>If a child is in immediate danger,</strong> contact your
            local emergency services first. You can also report directly to
            the authorities listed in section 5.
          </p>
        </Section>

        <Section title="4. What we do when we receive a report">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Review the report promptly and block the reported account and content within the {APP_NAME} client</li>
            <li>Forward the report to the relays carrying the content, requesting removal under their own policies</li>
            <li>Where required by law, report CSAM to the appropriate regional and national authorities (see section 5)</li>
            <li>Preserve evidence as required for lawful investigations</li>
          </ul>
        </Section>

        <Section title="5. Reporting to authorities">
          <p>
            {APP_NAME} complies with all applicable child safety laws and
            cooperates with law enforcement. Depending on jurisdiction, child
            sexual abuse material is reported to:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>NCMEC</strong> — the U.S. National Center for Missing &amp;
              Exploited Children (CyberTipline, CyberTipline.org)
            </li>
            <li>
              <strong>India</strong> — the national cybercrime reporting portal
              (cybercrime.gov.in) and the CWC / local police under the POCSO Act
            </li>
            <li>
              <strong>IWF</strong> — the Internet Watch Foundation (iwf.org.uk)
              for international hash-matching and takedown
            </li>
            <li>Other regional and national authorities as required by law</li>
          </ul>
        </Section>

        <Section title="6. Age requirements">
          <p>
            {APP_NAME} is intended for users aged 18 and over. The Service is
            not directed at children under 13, and we do not knowingly provide
            the Service to them. If we learn that a user is under the minimum
            age, we will block their access within the app.
          </p>
        </Section>

        <Section title="7. Designated child safety contact">
          <p>
            Our designated point of contact for child sexual abuse material
            (CSAM) prevention practices and compliance is:
          </p>
          <p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
          <p>
            This contact is ready and able to speak about {APP_NAME}'s CSAM
            prevention practices and compliance with Google Play and the
            relevant authorities.
          </p>
        </Section>

        <Section title="8. Changes to these standards">
          <p>
            We may update these standards from time to time. The effective
            date above will be revised when we do.
          </p>
        </Section>

        <p className="text-sm text-muted-foreground">
          See also the{' '}
          <Link
            to="/privacy"
            className="text-primary underline-offset-4 hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </p>
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
