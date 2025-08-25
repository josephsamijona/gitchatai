/**
 * Workflow Vector Search API Routes
 * Handles hybrid vector + full-text search operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { VectorSearchService } from '../../../../lib/workflows/vector-search';
import { EmbeddingService } from '../../../../lib/ai/embeddings';
import { TiDBClient } from '../../../../lib/tidb/client';

// Initialize services
const tidbClient = new TiDBClient({
  host: process.env.TIDB_HOST || 'localhost',
  port: parseInt(process.env.TIDB_PORT || '4000'),
  user: process.env.TIDB_USER || 'root',
  password: process.env.TIDB_PASSWORD || '',
  database: process.env.TIDB_DATABASE || 'synapse',
  ssl: process.env.TIDB_SSL === 'true'
});

const embeddingService = new EmbeddingService({
  name: 'openai' as any,
  apiKey: process.env.OPENAI_API_KEY || '',
  enabled: true
});

const vectorSearchService = new VectorSearchService({
  tidbClient,
  embeddingService,
  performanceTracking: true,
  caching: {
    enabled: true,
    ttl: 300
  },
  defaultWeights: {
    vector: 0.7,
    fulltext: 0.3
  }
});

/**
 * POST /api/workflows/search - Perform hybrid vector + full-text search
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query,
      searchType = 'hybrid',
      maxResults = 20,
      contentType = 'all',
      projectId,
      similarityThreshold = 0.7,
      filters = {}
    } = body;

    if (!query) {
      return NextResponse.json({
        success: false,
        error: 'Query is required'
      }, { status: 400 });
    }

    let results;
    const searchRequest = {
      query,
      maxResults,
      similarityThreshold,
      contentType,
      projectId,
      filters
    };

    // Execute appropriate search type
    switch (searchType) {
      case 'vector':
        results = await vectorSearchService.vectorSearch(searchRequest);
        break;
      case 'fulltext':
        results = await vectorSearchService.fulltextSearch(searchRequest);
        break;
      case 'hybrid':
        results = await vectorSearchService.hybridSearch(searchRequest);
        break;
      case 'semantic':
        results = await vectorSearchService.semanticSearch({
          ...searchRequest,
          expandConcepts: true
        });
        break;
      case 'multi-source':
        results = await vectorSearchService.multiSourceSearch({
          ...searchRequest,
          sources: filters.sources || ['messages', 'documents', 'concepts']
        });
        break;
      default:
        return NextResponse.json({
          success: false,
          error: `Unsupported search type: ${searchType}`
        }, { status: 400 });
    }

    // Get performance analytics
    const analytics = vectorSearchService.getPerformanceAnalytics();

    return NextResponse.json({
      success: true,
      results,
      metadata: {
        searchType,
        query,
        resultCount: results.length,
        analytics: {
          totalSearches: analytics.totalSearches,
          averageLatency: analytics.averageLatency,
          cacheHitRate: analytics.cacheHitRate
        },
        tidbMetrics: analytics.tidbPerformanceMetrics
      }
    });

  } catch (error) {
    console.error('Search operation failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Search operation failed'
    }, { status: 500 });
  }
}

/**
 * GET /api/workflows/search/suggestions - Get search suggestions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const projectId = searchParams.get('projectId');

    if (!query) {
      return NextResponse.json({
        success: false,
        error: 'Query parameter is required'
      }, { status: 400 });
    }

    const suggestions = await vectorSearchService.getSearchSuggestions(
      query,
      projectId || undefined
    );

    return NextResponse.json({
      success: true,
      suggestions,
      metadata: {
        query,
        suggestionCount: suggestions.length
      }
    });

  } catch (error) {
    console.error('Failed to get search suggestions:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get search suggestions'
    }, { status: 500 });
  }
}