/**
 * Universal Search Hook
 * SYNAPSE AI Platform - Task 8 Implementation
 * 
 * React hook for managing universal search state and operations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  UniversalSearchRequest,
  UniversalSearchResult,
  SearchScope,
  SearchFilter,
  SearchSuggestion,
  CodeSearchResult,
  AdvancedSearchQuery,
  QuickAction
} from '@/types/search';

interface UseSearchOptions {
  projectId?: string;
  defaultScope?: SearchScope;
  debounceMs?: number;
  enableSuggestions?: boolean;
  enableHistory?: boolean;
  maxHistoryItems?: number;
}

interface UseSearchState {
  // Current search state
  query: string;
  results: any[];
  suggestions: SearchSuggestion[];
  
  // UI state
  loading: boolean;
  error: string | null;
  
  // Search configuration
  scope: SearchScope;
  filters: SearchFilter[];
  
  // Performance metrics
  lastSearchTime: number;
  totalResults: number;
  
  // History and analytics
  searchHistory: string[];
  popularQueries: string[];
  
  // Code search specific
  codeResults: CodeSearchResult[];
  availableLanguages: string[];
}

interface UseSearchActions {
  // Core search actions
  search: (query: string, options?: Partial<UniversalSearchRequest>) => Promise<void>;
  searchCode: (query: string, language?: string) => Promise<void>;
  advancedSearch: (query: AdvancedSearchQuery) => Promise<void>;
  
  // Query management
  setQuery: (query: string) => void;
  clearQuery: () => void;
  
  // Scope and filtering
  setScope: (scope: SearchScope) => void;
  addFilter: (filter: SearchFilter) => void;
  removeFilter: (filterIndex: number) => void;
  clearFilters: () => void;
  
  // Suggestions and history
  getSuggestions: (partialQuery: string) => Promise<void>;
  clearSuggestions: () => void;
  addToHistory: (query: string) => void;
  clearHistory: () => void;
  
  // Quick actions
  executeQuickAction: (action: QuickAction, result: any) => Promise<void>;
  
  // Utility actions
  reset: () => void;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchState & UseSearchActions {
  const {
    projectId,
    defaultScope = 'project',
    debounceMs = 300,
    enableSuggestions = true,
    enableHistory = true,
    maxHistoryItems = 20
  } = options;

  const [state, setState] = useState<UseSearchState>({
    query: '',
    results: [],
    suggestions: [],
    loading: false,
    error: null,
    scope: defaultScope,
    filters: [],
    lastSearchTime: 0,
    totalResults: 0,
    searchHistory: [],
    popularQueries: [],
    codeResults: [],
    availableLanguages: []
  });

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Execute universal search
   */
  const search = useCallback(async (
    query: string, 
    options: Partial<UniversalSearchRequest> = {}
  ) => {
    if (!query.trim()) {
      setState(prev => ({ ...prev, results: [], totalResults: 0, error: null }));
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState(prev => ({ ...prev, loading: true, error: null }));
    const startTime = Date.now();

    try {
      const searchRequest: UniversalSearchRequest = {
        query: query.trim(),
        scope: state.scope,
        projectId,
        filters: state.filters,
        limit: 50,
        ...options
      };

      const response = await fetch('/api/search/universal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      const searchTime = Date.now() - startTime;

      if (data.success) {
        setState(prev => ({
          ...prev,
          results: data.data.results,
          totalResults: data.data.analytics.totalResults,
          lastSearchTime: searchTime,
          loading: false,
          query: query.trim()
        }));

        // Add to search history
        if (enableHistory) {
          addToHistory(query.trim());
        }
      } else {
        throw new Error(data.error || 'Search failed');
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled
      }

      console.error('Search failed:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Search failed'
      }));
    }
  }, [state.scope, state.filters, projectId, enableHistory]);

  /**
   * Execute code search
   */
  const searchCode = useCallback(async (query: string, language?: string) => {
    if (!query.trim()) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch('/api/search/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          projectId,
          language,
          limit: 30
        })
      });

      if (!response.ok) {
        throw new Error(`Code search failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        setState(prev => ({
          ...prev,
          codeResults: data.data.results,
          loading: false,
          query: query.trim()
        }));
      } else {
        throw new Error(data.error || 'Code search failed');
      }

    } catch (error) {
      console.error('Code search failed:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Code search failed'
      }));
    }
  }, [projectId]);

  /**
   * Execute advanced search
   */
  const advancedSearch = useCallback(async (advancedQuery: AdvancedSearchQuery) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch('/api/search/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...advancedQuery,
          projectId
        })
      });

      if (!response.ok) {
        throw new Error(`Advanced search failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        setState(prev => ({
          ...prev,
          results: data.data.results,
          totalResults: data.data.analytics.totalResults,
          loading: false,
          query: advancedQuery.query
        }));
      } else {
        throw new Error(data.error || 'Advanced search failed');
      }

    } catch (error) {
      console.error('Advanced search failed:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Advanced search failed'
      }));
    }
  }, [projectId]);

  /**
   * Get search suggestions with debouncing
   */
  const getSuggestions = useCallback(async (partialQuery: string) => {
    if (!enableSuggestions || partialQuery.length < 2) {
      setState(prev => ({ ...prev, suggestions: [] }));
      return;
    }

    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Debounce suggestions
    debounceTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search/universal/suggestions?q=${encodeURIComponent(partialQuery)}&projectId=${projectId || ''}&limit=10`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setState(prev => ({ ...prev, suggestions: data.data.suggestions }));
          }
        }
      } catch (error) {
        console.error('Failed to get suggestions:', error);
      }
    }, debounceMs);
  }, [enableSuggestions, debounceMs, projectId]);

  /**
   * Set search query and trigger suggestions
   */
  const setQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, query }));
    
    if (enableSuggestions && query.length >= 2) {
      getSuggestions(query);
    } else {
      setState(prev => ({ ...prev, suggestions: [] }));
    }
  }, [enableSuggestions, getSuggestions]);

  /**
   * Add query to search history
   */
  const addToHistory = useCallback((query: string) => {
    if (!enableHistory || !query.trim()) return;

    setState(prev => {
      const newHistory = [query, ...prev.searchHistory.filter(h => h !== query)]
        .slice(0, maxHistoryItems);
      
      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('synapse-search-history', JSON.stringify(newHistory));
      }
      
      return { ...prev, searchHistory: newHistory };
    });
  }, [enableHistory, maxHistoryItems]);

  /**
   * Execute quick action from search result
   */
  const executeQuickAction = useCallback(async (action: QuickAction, result: any) => {
    try {
      switch (action.type) {
        case 'view':
          // Navigate to result
          window.location.href = `/chat/${result.conversationId}`;
          break;
          
        case 'create-branch':
          // Create branch from message
          const branchResponse = await fetch('/api/branches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: action.data.messageId,
              name: `Search: ${action.data.query}`,
              conversationId: result.conversationId
            })
          });
          
          if (branchResponse.ok) {
            const branchData = await branchResponse.json();
            window.location.href = `/chat/${result.conversationId}/branch/${branchData.data.id}`;
          }
          break;
          
        case 'copy':
          // Copy content to clipboard
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(action.data.content);
          }
          break;
          
        default:
          console.warn('Unknown quick action:', action.type);
      }
    } catch (error) {
      console.error('Quick action failed:', error);
    }
  }, []);

  // Other action implementations
  const clearQuery = useCallback(() => {
    setState(prev => ({ ...prev, query: '', results: [], suggestions: [] }));
  }, []);

  const setScope = useCallback((scope: SearchScope) => {
    setState(prev => ({ ...prev, scope }));
  }, []);

  const addFilter = useCallback((filter: SearchFilter) => {
    setState(prev => ({ ...prev, filters: [...prev.filters, filter] }));
  }, []);

  const removeFilter = useCallback((filterIndex: number) => {
    setState(prev => ({
      ...prev,
      filters: prev.filters.filter((_, index) => index !== filterIndex)
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setState(prev => ({ ...prev, filters: [] }));
  }, []);

  const clearSuggestions = useCallback(() => {
    setState(prev => ({ ...prev, suggestions: [] }));
  }, []);

  const clearHistory = useCallback(() => {
    setState(prev => ({ ...prev, searchHistory: [] }));
    if (typeof window !== 'undefined') {
      localStorage.removeItem('synapse-search-history');
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      query: '',
      results: [],
      suggestions: [],
      loading: false,
      error: null,
      scope: defaultScope,
      filters: [],
      lastSearchTime: 0,
      totalResults: 0,
      searchHistory: [],
      popularQueries: [],
      codeResults: [],
      availableLanguages: []
    });
  }, [defaultScope]);

  // Load search history on mount
  useEffect(() => {
    if (enableHistory && typeof window !== 'undefined') {
      try {
        const savedHistory = localStorage.getItem('synapse-search-history');
        if (savedHistory) {
          const history = JSON.parse(savedHistory);
          setState(prev => ({ ...prev, searchHistory: history.slice(0, maxHistoryItems) }));
        }
      } catch (error) {
        console.error('Failed to load search history:', error);
      }
    }
  }, [enableHistory, maxHistoryItems]);

  // Load available languages for code search
  useEffect(() => {
    if (projectId) {
      fetch(`/api/search/code/languages?projectId=${projectId}`)
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            setState(prev => ({ ...prev, availableLanguages: data.data.languages }));
          }
        })
        .catch(error => console.error('Failed to load languages:', error));
    }
  }, [projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // State
    ...state,
    
    // Actions
    search,
    searchCode,
    advancedSearch,
    setQuery,
    clearQuery,
    setScope,
    addFilter,
    removeFilter,
    clearFilters,
    getSuggestions,
    clearSuggestions,
    addToHistory,
    clearHistory,
    executeQuickAction,
    reset
  };
}