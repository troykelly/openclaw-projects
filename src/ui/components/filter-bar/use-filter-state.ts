import { useState, useCallback, useEffect, useMemo } from 'react';
import type { FilterState, SavedFilter } from './types';

const SAVED_FILTERS_KEY = 'openclaw-saved-filters';

/**
 * Serialize filter state to URL search params
 */
export function filtersToSearchParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else if (typeof value === 'boolean') {
      params.set(key, value ? 'true' : 'false');
    } else if (typeof value === 'object') {
      // DateRange object
      params.set(key, JSON.stringify(value));
    } else {
      params.set(key, String(value));
    }
  });

  return params;
}

/**
 * Parse URL search params to filter state
 */
export function searchParamsToFilters(params: URLSearchParams): FilterState {
  const filters: FilterState = {};

  const multiValueFields = ['status', 'priority', 'kind', 'assignee'];
  const booleanFields = ['hasDescription', 'hasEstimate'];
  const dateFields = ['createdDate', 'updatedDate', 'dueDate'];

  multiValueFields.forEach((field) => {
    const values = params.getAll(field);
    if (values.length > 0) {
      (filters as Record<string, unknown>)[field] = values;
    }
  });

  booleanFields.forEach((field) => {
    const value = params.get(field);
    if (value !== null) {
      (filters as Record<string, unknown>)[field] = value === 'true';
    }
  });

  dateFields.forEach((field) => {
    const value = params.get(field);
    if (value) {
      try {
        (filters as Record<string, unknown>)[field] = JSON.parse(value);
      } catch {
        (filters as Record<string, unknown>)[field] = value;
      }
    }
  });

  const parent = params.get('parent');
  if (parent !== null) {
    filters.parent = parent === 'null' ? null : parent;
  }

  const search = params.get('search');
  if (search) {
    filters.search = search;
  }

  return filters;
}

/**
 * Hook for managing filter state with URL and localStorage persistence
 */
export function useFilterState(
  initialFilters: FilterState = {},
  options: {
    persistToUrl?: boolean;
    storageKey?: string;
  } = {},
) {
  const { persistToUrl = true, storageKey } = options;

  // Initialize from URL if available
  const [filters, setFiltersInternal] = useState<FilterState>(() => {
    if (persistToUrl && typeof window !== 'undefined') {
      const urlFilters = searchParamsToFilters(new URLSearchParams(window.location.search));
      if (Object.keys(urlFilters).length > 0) {
        return urlFilters;
      }
    }
    return initialFilters;
  });

  // Saved filters from localStorage
  const [savedFilters, setSavedFiltersInternal] = useState<SavedFilter[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(SAVED_FILTERS_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  // Update URL when filters change
  useEffect(() => {
    if (!persistToUrl || typeof window === 'undefined') return;

    const params = filtersToSearchParams(filters);
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;

    if (window.location.search !== `?${params.toString()}`) {
      window.history.pushState({}, '', newUrl);
    }
  }, [filters, persistToUrl]);

  // Handle browser back/forward
  useEffect(() => {
    if (!persistToUrl || typeof window === 'undefined') return;

    const handlePopState = () => {
      const urlFilters = searchParamsToFilters(new URLSearchParams(window.location.search));
      setFiltersInternal(urlFilters);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [persistToUrl]);

  // Persist saved filters to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(savedFilters));
    }
  }, [savedFilters]);

  const setFilters = useCallback((newFilters: FilterState) => {
    setFiltersInternal(newFilters);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersInternal({});
  }, []);

  const saveFilter = useCallback(
    (name: string, filtersToSave?: FilterState) => {
      const newFilter: SavedFilter = {
        id: crypto.randomUUID(),
        name,
        filters: filtersToSave || filters,
        createdAt: new Date().toISOString(),
      };
      setSavedFiltersInternal((prev) => [...prev, newFilter]);
      return newFilter;
    },
    [filters],
  );

  const deleteFilter = useCallback((id: string) => {
    setSavedFiltersInternal((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const applyFilter = useCallback((savedFilter: SavedFilter) => {
    setFiltersInternal(savedFilter.filters);
  }, []);

  // Build query string for API calls
  const queryString = useMemo(() => {
    return filtersToSearchParams(filters).toString();
  }, [filters]);

  return {
    filters,
    setFilters,
    clearFilters,
    savedFilters,
    saveFilter,
    deleteFilter,
    applyFilter,
    queryString,
    hasActiveFilters: Object.keys(filters).some((key) => {
      const value = filters[key as keyof FilterState];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null;
    }),
  };
}
