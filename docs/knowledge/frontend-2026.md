# Frontend Technology Knowledge Base (2026)

**Created:** 2026-02-01
**Purpose:** Document current library versions, patterns, and breaking changes from 2024 training data

## Current Version Summary

| Library | Current Version | Breaking Changes Since 2024 |
|---------|-----------------|----------------------------|
| React | 19.2.x | New hooks, Actions, Activity component |
| Tailwind CSS | 4.x | CSS-first config, @theme directive |
| shadcn/ui | Latest (2026) | RTL support, new design systems |
| dnd-kit | Latest | Stable, recommended for complex DnD |
| Vite | 7.x | Native Tailwind plugin |
| cmdk | Latest | Stable, via shadcn Command |

---

## React 19.x

### Key Changes from React 18

1. **React Compiler (New)**: Built-in compiler handles optimizations automatically. Reduces need for `useMemo`, `useCallback`, and `memo`.

2. **Actions & Server Actions**: Replace traditional REST/GraphQL APIs for data mutations in framework contexts (Next.js, Remix).

3. **New Hooks**:
   - `useActionState` - Track async action states (pending, fulfilled, rejected)
   - `useOptimistic` - Enable optimistic UI updates
   - `useFormStatus` - Access form state without prop drilling
   - `use` - Read promises/context in render (experimental)

4. **Concurrent Rendering by Default**: React can interrupt/pause renders, improving UI responsiveness.

5. **Server Components Stable**: Full production support for server-side rendering without client JS.

6. **Document Metadata**: Native `<title>`, `<link>`, `<meta>` hoisting to `<head>`.

### React 19.2 Features (October 2025)

1. **`<Activity />` Component** - Control render states:
   ```jsx
   <Activity mode={isVisible ? 'visible' : 'hidden'}>
     <Page />
   </Activity>
   ```
   - `visible`: Normal rendering
   - `hidden`: Hides children, unmounts effects, defers updates
   - Use for pre-rendering, state preservation, background loading

2. **`useEffectEvent`** - Separate event logic from effect logic:
   ```jsx
   const onConnected = useEffectEvent(() => {
     showNotification('Connected!', theme);
   });

   useEffect(() => {
     connection.on('connected', () => onConnected());
   }, [roomId]); // Only reactive deps
   ```

3. **`cacheSignal`** - Server Components cleanup signal

4. **Performance Tracks** - Chrome DevTools integration for scheduler/component visualization

5. **Partial Pre-rendering** - Pre-render static shells, resume with dynamic content

### Deprecated Patterns to Avoid

- Excessive manual memoization (compiler handles this)
- Legacy Context API (use modern Context with hooks)
- Class components for new code
- `componentWillMount`, `componentWillUpdate`, `componentWillReceiveProps`

### Recommended Patterns

```jsx
// Use Actions for form handling
async function submitAction(formData) {
  'use server'
  await saveData(formData)
}

// Use useActionState for loading states
const [state, formAction, isPending] = useActionState(submitAction, initialState)

// Use useOptimistic for instant UI feedback
const [optimisticItems, addOptimisticItem] = useOptimistic(items)

// Use Activity for pre-rendering
<Activity mode={tab === 'settings' ? 'visible' : 'hidden'}>
  <SettingsPanel />
</Activity>
```

---

## Tailwind CSS v4.x

### Breaking Changes from v3

1. **CSS-First Configuration**: No more `tailwind.config.js` for most projects
2. **@theme directive** replaces JS config
3. **Automatic content detection** - No need to configure `content` paths
4. **No @tailwind directives** - Use `@import "tailwindcss"` instead
5. **Built-in imports** - No need for `postcss-import` or `autoprefixer`

### Configuration Approach

**Old (v3):**
```js
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: { primary: '#6366F1' }
    }
  }
}
```

**New (v4):**
```css
/* src/app.css */
@import "tailwindcss";

@theme {
  --color-primary: #6366F1;
  --font-sans: "Inter", sans-serif;
  --breakpoint-3xl: 1920px;
}
```

### Utility Renames

| v3 | v4 |
|----|-----|
| `shadow` | `shadow-sm` |
| `shadow-sm` | `shadow-xs` |
| `rounded` | `rounded-sm` |
| `rounded-sm` | `rounded-xs` |
| `outline-none` | `outline-hidden` |
| `bg-gradient-to-r` | `bg-linear-to-r` |
| `decoration-slice` | `box-decoration-slice` |

### New Features

- **3D Transforms**: `rotate-x-*`, `rotate-y-*`, `scale-z-*`, `translate-z-*`, `perspective-*`
- **Container Queries**: Built-in `@container`, `@min-*`, `@max-*`
- **Starting Style**: `starting:` variant for enter/exit animations
- **Not Variant**: `not-hover:`, `not-supports-*:`
- **New Utilities**: `inset-shadow-*`, `field-sizing`, `color-scheme`, `font-stretch`
- **Conic/Radial Gradients**: `bg-conic-*`, `bg-radial-*`

### Performance Improvements

- Full builds: ~3.78x faster
- Incremental builds: ~8.8x faster
- No new CSS incremental: ~182x faster (microseconds)

### Vite Integration (Recommended)

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* Custom theme variables */
}
```

---

## shadcn/ui (2026)

### Installation with Vite

```bash
# Create Vite project
pnpm create vite@latest my-app -- --template react-ts
cd my-app

# Add Tailwind
pnpm add tailwindcss @tailwindcss/vite

# Configure vite.config.ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

# Initialize shadcn
pnpm dlx shadcn@latest init

# Add components
pnpm dlx shadcn@latest add button dialog command
```

### Recent Changes (2025-2026)

1. **RTL Support** (Jan 2026): First-class right-to-left support
   - Automatic class transformation: `ml-4` → `ms-4`, `left-2` → `start-2`
   - Migrate existing: `pnpm dlx shadcn@latest migrate rtl`

2. **New Design Systems** (Dec 2025):
   - Vega (classic)
   - Nova (compact)
   - Maia (rounded)
   - Lyra (boxy)
   - Mira (dense)

3. **Base UI Documentation**: Alternative to Radix primitives

4. **Component Dependencies**: Components ship their own Tailwind keyframes, CLI auto-updates config

5. **Remote Components**: Install from URLs for private registries

### Command Component (cmdk)

The Command component wraps cmdk by pacocoursey:

```tsx
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command"

// Usage
<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Type a command..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem>Calendar</CommandItem>
      <CommandItem>Search</CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

---

## dnd-kit

### Why dnd-kit (Not react-dnd or react-beautiful-dnd)

1. **Modern React Hooks**: Built with `useDraggable`, `useDroppable`
2. **Performance**: Smooth 60fps animations
3. **Customizable**: Collision detection, activators, constraints
4. **Accessible**: Built-in keyboard/screen reader support
5. **Lightweight**: ~10kb minified, no external deps

### Basic Setup

```tsx
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

function SortableList({ items, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = items.indexOf(active.id);
      const newIndex = items.indexOf(over.id);
      onReorder(arrayMove(items, oldIndex, newIndex));
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map(id => <SortableItem key={id} id={id} />)}
      </SortableContext>
    </DndContext>
  );
}
```

### Best Practices

1. **Always add `touch-action: none`** to draggable elements for mobile
2. **Use `DragOverlay`** for smooth visual feedback during drag
3. **Implement keyboard sensors** for accessibility
4. **Consider collision detection algorithms** for complex layouts

### Limitations

- No desktop-to-browser drag (HTML5 DnD API limitation)
- No cross-window drag support
- For those use cases, use `react-dnd` with HTML5 backend

---

## Vite 7.x

### Tailwind Integration

Use the first-party Vite plugin (better performance than PostCSS):

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### Key Points

- Use `@tailwindcss/vite` plugin, NOT PostCSS for best performance
- No need for `tailwindcss.config.js` - use CSS `@theme` instead
- No need for `postcss.config.js` - Vite plugin handles everything
- Remove `autoprefixer` - handled automatically

---

## Migration Checklist

### From React 18 to React 19

- [ ] Update `react` and `react-dom` to ^19.x
- [ ] Update `@types/react` and `@types/react-dom`
- [ ] Remove unnecessary `useMemo`/`useCallback` (compiler handles this)
- [ ] Consider `useActionState` for form handling
- [ ] Consider `useOptimistic` for instant UI feedback
- [ ] Test concurrent rendering behavior

### From Tailwind v3 to v4

- [ ] Install `@tailwindcss/vite` plugin
- [ ] Remove `tailwindcss.config.js` (migrate to CSS @theme)
- [ ] Remove `postcss.config.js` if only using Tailwind
- [ ] Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`
- [ ] Update renamed utilities (shadow, rounded, etc.)
- [ ] Update gradient classes if using `bg-gradient-to-*`

### Adding shadcn/ui

- [ ] Initialize with `pnpm dlx shadcn@latest init`
- [ ] Configure path aliases in `tsconfig.json`
- [ ] Add components as needed with `pnpm dlx shadcn@latest add <component>`
- [ ] Consider RTL migration if needed

---

## Package.json Updates

**Note:** These changes should be applied in Issue #81 (shadcn/ui installation), not in this research spike. Making these changes requires coordinated updates to vite.config.ts and CSS files.

### Target Dependencies

```json
{
  "devDependencies": {
    "@types/node": "^22.x",
    "@types/react": "^19.x",
    "@types/react-dom": "^19.x",
    "@tailwindcss/vite": "^4.x",
    "@vitejs/plugin-react": "^5.x",
    "tailwindcss": "^4.x",
    "typescript": "^5.x",
    "vite": "^7.x"
  },
  "dependencies": {
    "react": "^19.x",
    "react-dom": "^19.x",
    "@dnd-kit/core": "^6.x",
    "@dnd-kit/sortable": "^8.x",
    "@dnd-kit/utilities": "^3.x"
  }
}
```

### Dependencies to Remove

```json
{
  "devDependencies": {
    "autoprefixer": "remove - handled by Tailwind v4",
    "postcss": "remove - not needed with @tailwindcss/vite"
  }
}
```

### Current vs Target Versions

| Package | Current | Target | Action |
|---------|---------|--------|--------|
| react | ^19.2.4 | ^19.2.x | Keep |
| react-dom | ^19.2.4 | ^19.2.x | Keep |
| @types/react | ^19.2.10 | ^19.x | Keep |
| @types/react-dom | ^19.2.3 | ^19.x | Keep |
| tailwindcss | ^3.4.17 | ^4.x | **Upgrade** |
| @tailwindcss/vite | N/A | ^4.x | **Add** |
| postcss | ^8.5.3 | - | **Remove** |
| autoprefixer | ^10.4.21 | - | **Remove** |
| vite | ^7.3.1 | ^7.x | Keep |
| @dnd-kit/core | N/A | ^6.x | **Add** |
| @dnd-kit/sortable | N/A | ^8.x | **Add** |
```

---

## Sources

### React 19
- [React 19.2 Release](https://react.dev/blog/2025/10/01/react-19-2)
- [React 19 Release](https://react.dev/blog/2024/12/05/react-19)
- [React Blog](https://react.dev/blog)

### Tailwind CSS v4
- [Tailwind CSS v4.0 Announcement](https://tailwindcss.com/blog/tailwindcss-v4)
- [Migration Guide](https://dev.to/ippatev/migration-guide-tailwind-css-v3-to-v4-f5h)
- [CSS-First Configuration](https://medium.com/better-dev-nextjs-react/tailwind-v4-migration-from-javascript-config-to-css-first-in-2025-ff3f59b215ca)

### shadcn/ui
- [shadcn/ui Installation](https://ui.shadcn.com/docs/installation)
- [shadcn/ui Vite Guide](https://ui.shadcn.com/docs/installation/vite)
- [shadcn/ui Changelog](https://ui.shadcn.com/docs/changelog)
- [Command Component](https://ui.shadcn.com/docs/components/command)

### dnd-kit
- [dnd-kit Documentation](https://docs.dndkit.com)
- [dnd-kit GitHub](https://github.com/clauderic/dnd-kit)
- [Top DnD Libraries 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)

### Vite
- [Vite + Tailwind Setup 2026](https://medium.com/@fasihuddin102/how-to-set-up-tailwindcss-in-a-react-vite-project-2025-edition-999e0541a493)
- [Tailwind CSS Vite Installation](https://tailwindcss.com/docs)
