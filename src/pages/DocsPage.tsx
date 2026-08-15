import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Markdown } from '@/components/articles/Markdown';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useSeo } from '@/hooks/useSeo';
import { cn } from '@/lib/utils';
import {
  DOC_SECTIONS,
  docNeighbours,
  docsInSection,
  findDoc,
  searchDocs,
  type Doc,
} from '@/lib/userDocs';

/**
 * The manual.
 *
 * One page for the contents and one per article, both at real URLs, because a
 * help page that cannot be linked to is a help page nobody can be pointed at —
 * and half of what documentation is for is somebody answering a question with
 * a link.
 */
export function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = findDoc(slug);

  // A slug that matches nothing shows the contents rather than a 404: the
  // reader was trying to read the manual, and the manual is right here
  return doc ? <Article doc={doc} /> : <Contents />;
}

function Contents() {
  const [query, setQuery] = useState('');

  useSeo({
    title: 'Help',
    description:
      'How NostrFeed works: your keys, relays, the wallet, lightning addresses, zaps and verified names.',
  });

  const results = useMemo(() => searchDocs(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
          </div>
          <p className="text-muted-foreground">
            How this works, what things cost, and what to do when something
            looks wrong.
          </p>
        </header>

        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the help"
            className="pl-9"
            aria-label="Search the help"
          />
        </div>

        {searching ? (
          <section className="mt-6 space-y-2">
            {results.length ? (
              results.map((doc) => <DocLink key={doc.slug} doc={doc} />)
            ) : (
              <Card className="border-dashed">
                <CardContent className="px-6 py-10 text-center">
                  <p className="text-muted-foreground">
                    Nothing matches “{query.trim()}”.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>
        ) : (
          <div className="mt-8 space-y-8">
            {DOC_SECTIONS.map((section) => (
              <section key={section.id} className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </h2>
                  <p className="text-sm text-muted-foreground/80">
                    {section.blurb}
                  </p>
                </div>

                <div className="space-y-2">
                  {docsInSection(section.id).map((doc) => (
                    <DocLink key={doc.slug} doc={doc} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function DocLink({ doc }: { doc: Doc }) {
  return (
    <Link
      to={`/docs/${doc.slug}`}
      className="block rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
    >
      <p className="font-medium">{doc.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{doc.summary}</p>
    </Link>
  );
}

function Article({ doc }: { doc: Doc }) {
  const { previous, next } = docNeighbours(doc.slug);

  useSeo({ title: `${doc.title} · Help`, description: doc.summary });

  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <Link
          to="/docs"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All help
        </Link>

        <header className="mt-4 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="text-lg text-muted-foreground">{doc.summary}</p>
        </header>

        <article className="mt-8">
          <Markdown source={doc.body} />
        </article>

        {(previous || next) && (
          <nav className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2">
            <Neighbour doc={previous} direction="previous" />
            <Neighbour doc={next} direction="next" />
          </nav>
        )}
      </div>
    </Layout>
  );
}

function Neighbour({
  doc,
  direction,
}: {
  doc: Doc | null;
  direction: 'previous' | 'next';
}) {
  // Keeps the grid honest at either end, so "next" stays on the right when
  // there is nothing before it
  if (!doc) return <div className="hidden sm:block" />;

  const forward = direction === 'next';

  return (
    <Link
      to={`/docs/${doc.slug}`}
      className={cn(
        'group rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/50',
        forward && 'sm:col-start-2 sm:text-right'
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground',
          forward && 'sm:justify-end'
        )}
      >
        {!forward && <ArrowLeft className="h-3.5 w-3.5" />}
        {forward ? 'Next' : 'Previous'}
        {forward && <ArrowRight className="h-3.5 w-3.5" />}
      </span>
      <span className="mt-1 block font-medium">{doc.title}</span>
    </Link>
  );
}

export default DocsPage;
