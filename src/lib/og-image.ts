/**
 * Open Graph image generation for social media previews
 * Generates properly formatted 1200x630px images with branding
 */

export interface OGImageConfig {
  title: string;
  description?: string;
  type?: 'post' | 'profile' | 'event' | 'default';
  image?: string;
  author?: string;
  theme?: 'light' | 'dark';
}

/**
 * Generate OG image URL using external service or template
 * For production, use a service like:
 * - https://vercel.com/og
 * - https://www.capturethemin.com/
 * - https://og.altruistic.ai/
 */
export function generateOGImage(config: OGImageConfig): string {
  const { title, description, type = 'default', author, theme = 'light' } = config;

  // URL encode parameters
  const params = new URLSearchParams({
    title,
    ...(description && { description }),
    ...(author && { author }),
    type,
    theme,
  });

  // Use Vercel OG template as example
  // Replace with your own OG service endpoint
  return `https://og.nostrfeed.com/api/generate?${params.toString()}`;
}

/**
 * SVG-based OG image for fallback or direct generation
 */
export function generateOGImageSVG(config: OGImageConfig): string {
  const {
    title,
    description,
    type = 'default',
    author,
    theme = 'light',
  } = config;

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0A0E27' : '#FFFFFF';
  const textColor = isDark ? '#FFFFFF' : '#000000';
  const accentColor = '#1D88E5';
  const goldColor = '#FFD700';

  // SVG template
  const svg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="1200" height="630" fill="${bgColor}"/>

  <!-- Gradient accent -->
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${accentColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${goldColor};stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Top accent bar -->
  <rect width="1200" height="8" fill="url(#grad)"/>

  <!-- Logo/Icon area -->
  <circle cx="120" cy="120" r="80" fill="${accentColor}" opacity="0.1"/>
  <text x="120" y="130" font-size="48" font-weight="bold" text-anchor="middle" fill="${accentColor}">⚡</text>

  <!-- Title -->
  <text
    x="250"
    y="80"
    font-size="72"
    font-weight="bold"
    fill="${textColor}"
    font-family="Arial, sans-serif"
    text-anchor="start"
  >
    ${escapeXml(truncate(title, 40))}
  </text>

  <!-- Description (if provided) -->
  ${
    description
      ? `<text
    x="250"
    y="170"
    font-size="32"
    fill="${isDark ? '#D1D5DB' : '#6B7280'}"
    font-family="Arial, sans-serif"
    text-anchor="start"
  >
    ${escapeXml(truncate(description, 80))}
  </text>`
      : ''
  }

  <!-- Author (if provided) -->
  ${
    author
      ? `<text
    x="250"
    y="540"
    font-size="24"
    fill="${isDark ? '#9CA3AF' : '#6B7280'}"
    font-family="Arial, sans-serif"
    text-anchor="start"
  >
    by ${escapeXml(author)}
  </text>`
      : ''
  }

  <!-- NostrFeed branding -->
  <text
    x="1150"
    y="590"
    font-size="20"
    fill="${isDark ? '#9CA3AF' : '#6B7280'}"
    font-family="Arial, sans-serif"
    text-anchor="end"
  >
    NostrFeed
  </text>

  <!-- Type badge -->
  <rect x="250" y="550" width="120" height="40" fill="${accentColor}" opacity="0.2" rx="8"/>
  <text
    x="310"
    y="577"
    font-size="16"
    fill="${accentColor}"
    font-family="Arial, sans-serif"
    text-anchor="middle"
    font-weight="600"
  >
    ${type.toUpperCase()}
  </text>
</svg>
  `;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Generate meta tags for social media
 */
export function generateOGMetaTags(config: OGImageConfig): Record<string, string> {
  const { title, description, type, author } = config;

  return {
    'og:title': title,
    'og:description': description || 'Decentralized social network powered by Nostr',
    'og:type': 'website',
    'og:image': generateOGImage(config),
    'og:image:width': '1200',
    'og:image:height': '630',
    'og:site_name': 'NostrFeed',
    'twitter:card': 'summary_large_image',
    'twitter:title': title,
    'twitter:description': description || 'NostrFeed - Decentralized Social Network',
    'twitter:image': generateOGImage(config),
    ...(author && { 'twitter:creator': author }),
  };
}

/**
 * Utility functions
 */
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Meta tag injection helper
 */
export function injectOGMetaTags(config: OGImageConfig): void {
  if (typeof document === 'undefined') return;

  const tags = generateOGMetaTags(config);
  const head = document.head;

  // Remove existing og tags
  const existingTags = head.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]');
  existingTags.forEach((tag) => tag.remove());

  // Add new tags
  Object.entries(tags).forEach(([key, value]) => {
    const meta = document.createElement('meta');
    const isProperty = key.startsWith('og:');
    if (isProperty) {
      meta.setAttribute('property', key);
    } else {
      meta.setAttribute('name', key);
    }
    meta.content = value;
    head.appendChild(meta);
  });
}
