/**
 * Universal Search API
 * SYNAPSE AI Platform - Task 8 Implementation
 * 
 * Handles universal search requests with hybrid vector + text search capabilities
 */

import { NextRequest, NextResponse } from 'next/server';
import { universalSearchService } from '@/lib/services/universal-search';
import type { UniversalSearchRequest } from '@/types/search';

/**
 * POST /api/search/universal
 * Execute universal search with hybrid capabilities
 */
export async function POST(request: NextRequest) {
  try {
    const body: UniversalSearchRequest = await request.json();
    
    // Validate required fields
    if (!body.query || body.query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    // Set default values
    const searchRequest: UniversalSearchRequest = {
      query: body.query.trim(),
      scope: body.scope || 'project',
      projectId: body.projectId,
      userId: body.userId,
      filters: body.filters || [],
      rankingConfig: {
        vectorWeight: 0.6,
        textWeight: 0.3,
        freshnessWeight: 0.1,
        authorityWeight: 0.0,
        ...body.rankingConfig
      },
      limit: Math.min(body.limit || 50, 100) // Cap at 100 results
    };

    // Execute search
    const searchResult = await universalSearchService.search(searchRequest);
    
    return NextResponse.json({
      success: true,
      data: searchResult
    });

  } catch (error) {
    console.error('Universal search failed:', error);
    return NextResponse.json(
      { 
        error: 'Search request failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/search/universal/suggestions?q=query&projectId=xxx&limit=10
 * Get real-time search suggestions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const projectId = searchParams.get('projectId');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!query || query.length < 2) {
      return NextResponse.json({ 
        success: true, 
        data: { suggestions: [] }
      });
    }

    const suggestions = await universalSearchService.getSearchSuggestions(
      query,
      projectId || undefined,
      Math.min(limit, 20) // Cap at 20 suggestions
    );
    
    return NextResponse.json({
      success: true,
      data: { suggestions }
    });

  } catch (error) {
    console.error('Search suggestions failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get search suggestions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}