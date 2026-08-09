# Professional UI Integration Guide

This document describes the new professional UI features integrated into NostrFeed, providing a comprehensive overview of theme presets, professional post display, and UI customization options.

## Quick Start

### Enabling Professional UI Mode

1. Navigate to **Settings → UI** tab
2. Toggle **Professional UI Mode** to enable enhanced post display
3. Refresh the page to see the changes applied

### Changing Theme Presets

1. On mobile: Go to **Settings → Menu → Appearance** and scroll to "Theme Preset"
2. On desktop: Look for theme preset options in the settings menu
3. Click on any preset card to apply it instantly:
   - **Default**: Clean and balanced design
   - **Professional**: Modern corporate aesthetic
   - **Minimal**: Distraction-free interface
   - **Dark Mode**: Eye-friendly dark theme

## Features

### 1. Professional UI Mode

When enabled in Settings → UI, the feed switches to an enhanced post display (PostProfessional) that includes:

- **Improved Visual Hierarchy**: Better spacing and sizing for post content
- **Professional Card Design**: Rounded corners, subtle shadows, and hover effects
- **Engagement Metrics**: Clear display of replies, reposts, and likes counts
- **Enhanced Action Buttons**: Better styled and positioned interaction buttons
- **Professional Timestamps**: Relative time display (e.g., "2 hours ago")

#### Toggling Professional UI

```typescript
// In components, detect if professional UI is enabled:
import { useProfessionalUI } from '@/hooks/useProfessionalUI';

function MyComponent() {
  const { enabled: useProfessional } = useProfessionalUI();
  
  return (
    <div>
      {useProfessional ? (
        <PostProfessional event={post} />
      ) : (
        <Post event={post} />
      )}
    </div>
  );
}
```

### 2. Theme Preset System

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

### 3. Typography and Spacing System

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

### PostProfessional

Enhanced post display component with professional styling.

**Location**: `src/components/PostProfessional.tsx`

**Features**:
- Professional card-based layout
- Author info with avatar and timestamp
- Engagement stats display (replies, reposts, likes)
- Professional action buttons with icons
- Hover animations and state management

**Usage**:
```typescript
import { PostProfessional } from '@/components/PostProfessional';
import type { NostrEvent } from '@nostrify/nostrify';

function MyComponent({ event }: { event: NostrEvent }) {
  return <PostProfessional event={event} />;
}
```

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

## Hooks

### useProfessionalUI

Hook to check and control professional UI mode.

```typescript
import { useProfessionalUI } from '@/hooks/useProfessionalUI';

function MyComponent() {
  const { enabled, setEnabled } = useProfessionalUI();
  
  // enabled: boolean - whether professional UI is active
  // setEnabled: (value: boolean) => void - toggle the mode
}
```

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

## Integration Details

### Feed Component Integration

The Feed component now conditionally renders PostProfessional based on the user's preference:

```typescript
// From src/components/Feed.tsx
import { useProfessionalUI } from '@/hooks/useProfessionalUI';

export function Feed() {
  const { enabled: useProfessional } = useProfessionalUI();
  
  // ...
  
  return (
    <div className="stagger-in space-y-3">
      {posts.map((post) => (
        <div key={post.id}>
          {useProfessional ? (
            <PostProfessional event={post} />
          ) : (
            <Post event={post} />
          )}
        </div>
      ))}
    </div>
  );
}
```

### Settings Page Integration

New UI tab in Settings page allows users to enable/disable professional mode:

```typescript
// From src/pages/SettingsPage.tsx
function UISettings() {
  const { enabled: professionalUI, setEnabled } = useProfessionalUI();
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Interface Enhancements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p>Professional UI Mode</p>
            <p className="text-xs text-muted-foreground">
              Enhanced post layout and visual components
            </p>
          </div>
          <Switch
            checked={professionalUI}
            onCheckedChange={setEnabled}
          />
        </div>
      </CardContent>
    </Card>
  );
}
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

## Testing

### Testing Professional UI Components

```typescript
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { PostProfessional } from '@/components/PostProfessional';

describe('PostProfessional', () => {
  it('renders professional post layout', () => {
    const mockEvent = {
      id: '123',
      kind: 1,
      pubkey: 'abc',
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'Test post',
      sig: 'sig123',
    };

    render(
      <TestApp>
        <PostProfessional event={mockEvent} />
      </TestApp>
    );

    expect(screen.getByText('Test post')).toBeInTheDocument();
  });
});
```

## Troubleshooting

### Professional UI not appearing

1. Check Settings → UI to ensure Professional UI Mode is toggled on
2. Clear browser cache and localStorage
3. Refresh the page
4. Check browser console for errors

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
- `src/hooks/useProfessionalUI.ts` - Professional UI mode hook
- `PROFESSIONAL_UI_INTEGRATION.md` - This guide

### Modified Files
- `src/components/Feed.tsx` - Added professional UI mode support
- `src/components/ProfessionalSearch.tsx` - Fixed icon imports
- `src/components/ThreadView.tsx` - Fixed icon imports
- `src/components/layout/AppHeader.tsx` - Added ThemePresetSwitcher
- `src/lib/theme.ts` - Merged professional presets with token system
- `src/lib/performance.ts` - Fixed TypeScript types
- `src/pages/SettingsPage.tsx` - Added UI preferences tab

### Deleted Files
- `src/lib/theme.test.ts` - Superseded by merged implementation

## References

- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [Shadcn/UI Components](https://ui.shadcn.com/)
- [WCAG Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Web Performance Best Practices](https://web.dev/performance/)
