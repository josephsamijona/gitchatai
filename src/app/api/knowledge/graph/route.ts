/**
 * Knowledge Graph API
 * SYNAPSE AI Platform - Task 7 Implementation
 * 
 * Handles knowledge graph generation, visualization, and management endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { knowledgeGraphService } from '@/lib/services/knowledge-graph';
import { graphVisualizationService } from '@/lib/services/graph-visualization';
import type { GraphLayoutOptions, ForceSimulationConfig, VisualizationTheme } from '@/types/knowledge';

/**
 * POST /api/knowledge/graph
 * Generate complete knowledge graph for a project
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, layoutOptions } = body;
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Build complete knowledge graph
    const knowledgeGraph = await knowledgeGraphService.buildProjectKnowledgeGraph(projectId, layoutOptions);
    
    return NextResponse.json({
      success: true,
      data: {
        graph: knowledgeGraph,
        stats: {
          conceptCount: knowledgeGraph.concepts.length,
          relationshipCount: knowledgeGraph.relationships.length,
          clusterCount: knowledgeGraph.clusters.length,
          processingTime: knowledgeGraph.metadata.processingTimeMs
        }
      }
    });

  } catch (error) {
    console.error('Knowledge graph generation failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate knowledge graph',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/knowledge/graph/visualization
 * Generate visualization data for 3D graph rendering
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      projectId, 
      layoutType = 'force-directed', 
      theme,
      forceConfig 
    } = body;
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Get knowledge graph data
    const knowledgeGraph = await knowledgeGraphService.buildProjectKnowledgeGraph(projectId);
    
    let visualizationData;
    
    // Generate visualization based on layout type
    switch (layoutType) {
      case 'force-directed':
        visualizationData = await graphVisualizationService.generateForceDirectedLayout(
          knowledgeGraph.concepts,
          knowledgeGraph.relationships,
          knowledgeGraph.clusters,
          forceConfig
        );
        break;
        
      case 'hierarchical':
        visualizationData = await graphVisualizationService.generateHierarchicalLayout(
          knowledgeGraph.concepts,
          knowledgeGraph.relationships
        );
        break;
        
      case 'circular':
        visualizationData = await graphVisualizationService.generateCircularLayout(
          knowledgeGraph.concepts,
          knowledgeGraph.relationships,
          knowledgeGraph.clusters
        );
        break;
        
      default:
        return NextResponse.json(
          { error: `Unsupported layout type: ${layoutType}` },
          { status: 400 }
        );
    }

    // Apply theme if provided
    if (theme) {
      visualizationData = graphVisualizationService.applyVisualizationTheme(visualizationData, theme);
    }
    
    return NextResponse.json({
      success: true,
      data: {
        visualization: visualizationData,
        metadata: {
          layoutType,
          nodeCount: visualizationData.nodes.length,
          edgeCount: visualizationData.edges.length,
          clusterCount: visualizationData.clusters?.length || 0,
          theme: theme?.name || 'default'
        }
      }
    });

  } catch (error) {
    console.error('Graph visualization generation failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate graph visualization',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}