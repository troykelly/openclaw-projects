/**
 * Search results page.
 *
 * Reads the `?q=` query parameter from the URL to perform a global search.
 * Results are grouped by type (work items, contacts, memories) and each
 * result links to its detail page.
 *
 * Uses the `useSearch` TanStack Query hook for data fetching and supports
 * loading, error, and empty states.
 */
import React, { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router';
import { Search as SearchIcon, FileText, Users, Brain } from 'lucide-react';
import { useSearch } from '@/ui/hooks/queries/use-search';
import { Input } from '@/ui/components/ui/input';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { SkeletonList, EmptyState, ErrorState } from '@/ui/components/feedback';
import type { SearchResultItem } from '@/ui/lib/api-types';

/**
 * Derive the in-app route for a search result item.
 * The API returns URLs prefixed with `/app/` which must be stripped for
 * React Router navigation.
 */
function resultHref(item: SearchResultItem): string {
  const raw = item.url;
  // Strip /app prefix if present for React Router paths
  if (raw.startsWith('/app/')) {
    return raw.replace('/app', '');
  }
  return raw;
}

/** Icon for result type group headings. */
function typeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'work_item':
      return <FileText className="size-5" />;
    case 'contact':
      return <Users className="size-5" />;
    case 'memory':
      return <Brain className="size-5" />;
    default:
      return <FileText className="size-5" />;
  }
}

/** Human-readable heading for result type groups. */
function typeHeading(type: string): string {
  switch (type) {
    case 'work_item':
      return 'Work Items';
    case 'contact':
      return 'Contacts';
    case 'memory':
      return 'Memories';
    default:
      return 'Results';
  }
}

/** Badge variant for result types. */
function typeBadgeLabel(type: string): string {
  switch (type) {
    case 'work_item':
      return 'Work Item';
    case 'contact':
      return 'Contact';
    case 'memory':
      return 'Memory';
    default:
      return type;
  }
}

export function SearchPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';

  const { data, isLoading, error } = useSearch(query);

  /** Group results by type. */
  const grouped = useMemo(() => {
    if (!data?.results) return { work_items: [], contacts: [], memories: [] };
    const work_items: SearchResultItem[] = [];
    const contacts: SearchResultItem[] = [];
    const memories: SearchResultItem[] = [];
    for (const r of data.results) {
      if (r.type === 'work_item') work_items.push(r);
      else if (r.type === 'contact') contacts.push(r);
      else memories.push(r);
    }
    return { work_items, contacts, memories };
  }, [data]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    if (newQuery) {
      setSearchParams({ q: newQuery });
    } else {
      setSearchParams({});
    }
  };

  const hasQuery = query.length > 0;
  const hasResults =
    grouped.work_items.length > 0 ||
    grouped.contacts.length > 0 ||
    grouped.memories.length > 0;

  return (
    <div data-testid="page-search" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Find work items, contacts, and memories
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-6 max-w-2xl">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={handleQueryChange}
          className="pl-9"
          data-testid="search-input"
          autoFocus
        />
      </div>

      {/* States */}
      {!hasQuery && (
        <div data-testid="search-prompt" className="flex-1 flex items-center justify-center">
          <EmptyState
            variant="search"
            title="Start searching"
            description="Enter a query above to search across work items, contacts, and memories."
          />
        </div>
      )}

      {hasQuery && isLoading && (
        <div data-testid="search-loading" className="flex-1">
          <SkeletonList count={6} variant="row" />
        </div>
      )}

      {hasQuery && error && (
        <ErrorState
          type="generic"
          title="Search failed"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
        />
      )}

      {hasQuery && !isLoading && !error && !hasResults && (
        <EmptyState
          variant="search"
          title="No results found"
          description={`No results for "${query}". Try a different search term.`}
        />
      )}

      {hasQuery && !isLoading && !error && hasResults && (
        <div className="flex-1 space-y-6" data-testid="search-results">
          {/* Work Items group */}
          {grouped.work_items.length > 0 && (
            <ResultGroup
              testId="group-work_items"
              type="work_item"
              items={grouped.work_items}
            />
          )}

          {/* Contacts group */}
          {grouped.contacts.length > 0 && (
            <ResultGroup
              testId="group-contacts"
              type="contact"
              items={grouped.contacts}
            />
          )}

          {/* Memories group */}
          {grouped.memories.length > 0 && (
            <ResultGroup
              testId="group-memories"
              type="memory"
              items={grouped.memories}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultGroup - renders a group of results under a heading
// ---------------------------------------------------------------------------

interface ResultGroupProps {
  testId: string;
  type: string;
  items: SearchResultItem[];
}

function ResultGroup({ testId, type, items }: ResultGroupProps) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{typeIcon(type)}</span>
        <h2 className="text-lg font-semibold text-foreground">{typeHeading(type)}</h2>
        <Badge variant="secondary" className="text-xs">
          {items.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Card
            key={item.id}
            className="transition-colors hover:bg-accent/30"
          >
            <CardContent className="p-3">
              <Link
                to={resultHref(item)}
                data-testid={`result-link-${item.id}`}
                className="block"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-foreground truncate">
                      {item.title}
                    </h3>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {typeBadgeLabel(item.type)}
                  </Badge>
                </div>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
