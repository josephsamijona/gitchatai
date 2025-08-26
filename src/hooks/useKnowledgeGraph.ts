/**
 * Knowledge Graph Hook
 * SYNAPSE AI Platform - Task 7 Implementation
 * 
 * React hook for managing knowledge graph state and operations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  KnowledgeGraph,
  ConceptExtractionRequest,
  ConceptAnalyticsResult,
  GraphVisualizationData,
  ConceptInsight,
  ConceptRecommendation,
  GraphLayoutOptions,
  VisualizationTheme
} from '@/types/knowledge';

interface UseKnowledgeGraphOptions {
  projectId?: string;
  autoLoad?: boolean;
  refreshInterval?: number;
  layoutType?: 'force-directed' | 'hierarchical' | 'circular';
  theme?: VisualizationTheme;
}

interface UseKnowledgeGraphState {
  // Core graph data
  graph: KnowledgeGraph | null;
  visualization: GraphVisualizationData | null;
  
  // Analytics data
  analytics: ConceptAnalyticsResult | null;
  insights: ConceptInsight[];
  recommendations: ConceptRecommendation[];
  
  // UI state
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  
  // Interaction state
  selectedNodes: string[];
  hoveredNode: string | null;
  selectedEdges: string[];
  
  // Performance metrics
  performanceMetrics: {
    loadTime: number;
    renderTime: number;
    nodeCount: number;
    edgeCount: number;
  } | null;
}

export function useKnowledgeGraph(options: UseKnowledgeGraphOptions = {}) {
  const {
    projectId,
    autoLoad = true,
    refreshInterval = 30000, // 30 seconds
    layoutType = 'force-directed',
    theme
  } = options;

  const [state, setState] = useState<UseKnowledgeGraphState>({
    graph: null,
    visualization: null,
    analytics: null,
    insights: [],
    recommendations: [],
    loading: false,
    error: null,
    lastUpdated: null,
    selectedNodes: [],
    hoveredNode: null,
    selectedEdges: [],
    performanceMetrics: null
  });

  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Load knowledge graph for project
   */
  const loadKnowledgeGraph = useCallback(async (forceRefresh = false) => {
    if (!projectId) return;

    // Don't load if already loading or data exists (unless force refresh)
    if (state.loading || (!forceRefresh && state.graph)) return;

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState(prev => ({ ...prev, loading: true, error: null }));
    const startTime = Date.now();

    try {
      // Load knowledge graph
      const graphResponse = await fetch('/api/knowledge/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
        signal: abortController.signal
      });

      if (!graphResponse.ok) {
        throw new Error(`Failed to load knowledge graph: ${graphResponse.statusText}`);
      }

      const graphData = await graphResponse.json();
      const loadTime = Date.now() - startTime;

      setState(prev => ({
        ...prev,
        graph: graphData.data.graph,
        loading: false,
        lastUpdated: new Date(),
        performanceMetrics: {
          ...prev.performanceMetrics,
          loadTime,
          nodeCount: graphData.data.stats.conceptCount,
          edgeCount: graphData.data.stats.relationshipCount
        }
      }));

      // Load visualization if graph loaded successfully
      await loadVisualization(graphData.data.graph);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was cancelled
      }

      console.error('Failed to load knowledge graph:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load knowledge graph'
      }));
    }
  }, [projectId, state.loading, state.graph]);

  /**
   * Load visualization data for the graph
   */
  const loadVisualization = useCallback(async (graph?: KnowledgeGraph) => {
    if (!projectId) return;

    const targetGraph = graph || state.graph;
    if (!targetGraph) return;

    const renderStartTime = Date.now();

    try {
      const visualizationResponse = await fetch('/api/knowledge/graph/visualization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          layoutType,
          theme
        })
      });

      if (!visualizationResponse.ok) {
        throw new Error(`Failed to load visualization: ${visualizationResponse.statusText}`);
      }

      const visualizationData = await visualizationResponse.json();
      const renderTime = Date.now() - renderStartTime;

      setState(prev => ({
        ...prev,
        visualization: visualizationData.data.visualization,
        performanceMetrics: {
          ...prev.performanceMetrics,
          renderTime,
          loadTime: prev.performanceMetrics?.loadTime || 0,
          nodeCount: visualizationData.data.metadata.nodeCount,
          edgeCount: visualizationData.data.metadata.edgeCount
        }
      }));

    } catch (error) {
      console.error('Failed to load visualization:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load visualization'
      }));
    }
  }, [projectId, state.graph, layoutType, theme]);

  /**
   * Load analytics data
   */
  const loadAnalytics = useCallback(async () => {
    if (!projectId) return;

    try {
      const analyticsResponse = await fetch(
        `/api/knowledge/concepts?projectId=${projectId}&analytics=true&insights=true&recommendations=true`
      );

      if (!analyticsResponse.ok) {
        throw new Error(`Failed to load analytics: ${analyticsResponse.statusText}`);
      }

      const analyticsData = await analyticsResponse.json();

      setState(prev => ({
        ...prev,
        analytics: analyticsData.data,
        insights: analyticsData.data.insights || [],
        recommendations: analyticsData.data.recommendations || []
      }));

    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  }, [projectId]);

  /**
   * Extract concepts from content
   */
  const extractConcepts = useCallback(async (content: string, preferredModel?: string) => {
    if (!projectId || !content) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const extractionRequest: ConceptExtractionRequest = {
        projectId,
        content,
        contentId: `manual-${Date.now()}`,
        preferredModel
      };

      const response = await fetch('/api/knowledge/concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractionRequest)
      });

      if (!response.ok) {
        throw new Error(`Failed to extract concepts: ${response.statusText}`);
      }

      const result = await response.json();

      // Reload graph after successful extraction
      await loadKnowledgeGraph(true);

      return result.data;

    } catch (error) {
      console.error('Failed to extract concepts:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to extract concepts'
      }));
      throw error;
    }
  }, [projectId, loadKnowledgeGraph]);

  /**
   * Node selection handlers
   */
  const selectNode = useCallback((nodeId: string, multiSelect = false) => {
    setState(prev => ({
      ...prev,
      selectedNodes: multiSelect
        ? prev.selectedNodes.includes(nodeId)
          ? prev.selectedNodes.filter(id => id !== nodeId)
          : [...prev.selectedNodes, nodeId]
        : [nodeId]
    }));
  }, []);

  const selectNodes = useCallback((nodeIds: string[]) => {
    setState(prev => ({ ...prev, selectedNodes: nodeIds }));
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedNodes: [], selectedEdges: [] }));
  }, []);

  const hoverNode = useCallback((nodeId: string | null) => {
    setState(prev => ({ ...prev, hoveredNode: nodeId }));
  }, []);

  /**
   * Layout and theme updates
   */
  const updateLayout = useCallback(async (newLayoutType: typeof layoutType) => {
    if (newLayoutType !== layoutType) {
      await loadVisualization();
    }
  }, [loadVisualization, layoutType]);

  const updateTheme = useCallback(async (newTheme: VisualizationTheme) => {
    await loadVisualization();
  }, [loadVisualization]);

  /**
   * Refresh data
   */
  const refresh = useCallback(async () => {
    await Promise.all([
      loadKnowledgeGraph(true),
      loadAnalytics()
    ]);
  }, [loadKnowledgeGraph, loadAnalytics]);

  // Auto-load on mount and project change
  useEffect(() => {
    if (autoLoad && projectId && !state.graph) {
      loadKnowledgeGraph();
      loadAnalytics();
    }
  }, [autoLoad, projectId, loadKnowledgeGraph, loadAnalytics, state.graph]);

  // Set up refresh interval
  useEffect(() => {
    if (refreshInterval > 0 && projectId) {
      refreshIntervalRef.current = setInterval(() => {
        loadAnalytics(); // Only refresh analytics, not the full graph
      }, refreshInterval);

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
      };
    }
  }, [refreshInterval, projectId, loadAnalytics]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  return {
    // Data
    graph: state.graph,
    visualization: state.visualization,
    analytics: state.analytics,
    insights: state.insights,
    recommendations: state.recommendations,
    performanceMetrics: state.performanceMetrics,

    // State
    loading: state.loading,
    error: state.error,
    lastUpdated: state.lastUpdated,

    // Selection
    selectedNodes: state.selectedNodes,
    hoveredNode: state.hoveredNode,
    selectedEdges: state.selectedEdges,

    // Actions
    loadKnowledgeGraph,
    loadVisualization,
    loadAnalytics,
    extractConcepts,
    refresh,

    // Interaction
    selectNode,
    selectNodes,
    clearSelection,
    hoverNode,

    // Layout
    updateLayout,
    updateTheme,

    // Computed properties
    hasData: !!state.graph,
    isEmpty: state.graph?.concepts.length === 0,
    isReady: !!state.graph && !!state.visualization && !state.loading
  };
}