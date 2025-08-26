/**
 * Code Search API
 * SYNAPSE AI Platform - Task 8 Implementation
 * 
 * Specialized search for code snippets with syntax highlighting and semantic understanding
 */

import { NextRequest, NextResponse } from 'next/server';
import { universalSearchService } from '@/lib/services/universal-search';

/**
 * POST /api/search/code
 * Execute specialized code search
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, projectId, language, limit = 20 } = body;
    
    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Code search query is required' },
        { status: 400 }
      );
    }

    // Execute code search
    const codeResults = await universalSearchService.searchCode(
      query.trim(),
      projectId,
      language,
      Math.min(limit, 50) // Cap at 50 results for performance
    );
    
    return NextResponse.json({
      success: true,
      data: {
        query: query.trim(),
        results: codeResults,
        totalResults: codeResults.length,
        language: language || 'auto-detect',
        searchType: 'code'
      }
    });

  } catch (error) {
    console.error('Code search failed:', error);
    return NextResponse.json(
      { 
        error: 'Code search request failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/search/code/languages?projectId=xxx
 * Get available programming languages in project
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    // Query to find languages used in code blocks
    const languages = await getAvailableLanguages(projectId);
    
    return NextResponse.json({
      success: true,
      data: { languages }
    });

  } catch (error) {
    console.error('Failed to get available languages:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get available languages',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function getAvailableLanguages(projectId?: string): Promise<string[]> {
  // This would query the database to find distinct languages used
  // For now, return common languages
  return [
    'javascript',
    'typescript',
    'python',
    'java',
    'cpp',
    'c',
    'go',
    'rust',
    'php',
    'ruby',
    'sql',
    'html',
    'css'
  ];
}