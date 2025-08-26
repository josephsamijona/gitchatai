/**
 * Advanced Search API
 * SYNAPSE AI Platform - Task 8 Implementation
 * 
 * Handles advanced search with complex query parsing and operators
 */

import { NextRequest, NextResponse } from 'next/server';
import { universalSearchService } from '@/lib/services/universal-search';
import type { AdvancedSearchQuery } from '@/types/search';

/**
 * POST /api/search/advanced
 * Execute advanced search with complex query operators
 */
export async function POST(request: NextRequest) {
  try {
    const body: AdvancedSearchQuery = await request.json();
    
    // Validate required fields
    if (!body.query || body.query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Advanced search query is required' },
        { status: 400 }
      );
    }

    // Execute advanced search
    const searchResult = await universalSearchService.advancedSearch(
      body,
      body.projectId
    );
    
    return NextResponse.json({
      success: true,
      data: {
        ...searchResult,
        searchType: 'advanced',
        queryOperators: parseQueryOperators(body.query)
      }
    });

  } catch (error) {
    console.error('Advanced search failed:', error);
    return NextResponse.json(
      { 
        error: 'Advanced search request failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function parseQueryOperators(query: string): any {
  return {
    hasExactPhrases: query.includes('"'),
    hasFieldFilters: query.includes(':'),
    hasExclusions: query.includes('-'),
    hasBooleanOperators: query.toUpperCase().includes('AND') || query.toUpperCase().includes('OR'),
    complexity: calculateQueryComplexity(query)
  };
}

function calculateQueryComplexity(query: string): 'simple' | 'moderate' | 'complex' {
  let complexity = 0;
  
  if (query.includes('"')) complexity += 1; // Exact phrases
  if (query.includes(':')) complexity += 1; // Field filters
  if (query.includes('-')) complexity += 1; // Exclusions
  if (query.toUpperCase().includes('AND') || query.toUpperCase().includes('OR')) complexity += 2; // Boolean operators
  
  if (complexity === 0) return 'simple';
  if (complexity <= 2) return 'moderate';
  return 'complex';
}