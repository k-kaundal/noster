import { useQuery } from '@tanstack/react-query';

export interface OGMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
}

/**
 * Fetch Open Graph metadata from a URL
 * Uses a public CORS proxy to avoid CORS restrictions
 */
function parseOGMetadata(html: string): OGMetadata {
  const metadata: OGMetadata = {};

  // Parse og:title
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (titleMatch) metadata.title = titleMatch[1];

  // Parse og:description
  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  if (descMatch) metadata.description = descMatch[1];

  // Parse og:image
  const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
  if (imageMatch) metadata.image = imageMatch[1];

  // Parse og:url
  const urlMatch = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/i);
  if (urlMatch) metadata.url = urlMatch[1];

  // Parse og:site_name
  const siteMatch = html.match(/<meta\s+property="og:site_name"\s+content="([^"]*)"/i);
  if (siteMatch) metadata.siteName = siteMatch[1];

  // Fallback to regular meta tags if OG tags not found
  if (!metadata.title) {
    const metaTitleMatch = html.match(/<meta\s+name="title"\s+content="([^"]*)"/i);
    if (metaTitleMatch) metadata.title = metaTitleMatch[1];

    const titleTagMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleTagMatch) metadata.title = titleTagMatch[1];
  }

  if (!metadata.description) {
    const metaDescMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (metaDescMatch) metadata.description = metaDescMatch[1];
  }

  return metadata;
}

/**
 * Hook to fetch OG metadata from a URL
 */
export function useOGMetadata(url: string | null | undefined) {
  return useQuery({
    queryKey: ['og-metadata', url],
    queryFn: async () => {
      if (!url) return null;

      try {
        // Try to extract domain from URL
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        // Use a CORS proxy to fetch the HTML
        // We'll try multiple proxies as fallback
        const proxies = [
          `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          `https://corsproxy.io/?${encodeURIComponent(url)}`,
        ];

        let html = '';
        let lastError: Error | null = null;

        for (const proxy of proxies) {
          try {
            const response = await fetch(proxy, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            });

            if (response.ok) {
              html = await response.text();
              break;
            }
          } catch (error) {
            lastError = error as Error;
            continue;
          }
        }

        if (!html) {
          throw lastError || new Error('Failed to fetch metadata');
        }

        const metadata = parseOGMetadata(html);
        return metadata;
      } catch (error) {
        console.error('Failed to fetch OG metadata:', error);
        return null;
      }
    },
    enabled: !!url,
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
  });
}

/**
 * Extract URL from post content
 */
export function extractUrlFromContent(content: string): string | null {
  const urlMatch = content.match(/https?:\/\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}
