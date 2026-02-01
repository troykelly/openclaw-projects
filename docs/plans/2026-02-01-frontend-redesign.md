# Frontend Redesign: Human-Agent Collaboration Workspace

**Date:** 2026-02-01
**Status:** Design
**Epic:** Frontend redesign for modern UX

## Overview

A complete UI rebuild transforming the project system from a basic task tracker into a human-agent collaboration workspace. Primary users are AI agents (via CLI/API), while the UI serves humans who oversee agent activity and manage their own work.

### Design Principles

1. **Agent-first, human-friendly** - Agents do the heavy lifting; UI shows humans what's happening
2. **Progressive disclosure** - Simple surface, depth when needed
3. **No PM jargon** - Avoid "kanban", "sprint", "velocity" - use plain language
4. **Keyboard-first** - Command palette (⌘K) for power users
5. **Visual clarity** - Linear/Notion cleanliness + Raycast modern aesthetic

### Tech Stack

- **React 19** (existing)
- **shadcn/ui** - Component library foundation
- **Tailwind CSS** (existing)
- **dnd-kit** - Drag-drop for boards and hierarchy
- **cmdk** - Command palette (via shadcn)
- **Custom SVG** - Timeline/Gantt visualization

---

## Information Architecture

### Data Model Hierarchy

```
Project
├── Initiative
│   ├── Epic
│   │   ├── Issue
│   │   │   └── TODO (checklist items)
│   │   └── Issue
│   └── Epic
├── Memory Items (attachable at any level)
├── Contacts (attachable at any level)
├── Emails (attachable at any level)
└── Calendar Events (attachable at any level)
```

### Global Navigation

Sidebar + main content layout with 5 primary sections:

| Section | Icon | Purpose |
|---------|------|---------|
| Activity | Bell | Live feed of agent and human actions |
| Projects | Folder | Hierarchy browser |
| Timeline | Calendar | Schedule view with dependencies |
| People | Users | Contacts directory |
| ⌘K | Search | Command palette (always available) |

Mobile: Bottom tab bar with same 5 sections.

---

## View Specifications

### 1. Activity Feed (Priority 1)

**Purpose:** "What's happening right now?" - the human oversight dashboard.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ Activity                           [Filter ▾]   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ 🤖 Agent-47 created issue "Fix auth bug"   │ │
│ │    in Project Alpha → Epic: Security       │ │
│ │    2 minutes ago                           │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🤖 Agent-12 completed "Add unit tests"     │ │
│ │    Moved to Done • took 45 min             │ │
│ │    8 minutes ago                           │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 👤 You added a note to "API redesign"      │ │
│ │    "Consider rate limiting..."             │ │
│ │    1 hour ago                              │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Features:**
- Real-time updates via WebSocket/SSE
- Filter by: agent, project, action type, time range
- Click any item to jump to that entity
- Unread indicator on sidebar icon
- Group by time period (Today, Yesterday, This week)

**Components needed:**
- `ActivityCard` - Individual activity item
- `ActivityFeed` - Scrollable list with real-time updates
- `ActivityFilter` - Dropdown filter controls

---

### 2. Project Overview / Hierarchy Browser (Priority 2)

**Purpose:** Navigate and manage the full project hierarchy.

**Layout - List Mode:**
```
┌─────────────────────────────────────────────────┐
│ Projects                    [+ New] [View ▾]    │
├─────────────────────────────────────────────────┤
│ ▼ Project Alpha                    [12 items]   │
│   ▼ Initiative: Q1 Launch          [8 items]    │
│     ▶ Epic: User Auth              [3 issues]   │
│     ▼ Epic: Dashboard              [5 issues]   │
│       ○ Issue: Add charts          In Progress  │
│       ○ Issue: Fix mobile layout   Open         │
│       ○ Issue: Accessibility audit Open         │
│   ▶ Initiative: Infrastructure     [4 items]    │
│ ▶ Project Beta                     [6 items]    │
└─────────────────────────────────────────────────┘
```

**Layout - Board Mode (for Issues within an Epic):**
```
┌─────────────────────────────────────────────────┐
│ Epic: Dashboard                    [List] [Board]│
├───────────────┬───────────────┬─────────────────┤
│ Open (3)      │ In Progress(2)│ Done (5)        │
├───────────────┼───────────────┼─────────────────┤
│ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐   │
│ │ Add charts│ │ │ Fix mobile│ │ │ Setup CI  │   │
│ │ P1 • 2h   │ │ │ P2 • 1h   │ │ │ ✓ 45m     │   │
│ └───────────┘ │ └───────────┘ │ └───────────┘   │
│ ┌───────────┐ │               │ ┌───────────┐   │
│ │ A11y audit│ │               │ │ Add tests │   │
│ │ P1 • 3h   │ │               │ │ ✓ 2h      │   │
│ └───────────┘ │               │ └───────────┘   │
└───────────────┴───────────────┴─────────────────┘
```

**Features:**
- Collapsible tree navigation
- Drag-drop to reorder or reparent items
- Inline status badges (color-coded)
- Quick actions on hover (edit, delete, add child)
- Switch between List and Board views at Epic level
- Breadcrumb navigation when drilling down

**Components needed:**
- `ProjectTree` - Collapsible hierarchy
- `ProjectCard` / `IssueCard` - Item representation
- `BoardView` - Kanban-style columns
- `Breadcrumb` - Navigation path

---

### 3. Timeline View (Priority 3)

**Purpose:** Visualize schedules, dependencies, and deadlines.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Timeline                    [Zoom: Month ▾] [Filter ▾]  │
├────────┬────────────────────────────────────────────────┤
│        │ Jan        Feb        Mar        Apr           │
├────────┼────────────────────────────────────────────────┤
│Project │ ████████████████████████████████               │
│Alpha   │                                                │
├────────┼────────────────────────────────────────────────┤
│ Q1     │   ██████████████████████                       │
│ Launch │                                                │
├────────┼────────────────────────────────────────────────┤
│ User   │   ████████──────→                              │
│ Auth   │            ████████                            │
│        │            Dashboard (depends on Auth)         │
├────────┼────────────────────────────────────────────────┤
│ Infra  │                    ████████████                │
└────────┴────────────────────────────────────────────────┘
```

**Features:**
- Zoom levels: Day, Week, Month, Quarter
- Dependency arrows between items
- Critical path highlighting
- Drag to adjust dates
- Click to open item detail
- Today marker line
- Overdue items highlighted in red

**Components needed:**
- `TimelineChart` - SVG-based Gantt (extend existing)
- `TimelineRow` - Individual item bar
- `DependencyArrow` - SVG connector
- `TimelineControls` - Zoom, filter, date navigation

---

### 4. People / Contacts (Priority 4)

**Purpose:** Directory of contacts linked to work items.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ People                              [+ Add]     │
├─────────────────────────────────────────────────┤
│ Search contacts...                              │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ 👤 Jane Smith                               │ │
│ │    jane@acme.com • Product Lead             │ │
│ │    Linked to: Project Alpha, 3 issues       │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 👤 Bob Chen                                 │ │
│ │    bob@partner.io • External                │ │
│ │    Linked to: Initiative: Q1 Launch         │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Contact Detail Sheet (slide-out):**
```
┌─────────────────────────────────────────────────┐
│ ← Jane Smith                          [Edit]    │
├─────────────────────────────────────────────────┤
│ Email: jane@acme.com                            │
│ Role: Product Lead                              │
│ Company: Acme Corp                              │
├─────────────────────────────────────────────────┤
│ Linked Items                                    │
│ • Project Alpha (Owner)                         │
│ • Epic: User Auth (Stakeholder)                 │
│ • Issue: Add SSO (Requester)                    │
├─────────────────────────────────────────────────┤
│ Communications                                  │
│ • Email: "Re: SSO requirements" - Jan 15        │
│ • Email: "Q1 timeline" - Jan 10                 │
├─────────────────────────────────────────────────┤
│ Calendar                                        │
│ • Meeting: "Alpha kickoff" - Jan 20, 2pm        │
└─────────────────────────────────────────────────┘
```

**Features:**
- Search/filter contacts
- See all linked work items per contact
- View communication history (emails)
- View calendar events
- Add/edit contact details
- Link contact to any work item

**Components needed:**
- `ContactCard` - Summary view
- `ContactSheet` - Detail slide-out panel
- `ContactForm` - Add/edit
- `LinkedItemsList` - Work items per contact

---

### 5. Command Palette (Priority 5)

**Purpose:** Fast keyboard-driven navigation and actions.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ 🔍 Type a command or search...                  │
├─────────────────────────────────────────────────┤
│ Recent                                          │
│   ↩ Project Alpha                               │
│   ↩ Issue: Add charts                           │
├─────────────────────────────────────────────────┤
│ Actions                                         │
│   + Create new issue                            │
│   + Create new project                          │
│   📋 Go to Activity                             │
│   📅 Go to Timeline                             │
├─────────────────────────────────────────────────┤
│ Search results for "auth"                       │
│   📁 Epic: User Auth                            │
│   📄 Issue: Add SSO support                     │
│   👤 Contact: Auth0 Support                     │
└─────────────────────────────────────────────────┘
```

**Features:**
- ⌘K (Mac) / Ctrl+K (Windows) to open
- Fuzzy search across all entities
- Recent items for quick access
- Actions: create, navigate, change status
- Keyboard navigation (arrows + enter)
- Type filtering: `@contact`, `#project`, `!issue`

**Components needed:**
- `CommandPalette` - Main dialog (shadcn Command)
- `CommandGroup` - Section grouping
- `CommandItem` - Individual result/action

---

### 6. Item Detail View (Shared)

All work items (Project, Initiative, Epic, Issue) share a consistent detail view pattern:

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ ← Back to Epic: Dashboard                       │
├─────────────────────────────────────────────────┤
│ Issue                                           │
│ # Add interactive charts                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ Status: In Progress ▾ │ Priority: P1 ▾     │ │
│ │ Estimate: 2h          │ Actual: 1h 30m     │ │
│ │ Due: Feb 15           │ Assignee: Agent-47 │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Description                            [Edit]   │
│ Implement Chart.js integration for the          │
│ dashboard metrics. Should support line,         │
│ bar, and pie charts.                            │
├─────────────────────────────────────────────────┤
│ ☐ TODOs                                [+ Add]  │
│ ☑ Research Chart.js vs Recharts                 │
│ ☐ Create chart wrapper component                │
│ ☐ Add to dashboard page                         │
├─────────────────────────────────────────────────┤
│ 📎 Attachments                         [+ Add]  │
│ [Memory] "Chart requirements from stakeholder"  │
│ [Email] "Re: Dashboard metrics" - Jan 12        │
│ [Contact] Jane Smith (Requester)                │
├─────────────────────────────────────────────────┤
│ Dependencies                           [+ Add]  │
│ ⬅ Blocked by: Issue: Setup data pipeline       │
│ ➡ Blocks: Issue: Dashboard polish              │
├─────────────────────────────────────────────────┤
│ Activity                                        │
│ Agent-47 changed status to In Progress - 2h ago │
│ You created this issue - Jan 10                 │
└─────────────────────────────────────────────────┘
```

**Features:**
- Consistent layout across all item types
- Inline editing for fields
- TODO checklist with completion tracking
- Attachments section (memory, emails, contacts, calendar)
- Dependency visualization
- Activity log specific to this item

---

## Visual Design System

### Color Palette

**Light mode:**
- Background: `#FAFAFA` (warm gray)
- Surface: `#FFFFFF`
- Border: `#E5E5E5`
- Text primary: `#171717`
- Text secondary: `#737373`
- Accent: `#6366F1` (indigo - approachable, not corporate blue)
- Success: `#22C55E`
- Warning: `#F59E0B`
- Error: `#EF4444`

**Dark mode:**
- Background: `#0A0A0A`
- Surface: `#171717`
- Border: `#262626`
- Text primary: `#FAFAFA`
- Text secondary: `#A3A3A3`
- Accent: `#818CF8` (lighter indigo)

### Typography

- Font: `Inter` (clean, readable, widely supported)
- Headings: Semibold, tight letter-spacing
- Body: Regular, relaxed line-height
- Monospace (for IDs, code): `JetBrains Mono`

### Spacing Scale

Using Tailwind's default scale with 4px base:
- `space-1`: 4px
- `space-2`: 8px
- `space-3`: 12px
- `space-4`: 16px
- `space-6`: 24px
- `space-8`: 32px

### Component Styling

**Cards:**
- Subtle shadow (`shadow-sm`)
- Rounded corners (`rounded-lg`)
- Hover: Slight lift + shadow increase
- Border on light mode, no border on dark

**Buttons:**
- Primary: Solid accent color, white text
- Secondary: Ghost/outline style
- All: Rounded (`rounded-md`), subtle hover transition

**Status badges:**
- Open: Gray
- In Progress: Blue
- Blocked: Red
- Done: Green
- Muted background with matching text color

---

## Implementation Plan

### Phase 1: Foundation (Issues #80-83)

1. **#80 - Install and configure shadcn/ui**
   - Add shadcn/ui to project
   - Configure theme (colors, typography)
   - Set up dark mode toggle
   - Add Inter + JetBrains Mono fonts

2. **#81 - Create layout shell**
   - Sidebar component with 5 sections
   - Main content area with header
   - Mobile responsive (bottom tabs)
   - Breadcrumb component

3. **#82 - Command palette**
   - Integrate shadcn Command component
   - Search across all entity types
   - Recent items
   - Navigation actions

4. **#83 - Migrate auth pages**
   - Rebuild login page with new design system
   - Session management UI

### Phase 2: Activity Feed (Issue #84)

5. **#84 - Activity feed view**
   - ActivityCard component
   - Real-time updates (SSE/WebSocket)
   - Filtering and grouping
   - Unread indicators

### Phase 3: Project Hierarchy (Issues #85-87)

6. **#85 - Project tree component**
   - Collapsible hierarchy
   - Drag-drop reordering (dnd-kit)
   - Inline actions

7. **#86 - Item detail view**
   - Shared detail layout
   - TODO checklist
   - Attachments section
   - Activity log per item

8. **#87 - Board view for issues**
   - Kanban columns (drag-drop)
   - Status transitions
   - Swimlane grouping options

### Phase 4: Timeline (Issue #88)

9. **#88 - Timeline/Gantt view**
   - Enhance existing SVG implementation
   - Zoom controls
   - Drag to adjust dates
   - Critical path highlighting

### Phase 5: People & Attachments (Issues #89-91)

10. **#89 - Contacts directory**
    - Contact list and search
    - Contact detail sheet
    - Link contacts to work items

11. **#90 - Memory items**
    - Create/edit memory notes
    - Attach to any work item level
    - Search memory items

12. **#91 - Email & calendar integration**
    - Display linked emails
    - Display linked calendar events
    - UI for linking (actual integration is separate)

### Phase 6: Polish (Issue #92)

13. **#92 - Final polish**
    - Animations and transitions
    - Loading states
    - Error states
    - Empty states
    - Accessibility audit

---

## API Requirements

The frontend will need these API endpoints (some exist, some need creation):

**Existing (may need extension):**
- `GET /api/work-items` - List all items
- `GET /api/work-items/:id` - Item detail
- `POST /api/work-items` - Create item
- `PUT /api/work-items/:id` - Update item
- `GET /api/work-items/:id/timeline` - Timeline data
- `GET /api/work-items/:id/dependency-graph` - Graph data
- `GET /api/backlog` - Filtered list
- `PATCH /api/work-items/:id/status` - Status update

**New endpoints needed:**
- `GET /api/activity` - Activity feed with pagination
- `GET /api/activity/stream` - SSE endpoint for real-time
- `GET /api/contacts` - List contacts
- `GET /api/contacts/:id` - Contact detail
- `POST /api/contacts` - Create contact
- `PUT /api/contacts/:id` - Update contact
- `POST /api/work-items/:id/contacts` - Link contact
- `GET /api/memory` - List memory items
- `POST /api/memory` - Create memory item
- `POST /api/work-items/:id/memory` - Link memory
- `GET /api/work-items/:id/emails` - Linked emails
- `GET /api/work-items/:id/calendar` - Linked events

---

## Success Criteria

1. **Usability:** Non-technical users can navigate and understand the system without training
2. **Performance:** Page loads < 1s, interactions < 100ms
3. **Accessibility:** WCAG 2.1 AA compliance
4. **Responsiveness:** Fully functional on mobile devices
5. **Agent visibility:** Humans can see real-time agent activity clearly
6. **Keyboard efficiency:** All actions accessible via ⌘K palette

---

## Out of Scope (Future)

- Notifications (push, email digests)
- User preferences/settings
- Multi-user collaboration features
- Reporting/analytics dashboards
- API for email/calendar sync (this design assumes display only)

---

## Research Findings (Issue #94)

**Completed:** 2026-02-01

See full details in [`docs/knowledge/frontend-2026.md`](../knowledge/frontend-2026.md)

### Key Version Updates Required

| Library | package.json | Target | Notes |
|---------|-------------|--------|-------|
| React | ^19.2.4 | ^19.2.x | Already current |
| react-dom | ^19.2.4 | ^19.2.x | Already current |
| @types/react | ^19.2.10 | ^19.x | Already current |
| tailwindcss | ^3.4.17 | ^4.x | **Major upgrade needed** |
| vite | ^7.3.1 | ^7.x | Already current |
| postcss | ^8.5.3 | Remove | Not needed with Tailwind v4 |
| autoprefixer | ^10.4.21 | Remove | Not needed with Tailwind v4 |

### Breaking Changes to Address

1. **Tailwind CSS v3 → v4**
   - Replace `tailwind.config.ts` with CSS `@theme` directive
   - Use `@tailwindcss/vite` plugin instead of PostCSS
   - Update utility names (shadow, rounded, etc.)
   - Replace `@tailwind` directives with `@import "tailwindcss"`

2. **New Dependencies to Add**
   - `@tailwindcss/vite` - Vite plugin for Tailwind v4
   - `@dnd-kit/core`, `@dnd-kit/sortable` - Drag-drop
   - shadcn/ui components (via CLI)

### Recommended Configuration

**vite.config.ts:**
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

**src/index.css:**
```css
@import "tailwindcss";

@theme {
  /* Design system colors from Visual Design System section */
  --color-background: #FAFAFA;
  --color-surface: #FFFFFF;
  --color-border: #E5E5E5;
  --color-text-primary: #171717;
  --color-text-secondary: #737373;
  --color-accent: #6366F1;
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-error: #EF4444;

  /* Typography */
  --font-sans: "Inter", sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: #0A0A0A;
    --color-surface: #171717;
    --color-border: #262626;
    --color-text-primary: #FAFAFA;
    --color-text-secondary: #A3A3A3;
    --color-accent: #818CF8;
  }
}
```

### React 19 Patterns to Leverage

1. **useActionState** for form submissions
2. **useOptimistic** for instant UI feedback (status changes, drag-drop)
3. **Activity component** for pre-rendering hidden tabs
4. **useEffectEvent** for WebSocket event handlers

### shadcn/ui Setup

```bash
# Initialize after Tailwind v4 setup
pnpm dlx shadcn@latest init

# Required components for this project
pnpm dlx shadcn@latest add button dialog command dropdown-menu \
  input textarea select checkbox card avatar badge \
  tooltip popover sheet scroll-area separator
```
