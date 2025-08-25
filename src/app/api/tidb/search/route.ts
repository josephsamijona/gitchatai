import { NextRequest, NextResponse } from 'next/server';
import { VectorSearchService } from '@/lib/tidb';

/**
 * TiDB Vector Search API Route
 * POST /api/tidb/search - Perform vector search across content types
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      query, 
      embedding, 
      projectId, 
      searchType = 'universal',
      limit = 20 
    } = body;

    if (!query || !embedding) {
      return NextResponse.json({
        success: false,
        error: 'Query and embedding are required'
      }, {
        status: 400
      });
    }

    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      return NextResponse.json({
        success: false,
        error: 'Embedding must be an array of 1536 numbers'
      }, {
        status: 400
      });
    }

    const startTime = Date.now();
    let results: any[] = [];

    switch (searchType) {
      case 'messages':
        results = await VectorSearchService.hybridSearchMessages(
          query,
          embedding,
          { projectId },
          { limit }
        );
        break;

      case 'documents':
        results = await VectorSearchService.hybridSearchDocuments(
          query,
          embedding,
          { projectId },
          { limit }
        );
        break;

      case 'concepts':
        results = await VectorSearchService.hybridSearchConcepts(
          query,
          embedding,
          { projectId },
          { limit }
        );
        break;

      case 'universal':
      default:
        results = await VectorSearchService.universalSearch(
          query,
          embedding,
          { projectId },
          { limit }
        );
        break;
    }

    const executionTime = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      query,
      searchType,
      results,
      metadata: {
        resultCount: results.length,
        executionTimeMs: executionTime,
        projectId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Vector search failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Vector search failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, {
      status: 500
    });
  }
}