/**
 * Knowledge Graph Concepts API
 * SYNAPSE AI Platform - Task 7 Implementation
 * 
 * Handles concept extraction, analytics, and management endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { knowledgeGraphService, conceptAnalyticsService } from '@/lib/services/knowledge-graph';
import type { ConceptExtractionRequest } from '@/types/knowledge';

/**
 * POST /api/knowledge/concepts
 * Extract concepts from content and build knowledge relationships
 */
export async function POST(request: NextRequest) {
  try {
    const body: ConceptExtractionRequest = await request.json();
    
    // Validate required fields
    if (!body.content || !body.projectId) {
      return NextResponse.json(
        { error: 'Content and project ID are required' },
        { status: 400 }
      );
    }

    // Extract concepts using AI-powered analysis
    const result = await knowledgeGraphService.extractConceptsFromContent(body);
    
    if (!result.success) {
      return NextResponse.json(
        { 
          error: 'Concept extraction failed', 
          details: result.error 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        conceptsExtracted: result.conceptsExtracted,
        relationshipsGenerated: result.relationshipsGenerated,
        concepts: result.concepts,
        relationships: result.relationships,
        processingTime: result.processingTimeMs,
        analytics: result.analytics
      }
    });

  } catch (error) {
    console.error('Knowledge graph concept extraction failed:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error during concept extraction',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/knowledge/concepts?projectId=xxx&analytics=true
 * Get concept analytics and insights for a project
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const includeAnalytics = searchParams.get('analytics') === 'true';
    const includeInsights = searchParams.get('insights') === 'true';
    const includeRecommendations = searchParams.get('recommendations') === 'true';

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    const results: any = {};

    // Get concept analytics if requested
    if (includeAnalytics) {
      const timeRange = {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        end: new Date()
      };
      
      results.trends = await conceptAnalyticsService.analyzeConceptTrends(projectId, timeRange);
      results.evolution = await conceptAnalyticsService.analyzeTopicEvolution(projectId);
      results.influence = await conceptAnalyticsService.calculateConceptInfluence(projectId);
    }

    // Get concept insights if requested
    if (includeInsights) {
      results.insights = await conceptAnalyticsService.generateConceptInsights(projectId);
    }

    // Get recommendations if requested  
    if (includeRecommendations) {
      results.recommendations = await conceptAnalyticsService.generateConceptRecommendations(projectId);
    }

    return NextResponse.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Knowledge graph analytics failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retrieve concept analytics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}