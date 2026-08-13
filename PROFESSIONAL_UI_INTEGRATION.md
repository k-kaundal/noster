# Professional UI Integration Guide

> **Design direction:** the visual identity is now specified in
> [`docs/design.md`](docs/design.md) — *Premium Dark Social*. Where this
> document disagrees with it about colour, elevation, radius or styling, that
> one wins; this one is kept for the parts it still owns.

This document describes the UI features integrated into NostrFeed, providing an overview of theme presets, typography and spacing, and UI customization options.

> **Note:** the "Professional UI Mode" post layout was removed. The feed renders the standard `Post` component everywhere, so posts look and behave the same on Home, Explore, profiles and hashtag pages.

## Quick Start

### Changing Theme Presets

1. On mobile: Go to **Settings → Menu → Appearance** and scroll to "Theme Preset"
2. On desktop: Look for theme preset options in the settings menu
3. Click on any preset card to apply it instantly:
   - **Default**: Clean and balanced design
   - **Professional**: Modern corporate aesthetic
   - **Minimal**: Distraction-free interface
   - **Dark Mode**: Eye-friendly dark theme

## Features

### 1. Theme Preset System

The app now includes 4 professional theme presets that modify the color scheme and visual appearance:

#### Available Presets

| Preset | Primary Color | Accent Color | Best For |
|--------|---------------|--------------|----------|
| Default | Violet (262° 83% 58%) | Light Gray (220° 14% 96%) | Balanced, general use |
| Professional | Blue (217° 91% 60%) | Gray (220° 8.9% 46%) | Corporate, professional |
| Minimal | Black (240° 10% 4%) | Light Gray (220° 14% 96%) | Distraction-free, minimal |
| Dark Mode | Purple (263° 70% 60%) | Dark Gray (240° 8% 7%) | Eye-friendly nighttime use |

#### Implementation

Presets are stored in `src/lib/theme.ts`:

```typescript
export const THEME_PRESETS: Record<ThemePreset, ThemeConfig> = {
  default: { /* ... */ },
  professional: { /* ... */ },
  minimal: { /* ... */ },
  'dark-mode': { /* ... */ },
};
```

The preference is saved to localStorage as `theme:preset`.

### 2. Typography and Spacing System

Professional UI uses a consistent design language:

```typescript
// From src/lib/theme.ts
export const TYPOGRAPHY = {
  h1: 'text-4xl font-bold tracking-tight',
  h2: 'text-3xl font-bold tracking-tight',
  h3: 'text-2xl font-semibold',
  h4: 'text-xl font-semibold',
  body: 'text-base leading-relaxed',
  bodySmall: 'text-sm leading-relaxed',
  caption: 'text-xs uppercase tracking-wide',
  mono: 'font-mono text-sm',
};

export const SPACING = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
};
```

## Components

### ThreadView

Professional thread/conversation display component.

**Location**: `src/components/ThreadView.tsx`

**Features**:
- Main post highlight with left border accent
- Nested comment replies with connection lines
- Progressive indentation for reply depth
- Hover-reveal reply buttons
- Engagement metrics per comment

**Usage**:
```typescript
import { ThreadView } from '@/components/ThreadView';

function ConversationPage({ mainPost, replies }) {
  return (
    <ThreadView
      mainPost={mainPost}
      replies={replies}
      onReply={(commentId) => console.log('Reply to:', commentId)}
    />
  );
}
```

### ThemePresetSwitcher

Component for users to select between theme presets.

**Location**: `src/components/ThemePresetSwitcher.tsx`

**Features**:
- Visual preset cards with names and descriptions
- Current preset highlighting
- localStorage persistence
- CSS variable application

**Used in**: AppHeader settings menu (mobile)

## Performance Utilities

Professional UI includes performance optimization utilities in `src/lib/performance.ts`:

### Intersection Observer
```typescript
import { createIntersectionObserver } from '@/lib/performance';

const observer = createIntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // Load content
    }
  });
});
```

### Debounce & Throttle
```typescript
import { debounce, throttle } from '@/lib/performance';

const debouncedSearch = debounce((query) => {
  // expensive search operation
}, 300);

const throttledScroll = throttle(() => {
  // handle scroll
}, 1000);
```

### Caching with TTL
```typescript
import { CacheWithTTL } from '@/lib/performance';

const cache = new CacheWithTTL<Post[]>();
cache.set('posts', posts, 5 * 60 * 1000); // 5 minute TTL

const cached = cache.get('posts');
```

### Request Batching
```typescript
import { RequestBatcher } from '@/lib/performance';

const batcher = new RequestBatcher();
const result = await batcher.batch('key', async () => {
  return fetch('/api/data').then(r => r.json());
});
```

## Customization

### Creating Custom Theme Presets

To add a new theme preset, edit `src/lib/theme.ts`:

```typescript
export const THEME_PRESETS: Record<ThemePreset, ThemeConfig> = {
  // ... existing presets ...
  'custom': {
    name: 'Custom',
    preset: 'custom',
    primaryColor: '220 90% 55%',  // HSL format
    accentColor: '220 15% 90%',
    description: 'Your custom design',
  },
};
```

### Styling Professional Components

Professional components use Tailwind CSS and follow this pattern:

1. **Spacing**: Use SPACING constants from theme.ts
2. **Typography**: Use TYPOGRAPHY classes
3. **Shadows**: Use SHADOWS system for depth
4. **Borders**: Use BORDER_RADIUS for consistent rounding
5. **Transitions**: Use TRANSITIONS for smooth animations

Example:

```typescript
import { SHADOWS, BORDER_RADIUS, TRANSITIONS } from '@/lib/theme';

function CustomComponent() {
  return (
    <div
      className={`
        rounded-[${BORDER_RADIUS.lg}]
        shadow-[${SHADOWS.md}]
        transition-all ${TRANSITIONS.normal}
        hover:shadow-[${SHADOWS.lg}]
      `}
    >
      Content
    </div>
  );
}
```

## Best Practices

### 1. Accessibility

- Always provide text alternatives for icons
- Use semantic HTML structure
- Maintain color contrast ratios (WCAG AA minimum)
- Test keyboard navigation

### 2. Performance

- Use lazy loading for images
- Implement request batching for API calls
- Cache frequently accessed data with TTL
- Use debounce/throttle for expensive operations

### 3. User Experience

- Provide visual feedback for interactions
- Use consistent spacing and typography
- Implement smooth transitions
- Show loading states for async operations

### 4. Responsive Design

- Test on mobile, tablet, and desktop
- Use Tailwind breakpoints (sm, md, lg, xl)
- Ensure touch targets are at least 48x48px
- Adapt layouts for different screen sizes

## Troubleshooting

### Theme not applying

1. Verify theme preset is selected in Settings
2. Clear localStorage: `localStorage.clear()`
3. Reload the page
4. Check if `theme:preset` key exists in localStorage

### Performance issues

1. Disable professional UI mode temporarily
2. Check Network tab for slow API requests
3. Monitor browser DevTools Performance tab
4. Check for memory leaks in console

## Future Enhancements

Potential improvements for the professional UI system:

1. **Custom Theme Creator**: Allow users to create and save custom themes
2. **Theme Sharing**: Export/import theme configurations
3. **Font Selection**: Additional font choices beyond system defaults
4. **Layout Options**: Different post layout styles (grid, list, compact)
5. **Animation Preferences**: Respects `prefers-reduced-motion` setting
6. **Dark Mode Detection**: Auto-detect system theme preference

## Files Modified/Created

### New Files
- `src/components/ThemePresetSwitcher.tsx` - Theme preset selector
- `PROFESSIONAL_UI_INTEGRATION.md` - This guide

### Modified Files
- `src/components/Feed.tsx` - Renders the standard `Post` component for every note
- `src/components/ProfessionalSearch.tsx` - Fixed icon imports
- `src/components/ThreadView.tsx` - Fixed icon imports
- `src/components/layout/AppHeader.tsx` - Added ThemePresetSwitcher
- `src/lib/theme.ts` - Merged professional presets with token system
- `src/lib/performance.ts` - Fixed TypeScript types
- `src/pages/SettingsPage.tsx` - Added UI preferences tab

### Deleted Files
- `src/lib/theme.test.ts` - Superseded by merged implementation
- `src/components/PostProfessional.tsx` - Replaced by the standard `Post` component
- `src/hooks/useProfessionalUI.ts` - Toggle removed along with the alternate layout

## References

- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [Shadcn/UI Components](https://ui.shadcn.com/)
- [WCAG Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Web Performance Best Practices](https://web.dev/performance/)
