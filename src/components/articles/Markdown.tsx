import { Fragment, useMemo } from 'react';
import { isSafeHref, parseInline, parseMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * Renders an article body.
 *
 * Every element here is constructed by React from parsed values — nothing the
 * author wrote is ever handed to the browser as markup. An article is the one
 * place in this app where someone types a long document intended to be
 * formatted, which is exactly where an HTML-string renderer becomes a script
 * injection waiting for the wrong sanitiser setting.
 */
export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  return (
    <div className={cn('space-y-4 text-[17px] leading-relaxed', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[block.level - 1];
            const size = [
              'text-2xl font-semibold tracking-tight',
              'text-xl font-semibold tracking-tight',
              'text-lg font-semibold',
              'text-base font-semibold',
            ][block.level - 1];

            return (
              <Tag key={index} className={cn('mt-8 first:mt-0', size)}>
                <InlineText text={block.text} />
              </Tag>
            );
          }

          case 'paragraph':
            return (
              <p key={index}>
                <InlineText text={block.text} />
              </p>
            );

          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={index}
                className={cn(
                  'space-y-1.5 pl-6',
                  block.ordered ? 'list-decimal' : 'list-disc'
                )}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineText text={item} />
                  </li>
                ))}
              </Tag>
            );
          }

          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground"
              >
                <InlineText text={block.text} />
              </blockquote>
            );

          case 'code':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg border bg-muted/50 p-4 text-sm"
              >
                <code>{block.text}</code>
              </pre>
            );

          case 'image':
            return isSafeHref(block.url) ? (
              <figure key={index} className="space-y-2">
                <img
                  src={block.url}
                  alt={block.alt}
                  loading="lazy"
                  className="w-full rounded-xl border"
                />
                {block.alt && (
                  <figcaption className="text-center text-sm text-muted-foreground">
                    {block.alt}
                  </figcaption>
                )}
              </figure>
            ) : null;

          case 'rule':
            return <hr key={index} className="border-border" />;

          default:
            return null;
        }
      })}
    </div>
  );
}

/** One line of prose, with emphasis and links. */
function InlineText({ text }: { text: string }) {
  const parts = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case 'bold':
            return <strong key={index}>{part.text}</strong>;
          case 'italic':
            return <em key={index}>{part.text}</em>;
          case 'code':
            return (
              <code
                key={index}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]"
              >
                {part.text}
              </code>
            );
          case 'link':
            // An unsafe scheme is shown as the text it claimed to be, so the
            // reader sees what was written without it being clickable
            return isSafeHref(part.href) ? (
              <a
                key={index}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                {part.text}
              </a>
            ) : (
              <Fragment key={index}>{part.text}</Fragment>
            );
          default:
            return <Fragment key={index}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}
