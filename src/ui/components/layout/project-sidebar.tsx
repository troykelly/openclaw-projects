/**
 * Project sidebar with structured navigation sections.
 *
 * Replaces the flat RouterSidebar nav list with four sections:
 * - Triage: unparented issues count + link
 * - Lists: kind='list' work items
 * - Projects: hierarchical tree (reuses ProjectTree)
 * - Other: non-PM nav items (activity, people, notes, etc.)
 *
 * Issue #2296
 */
import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';
import {
  Bell, Users, Brain, StickyNote, MessageSquare, ChefHat, UtensilsCrossed,
  Home, Warehouse, Mic, Terminal, Code, Package, Activity, FileCode2,
  Search, Settings, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Plus, Folder, ListChecks, AlertCircle, Globe,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { APP_VERSION } from '@/ui/lib/version';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { PrefetchLink } from '@/ui/components/navigation/PrefetchLink';
import { useNamespaceSafe } from '@/ui/contexts/namespace-context';
import { useWorkItems, useWorkItemTree } from '@/ui/hooks/queries/use-work-items';
import type { WorkItemTreeNode } from '@/ui/lib/api-types';

// ── Constants ────────────────────────────────────────────────────────

const SECTION_STORAGE_PREFIX = 'sidebar-section-';

/** Non-PM nav items shown under "Other" */
const otherNavItems = [
  { id: 'activity', label: 'Activity', icon: Bell, to: '/activity' },
  { id: 'people', label: 'People', icon: Users, to: '/contacts' },
  { id: 'memory', label: 'Memory', icon: Brain, to: '/memory' },
  { id: 'notes', label: 'Notes', icon: StickyNote, to: '/notes' },
  { id: 'communications', label: 'Communications', icon: MessageSquare, to: '/communications' },
  { id: 'recipes', label: 'Recipes', icon: ChefHat, to: '/recipes' },
  { id: 'meal-log', label: 'Meal Log', icon: UtensilsCrossed, to: '/meal-log' },
  { id: 'home-automation', label: 'Home Automation', icon: Home, to: '/home-automation' },
  { id: 'pantry', label: 'Pantry', icon: Warehouse, to: '/pantry' },
  { id: 'voice', label: 'Voice', icon: Mic, to: '/voice' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, to: '/terminal' },
  { id: 'symphony', label: 'Symphony', icon: Activity, to: '/symphony' },
  { id: 'dev-sessions', label: 'Dev Sessions', icon: Code, to: '/dev-sessions' },
  { id: 'dev-prompts', label: 'Dev Prompts', icon: FileCode2, to: '/dev-prompts' },
  { id: 'skill-store', label: 'Skill Store', icon: Package, to: '/skill-store' },
];

// ── Section collapse hooks ───────────────────────────────────────────

function useSectionCollapsed(sectionId: string): [boolean, () => void] {
  const key = SECTION_STORAGE_PREFIX + sectionId;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(key) === 'collapsed';
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(key, next ? 'collapsed' : 'expanded');
      return next;
    });
  }, [key]);

  return [collapsed, toggle];
}

// ── Section header component ─────────────────────────────────────────

interface SectionHeaderProps {
  id: string;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  count?: number;
  sidebarCollapsed?: boolean;
}

function SectionHeader({ id, label, collapsed, onToggle, count, sidebarCollapsed }: SectionHeaderProps) {
  if (sidebarCollapsed) return null;

  return (
    <button
      data-testid={`section-header-${id}`}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors"
    >
      {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="h-4 min-w-[1rem] px-1 text-[10px] font-medium">
          {count}
        </Badge>
      )}
    </button>
  );
}

// ── Recursive tree node for Projects section ─────────────────────────

interface TreeNodeProps {
  node: WorkItemTreeNode;
  depth: number;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  sidebarCollapsed?: boolean;
}

function TreeNode({ node, depth, expandedIds, onToggleExpand, sidebarCollapsed }: TreeNodeProps) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children && node.children.length > 0;

  // Route: projects go to /projects/:id, other kinds to /work-items/:id
  const to = node.kind === 'project' ? `/projects/${node.id}` : `/work-items/${node.id}`;

  return (
    <>
      <div className="flex items-center">
        {!sidebarCollapsed && hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            style={{ marginLeft: depth * 12 }}
            aria-label={isExpanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
          >
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
        <PrefetchLink
          to={to}
          prefetchPath={to}
          className={({ isActive }) =>
            cn(
              'flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
              isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              !hasChildren && !sidebarCollapsed && `ml-[${depth * 12 + 20}px]`,
            )
          }
          style={!hasChildren && !sidebarCollapsed ? { marginLeft: depth * 12 + 20 } : undefined}
        >
          <Folder className="size-3.5 shrink-0" />
          {!sidebarCollapsed && <span className="truncate">{node.title}</span>}
        </PrefetchLink>
      </div>
      {isExpanded && hasChildren && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          sidebarCollapsed={sidebarCollapsed}
        />
      ))}
    </>
  );
}

// ── Main ProjectSidebar component ────────────────────────────────────

export interface ProjectSidebarProps {
  onCreateClick?: () => void;
  onSearchClick?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

export function ProjectSidebar({
  onCreateClick,
  onSearchClick,
  collapsed = false,
  onCollapsedChange,
  className,
}: ProjectSidebarProps) {
  // Section collapse states
  const [triageCollapsed, toggleTriage] = useSectionCollapsed('triage');
  const [listsCollapsed, toggleLists] = useSectionCollapsed('lists');
  const [projectsCollapsed, toggleProjects] = useSectionCollapsed('projects');
  const [otherCollapsed, toggleOther] = useSectionCollapsed('other');

  // Tree expand states
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Namespace
  const ns = useNamespaceSafe();
  const grants = ns?.grants ?? [];
  const activeNamespace = ns?.activeNamespace ?? 'default';
  const setActiveNamespace = ns?.setActiveNamespace;
  const hasMultipleNamespaces = ns?.hasMultipleNamespaces ?? false;

  // Data fetching
  const { data: triageData } = useWorkItems({ kind: 'issue', parent_id: 'none' });
  const { data: listsData } = useWorkItems({ kind: 'list' });
  const { data: treeData } = useWorkItemTree();

  const triageCount = triageData?.items?.length ?? 0;
  const lists = useMemo(() => listsData?.items ?? [], [listsData]);
  const treeItems = useMemo(() => treeData?.items ?? [], [treeData]);

  const handleToggleCollapse = useCallback(() => {
    onCollapsedChange?.(!collapsed);
  }, [collapsed, onCollapsedChange]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-testid="project-sidebar"
        data-collapsed={collapsed}
        className={cn(
          'flex h-full flex-col border-r border-border bg-surface z-20 transition-all duration-300 ease-out',
          collapsed ? 'w-16' : 'w-60',
          className,
        )}
      >
        {/* Logo / Header */}
        <div className="flex h-14 items-center px-4">
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center w-full')}>
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-sm">
              <span className="text-sm font-bold text-primary-foreground">O</span>
            </div>
            {!collapsed && <span className="text-base font-semibold tracking-tight text-foreground">OpenClaw Projects</span>}
          </div>
          {!collapsed && (
            <button
              onClick={handleToggleCollapse}
              className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
        </div>

        {/* Namespace Selector */}
        {grants.length > 0 && (
          <div className="px-3 pt-2">
            {hasMultipleNamespaces ? (
              collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex w-full items-center justify-center rounded-md py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label={`Namespace: ${activeNamespace}`}
                    >
                      <Globe className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="font-medium">
                    {activeNamespace}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Select value={activeNamespace} onValueChange={(v) => setActiveNamespace?.(v)}>
                  <SelectTrigger size="sm" className="w-full text-xs" aria-label="Select namespace">
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grants.map((g) => (
                      <SelectItem key={g.namespace} value={g.namespace}>
                        {g.namespace}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <Globe className="size-3.5 shrink-0" />
                    {!collapsed && <span className="truncate">{activeNamespace}</span>}
                  </div>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" sideOffset={8} className="font-medium">
                    {activeNamespace}
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        )}

        {/* "+ New" Quick Add */}
        <div className="px-3 pt-4">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    data-testid="sidebar-new-button"
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90',
                      collapsed && 'px-0',
                    )}
                    aria-label="Create new item"
                  >
                    <Plus className="size-[18px] shrink-0" />
                    {!collapsed && <span>New</span>}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" sideOffset={8} className="font-medium">
                  New <kbd className="ml-1 text-[10px]">N</kbd>
                </TooltipContent>
              )}
            </Tooltip>
            <DropdownMenuContent side={collapsed ? 'right' : 'bottom'} align="start" className="w-48">
              <DropdownMenuItem onClick={() => onCreateClick?.()}>
                <Folder className="mr-2 size-4" />
                New Project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreateClick?.()}>
                <ListChecks className="mr-2 size-4" />
                New List
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreateClick?.()}>
                <AlertCircle className="mr-2 size-4" />
                New Issue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1 px-3 py-4">
          <div className="flex flex-col gap-3">
            {/* ── Triage Section ── */}
            <div>
              <SectionHeader
                id="triage"
                label="Triage"
                collapsed={triageCollapsed}
                onToggle={toggleTriage}
                count={triageCount}
                sidebarCollapsed={collapsed}
              />
              {!triageCollapsed && (
                <div className="mt-1">
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PrefetchLink
                          to="/triage"
                          prefetchPath="/triage"
                          className={({ isActive }) =>
                            cn(
                              'flex w-full items-center justify-center rounded-lg px-0 py-2.5 transition-colors',
                              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )
                          }
                        >
                          <AlertCircle className="size-[18px]" />
                        </PrefetchLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="font-medium">
                        Triage ({triageCount})
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <PrefetchLink
                      to="/triage"
                      prefetchPath="/triage"
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )
                      }
                    >
                      <AlertCircle className="size-4 shrink-0" />
                      <span className="flex-1">Triage</span>
                      {triageCount > 0 && (
                        <Badge variant="secondary" className="h-5 min-w-[1.25rem] px-1.5 text-[10px]">
                          {triageCount}
                        </Badge>
                      )}
                    </PrefetchLink>
                  )}
                </div>
              )}
            </div>

            {/* ── Lists Section ── */}
            <div>
              <SectionHeader
                id="lists"
                label="Lists"
                collapsed={listsCollapsed}
                onToggle={toggleLists}
                count={lists.length}
                sidebarCollapsed={collapsed}
              />
              {!listsCollapsed && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PrefetchLink
                          to="/work-items"
                          prefetchPath="/work-items"
                          className={({ isActive }) =>
                            cn(
                              'flex w-full items-center justify-center rounded-lg px-0 py-2.5 transition-colors',
                              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )
                          }
                        >
                          <ListChecks className="size-[18px]" />
                        </PrefetchLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="font-medium">
                        Lists ({lists.length})
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    lists.map((item) => (
                      <PrefetchLink
                        key={item.id}
                        to={`/lists/${item.id}`}
                        prefetchPath={`/lists/${item.id}`}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
                            isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )
                        }
                      >
                        <ListChecks className="size-3.5 shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </PrefetchLink>
                    ))
                  )}
                  {!collapsed && lists.length === 0 && (
                    <span className="px-2 py-1 text-xs text-muted-foreground/50">No lists yet</span>
                  )}
                </div>
              )}
            </div>

            {/* ── Projects Section ── */}
            <div>
              <SectionHeader
                id="projects"
                label="Projects"
                collapsed={projectsCollapsed}
                onToggle={toggleProjects}
                count={treeItems.length}
                sidebarCollapsed={collapsed}
              />
              {!projectsCollapsed && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PrefetchLink
                          to="/work-items"
                          prefetchPath="/work-items"
                          className={({ isActive }) =>
                            cn(
                              'flex w-full items-center justify-center rounded-lg px-0 py-2.5 transition-colors',
                              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )
                          }
                        >
                          <Folder className="size-[18px]" />
                        </PrefetchLink>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="font-medium">
                        Projects ({treeItems.length})
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      {treeItems.map((node) => (
                        <TreeNode
                          key={node.id}
                          node={node}
                          depth={0}
                          expandedIds={expandedIds}
                          onToggleExpand={handleToggleExpand}
                          sidebarCollapsed={collapsed}
                        />
                      ))}
                      {treeItems.length === 0 && (
                        <span className="px-2 py-1 text-xs text-muted-foreground/50">No projects yet</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Other Section ── */}
            <div>
              <SectionHeader
                id="other"
                label="Other"
                collapsed={otherCollapsed}
                onToggle={toggleOther}
                sidebarCollapsed={collapsed}
              />
              {!otherCollapsed && (
                <nav className="mt-1 flex flex-col gap-0.5" role="navigation" aria-label="Other navigation">
                  {otherNavItems.map((item) => {
                    const Icon = item.icon;
                    const link = (
                      <PrefetchLink
                        key={item.id}
                        to={item.to}
                        prefetchPath={item.to}
                        className={({ isActive }) =>
                          cn(
                            'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            collapsed && 'justify-center px-0',
                            isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )
                        }
                        end={item.to === '/activity'}
                      >
                        <Icon className="size-4 shrink-0" />
                        {!collapsed && <span>{item.label}</span>}
                      </PrefetchLink>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.id}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8} className="font-medium">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return link;
                  })}
                </nav>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
                onClick={onSearchClick}
              >
                <Search className="size-[18px] shrink-0" />
                {!collapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span>Search</span>
                    <kbd className="hidden rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
                      ⌘K
                    </kbd>
                  </span>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8} className="font-medium">
                Search <kbd className="ml-1 text-[10px]">⌘K</kbd>
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <PrefetchLink
                to="/settings"
                prefetchPath="/settings"
                className={({ isActive }) =>
                  cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Settings className="size-[18px] shrink-0" />
                {!collapsed && <span>Settings</span>}
              </PrefetchLink>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8} className="font-medium">
                Settings
              </TooltipContent>
            )}
          </Tooltip>

          {collapsed && (
            <button
              onClick={handleToggleCollapse}
              className="mt-2 flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="size-4" />
            </button>
          )}

          {/* Version */}
          <p data-testid="app-version" className={cn('text-center text-[10px] text-muted-foreground/50 select-none pt-1', collapsed && 'px-0')}>
            {collapsed ? 'v' : `v${APP_VERSION}`}
          </p>
        </div>
      </aside>
    </TooltipProvider>
  );
}
