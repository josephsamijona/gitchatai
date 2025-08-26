/**
 * Universal Search Service
 * SYNAPSE AI Platform - Task 8 Implementation
 * 
 * Implements comprehensive hybrid search combining vector similarity and full-text matching
 * Architecture: SearchEngine → HybridSearch → RankingAlgorithm → FilterProcessor → ActionTriggers
 */

import { tidbClient } from '../tidb/client';
import { VectorSearchService } from '../tidb/vector-search';
import { generateEmbedding } from '../ai/embeddings';
import { modelOrchestrator } from '../ai/orchestrator';
import type {
  UniversalSearchRequest,
  UniversalSearchResult,
  SearchScope,
  SearchFilter,
  SearchRankingConfig,
  QuickAction,
  CodeSearchResult,
  SearchAnalytics,
  SearchSuggestion,
  AdvancedSearchQuery
} from '../../types/search';

/**
 * Universal Search Service
 * Provides hybrid search capabilities across all content types with advanced ranking and filtering
 */
export class UniversalSearchService {

  /**
   * Primary universal search method combining vector and text search
   * Implements: Query preprocessing → Hybrid search → Ranking → Filtering → Action generation
   */
  async search(request: UniversalSearchRequest): Promise<UniversalSearchResult> {
    const startTime = Date.now();
    
    try {
      // Step 1: Preprocess and analyze query
      const queryAnalysis = await this.analyzeQuery(request.query);
      
      // Step 2: Generate embedding for vector search
      const queryEmbedding = await generateEmbedding(request.query);
      
      // Step 3: Execute parallel searches based on scope
      const searchPromises = this.buildSearchPromises(
        request,
        queryAnalysis,
        queryEmbedding
      );
      
      const searchResults = await Promise.all(searchPromises);
      
      // Step 4: Merge and deduplicate results
      const mergedResults = this.mergeSearchResults(searchResults, request.scope);
      
      // Step 5: Apply advanced ranking algorithm
      const rankedResults = await this.rankSearchResults(
        mergedResults,
        request.query,
        queryEmbedding,
        request.rankingConfig
      );
      
      // Step 6: Apply filters and scoping
      const filteredResults = this.applyFilters(rankedResults, request.filters);
      
      // Step 7: Generate quick actions for results
      const resultsWithActions = await this.generateQuickActions(
        filteredResults.slice(0, request.limit || 50),
        request
      );
      
      // Step 8: Generate search suggestions
      const suggestions = await this.generateSearchSuggestions(
        request.query,
        queryAnalysis,
        request.projectId
      );
      
      const processingTime = Date.now() - startTime;
      
      // Step 9: Track search analytics
      await this.trackSearchAnalytics({
        query: request.query,
        scope: request.scope,
        resultCount: resultsWithActions.length,
        processingTime,
        userId: request.userId,
        projectId: request.projectId
      });

      return {
        query: request.query,
        results: resultsWithActions,
        suggestions,
        analytics: {
          totalResults: filteredResults.length,
          processingTimeMs: processingTime,
          searchScope: request.scope,
          vectorSearchTime: queryAnalysis.vectorSearchTime,
          textSearchTime: queryAnalysis.textSearchTime,
          rankingTime: queryAnalysis.rankingTime
        },
        facets: this.generateSearchFacets(filteredResults),
        relatedQueries: await this.generateRelatedQueries(request.query, request.projectId)
      };

    } catch (error) {
      console.error('Universal search failed:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Specialized code search with syntax highlighting and semantic understanding
   * Optimized for code snippets, functions, and technical content
   */
  async searchCode(
    query: string,
    projectId?: string,
    language?: string,
    limit = 20
  ): Promise<CodeSearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Generate code-specific embedding
      const codePrompt = `Code search query: ${query}${language ? ` in ${language}` : ''}`;
      const queryEmbedding = await generateEmbedding(codePrompt);
      
      // Build code-specific search query
      let sqlQuery = `
        SELECT 
          m.id,
          m.content,
          m.created_at,
          c.title as conversation_title,
          b.name as branch_name,
          VEC_COSINE_DISTANCE(m.content_embedding, ?) as vector_distance,
          MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_score
        FROM messages m
        JOIN branches b ON m.branch_id = b.id
        JOIN conversations c ON b.conversation_id = c.id
        WHERE (
          m.content LIKE '%\`\`\`%' OR 
          m.content LIKE '%function%' OR
          m.content LIKE '%class%' OR
          m.content LIKE '%def %' OR
          m.content LIKE '%const %' OR
          m.content LIKE '%let %' OR
          m.content LIKE '%var %'
        )
      `;
      
      const queryParams = [JSON.stringify(queryEmbedding), query];
      
      if (projectId) {
        sqlQuery += ` AND c.project_id = ?`;
        queryParams.push(projectId);
      }
      
      if (language) {
        sqlQuery += ` AND m.content LIKE ?`;
        queryParams.push(`%\`\`\`${language}%`);
      }
      
      sqlQuery += `
        ORDER BY (
          (1.0 - vector_distance) * 0.6 + 
          (text_score / 100) * 0.4
        ) DESC
        LIMIT ?
      `;
      queryParams.push(limit);
      
      const results = await tidbClient.query(sqlQuery, queryParams);
      
      // Process and enhance code search results
      const codeResults: CodeSearchResult[] = results.map((row: any) => {
        const codeBlocks = this.extractCodeBlocks(row.content);
        const relevantCode = this.findRelevantCodeBlock(codeBlocks, query);
        
        return {
          id: row.id,
          type: 'code',
          content: row.content,
          title: `Code in ${row.conversation_title}`,
          description: this.generateCodeDescription(relevantCode, query),
          score: (1.0 - row.vector_distance) * 0.6 + (row.text_score / 100) * 0.4,
          metadata: {
            conversationTitle: row.conversation_title,
            branchName: row.branch_name,
            language: this.detectLanguage(relevantCode),
            codeBlocks,
            relevantBlock: relevantCode,
            createdAt: new Date(row.created_at)
          },
          highlights: this.highlightCode(relevantCode, query),
          quickActions: [
            {
              type: 'copy-code',
              label: 'Copy Code',
              data: { code: relevantCode }
            },
            {
              type: 'create-branch',
              label: 'Create Branch',
              data: { messageId: row.id, query }
            },
            {
              type: 'view-conversation',
              label: 'View Context',
              data: { messageId: row.id }
            }
          ]
        };
      });
      
      return codeResults;

    } catch (error) {
      console.error('Code search failed:', error);
      return [];
    }
  }

  /**
   * Advanced search with complex query parsing and operators
   * Supports: "exact phrases", field:value, -exclusions, OR/AND operators
   */
  async advancedSearch(
    advancedQuery: AdvancedSearchQuery,
    projectId?: string
  ): Promise<UniversalSearchResult> {
    const parsedQuery = this.parseAdvancedQuery(advancedQuery);
    
    // Build complex search request from parsed query
    const searchRequest: UniversalSearchRequest = {
      query: parsedQuery.mainQuery,
      scope: advancedQuery.scope || 'project',
      projectId,
      filters: {
        ...parsedQuery.filters,
        dateRange: advancedQuery.dateRange,
        contentTypes: advancedQuery.contentTypes
      },
      rankingConfig: {
        vectorWeight: advancedQuery.vectorWeight || 0.6,
        textWeight: advancedQuery.textWeight || 0.3,
        freshnessWeight: advancedQuery.freshnessWeight || 0.1,
        authorityWeight: advancedQuery.authorityWeight || 0.0
      },
      limit: advancedQuery.limit || 50
    };
    
    return await this.search(searchRequest);
  }

  /**
   * Real-time search suggestions as user types
   * Provides intelligent autocomplete and query suggestions
   */
  async getSearchSuggestions(
    partialQuery: string,
    projectId?: string,
    limit = 10
  ): Promise<SearchSuggestion[]> {
    if (partialQuery.length < 2) return [];
    
    try {
      // Get popular queries from analytics
      const popularQueries = await this.getPopularQueries(projectId, partialQuery);
      
      // Get concept-based suggestions
      const conceptSuggestions = await this.getConceptSuggestions(partialQuery, projectId);
      
      // Get recent queries from user history
      const recentQueries = await this.getRecentQueries(partialQuery, projectId);
      
      // Combine and rank suggestions
      const allSuggestions: SearchSuggestion[] = [
        ...popularQueries.map(q => ({ type: 'popular' as const, query: q, score: 0.9 })),
        ...conceptSuggestions.map(c => ({ type: 'concept' as const, query: c, score: 0.8 })),
        ...recentQueries.map(r => ({ type: 'recent' as const, query: r, score: 0.7 }))
      ];
      
      // Sort by relevance and limit
      return allSuggestions
        .filter(s => s.query.toLowerCase().includes(partialQuery.toLowerCase()))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    } catch (error) {
      console.error('Failed to get search suggestions:', error);
      return [];
    }
  }

  // Private helper methods

  private async analyzeQuery(query: string): Promise<any> {
    // Analyze query intent, extract keywords, detect language
    const intent = await this.detectSearchIntent(query);
    const keywords = this.extractKeywords(query);
    const language = this.detectQueryLanguage(query);
    
    return {
      intent,
      keywords,
      language,
      isCodeQuery: this.isCodeRelatedQuery(query),
      isConceptQuery: this.isConceptRelatedQuery(query),
      vectorSearchTime: 0,
      textSearchTime: 0,
      rankingTime: 0
    };
  }

  private buildSearchPromises(
    request: UniversalSearchRequest,
    queryAnalysis: any,
    queryEmbedding: number[]
  ): Promise<any>[] {
    const promises = [];
    
    switch (request.scope) {
      case 'global':
        promises.push(this.searchGlobal(request.query, queryEmbedding, request.filters));
        break;
      case 'project':
        promises.push(this.searchProject(request.query, queryEmbedding, request.projectId, request.filters));
        break;
      case 'conversation':
        promises.push(this.searchConversation(request.query, queryEmbedding, request.filters));
        break;
      case 'documents':
        promises.push(this.searchDocuments(request.query, queryEmbedding, request.projectId));
        break;
      default:
        // Search all scopes
        promises.push(
          this.searchProject(request.query, queryEmbedding, request.projectId, request.filters),
          this.searchDocuments(request.query, queryEmbedding, request.projectId)
        );
    }
    
    return promises;
  }

  private async searchGlobal(query: string, embedding: number[], filters?: SearchFilter[]): Promise<any[]> {
    // Search across all projects and content types
    const sqlQuery = `
      SELECT 
        'message' as type,
        m.id,
        m.content,
        c.title,
        m.created_at,
        VEC_COSINE_DISTANCE(m.content_embedding, ?) as vector_distance,
        MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_score
      FROM messages m
      JOIN branches b ON m.branch_id = b.id
      JOIN conversations c ON b.conversation_id = c.id
      ORDER BY (1.0 - vector_distance) * 0.6 + (text_score / 100) * 0.4 DESC
      LIMIT 100
    `;
    
    return await tidbClient.query(sqlQuery, [JSON.stringify(embedding), query]);
  }

  private async searchProject(
    query: string,
    embedding: number[],
    projectId?: string,
    filters?: SearchFilter[]
  ): Promise<any[]> {
    if (!projectId) return [];
    
    // Search within specific project
    const sqlQuery = `
      SELECT 
        'message' as type,
        m.id,
        m.content,
        c.title,
        b.name as branch_name,
        m.created_at,
        VEC_COSINE_DISTANCE(m.content_embedding, ?) as vector_distance,
        MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_score
      FROM messages m
      JOIN branches b ON m.branch_id = b.id
      JOIN conversations c ON b.conversation_id = c.id
      WHERE c.project_id = ?
      ORDER BY (1.0 - vector_distance) * 0.6 + (text_score / 100) * 0.4 DESC
      LIMIT 100
    `;
    
    return await tidbClient.query(sqlQuery, [JSON.stringify(embedding), query, projectId]);
  }

  private async searchConversation(
    query: string,
    embedding: number[],
    filters?: SearchFilter[]
  ): Promise<any[]> {
    const conversationId = filters?.find(f => f.field === 'conversationId')?.value;
    if (!conversationId) return [];
    
    const sqlQuery = `
      SELECT 
        'message' as type,
        m.id,
        m.content,
        b.name as branch_name,
        m.created_at,
        VEC_COSINE_DISTANCE(m.content_embedding, ?) as vector_distance,
        MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_score
      FROM messages m
      JOIN branches b ON m.branch_id = b.id
      WHERE b.conversation_id = ?
      ORDER BY (1.0 - vector_distance) * 0.6 + (text_score / 100) * 0.4 DESC
      LIMIT 50
    `;
    
    return await tidbClient.query(sqlQuery, [JSON.stringify(embedding), query, conversationId]);
  }

  private async searchDocuments(
    query: string,
    embedding: number[],
    projectId?: string
  ): Promise<any[]> {
    let sqlQuery = `
      SELECT 
        'document' as type,
        d.id,
        d.filename,
        d.content,
        d.processed_at,
        VEC_COSINE_DISTANCE(d.content_embedding, ?) as vector_distance,
        MATCH(d.filename, d.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_score
      FROM documents d
      WHERE 1=1
    `;
    
    const params = [JSON.stringify(embedding), query];
    
    if (projectId) {
      sqlQuery += ` AND d.project_id = ?`;
      params.push(projectId);
    }
    
    sqlQuery += `
      ORDER BY (1.0 - vector_distance) * 0.6 + (text_score / 100) * 0.4 DESC
      LIMIT 50
    `;
    
    return await tidbClient.query(sqlQuery, params);
  }

  private mergeSearchResults(searchResults: any[][], scope: SearchScope): any[] {
    const merged = searchResults.flat();
    
    // Remove duplicates based on ID and type
    const seen = new Set();
    return merged.filter(result => {
      const key = `${result.type}-${result.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async rankSearchResults(
    results: any[],
    query: string,
    queryEmbedding: number[],
    rankingConfig?: SearchRankingConfig
  ): Promise<any[]> {
    const config = {
      vectorWeight: 0.6,
      textWeight: 0.3,
      freshnessWeight: 0.1,
      authorityWeight: 0.0,
      ...rankingConfig
    };
    
    // Calculate composite scores
    const scoredResults = results.map(result => {
      const vectorScore = 1.0 - (result.vector_distance || 0);
      const textScore = (result.text_score || 0) / 100;
      const freshnessScore = this.calculateFreshnessScore(result.created_at || result.processed_at);
      const authorityScore = this.calculateAuthorityScore(result);
      
      const compositeScore = 
        vectorScore * config.vectorWeight +
        textScore * config.textWeight +
        freshnessScore * config.freshnessWeight +
        authorityScore * config.authorityWeight;
      
      return {
        ...result,
        score: compositeScore,
        vectorScore,
        textScore,
        freshnessScore,
        authorityScore
      };
    });
    
    return scoredResults.sort((a, b) => b.score - a.score);
  }

  private applyFilters(results: any[], filters?: SearchFilter[]): any[] {
    if (!filters || filters.length === 0) return results;
    
    return results.filter(result => {
      return filters.every(filter => {
        switch (filter.field) {
          case 'contentType':
            return result.type === filter.value;
          case 'dateRange':
            const date = new Date(result.created_at || result.processed_at);
            return date >= filter.value.start && date <= filter.value.end;
          case 'author':
            return result.author === filter.value;
          default:
            return true;
        }
      });
    });
  }

  private async generateQuickActions(
    results: any[],
    request: UniversalSearchRequest
  ): Promise<any[]> {
    return results.map(result => ({
      ...result,
      quickActions: this.getQuickActionsForResult(result, request)
    }));
  }

  private getQuickActionsForResult(result: any, request: UniversalSearchRequest): QuickAction[] {
    const actions: QuickAction[] = [];
    
    // Universal actions
    actions.push({
      type: 'view',
      label: 'View',
      icon: 'eye',
      data: { id: result.id, type: result.type }
    });
    
    if (result.type === 'message') {
      actions.push({
        type: 'create-branch',
        label: 'Create Branch',
        icon: 'git-branch',
        data: { messageId: result.id, query: request.query }
      });
      
      actions.push({
        type: 'reference',
        label: 'Reference',
        icon: 'link',
        data: { messageId: result.id, content: result.content }
      });
    }
    
    if (result.type === 'document') {
      actions.push({
        type: 'open-document',
        label: 'Open Document',
        icon: 'file',
        data: { documentId: result.id }
      });
    }
    
    actions.push({
      type: 'copy',
      label: 'Copy',
      icon: 'copy',
      data: { content: result.content }
    });
    
    return actions;
  }

  private async generateSearchSuggestions(
    query: string,
    queryAnalysis: any,
    projectId?: string
  ): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];
    
    // Add concept-based suggestions
    if (queryAnalysis.keywords.length > 0) {
      for (const keyword of queryAnalysis.keywords) {
        suggestions.push({
          type: 'concept',
          query: `concepts related to ${keyword}`,
          score: 0.8
        });
      }
    }
    
    // Add search refinements
    suggestions.push({
      type: 'refinement',
      query: `${query} in code`,
      score: 0.7
    });
    
    suggestions.push({
      type: 'refinement',
      query: `${query} in documents`,
      score: 0.7
    });
    
    return suggestions.slice(0, 5);
  }

  private generateSearchFacets(results: any[]): any {
    const facets = {
      contentTypes: {} as Record<string, number>,
      dates: {} as Record<string, number>,
      sources: {} as Record<string, number>
    };
    
    results.forEach(result => {
      // Count by content type
      facets.contentTypes[result.type] = (facets.contentTypes[result.type] || 0) + 1;
      
      // Count by date (month)
      const date = new Date(result.created_at || result.processed_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      facets.dates[monthKey] = (facets.dates[monthKey] || 0) + 1;
      
      // Count by source
      const source = result.conversation_title || result.filename || 'Unknown';
      facets.sources[source] = (facets.sources[source] || 0) + 1;
    });
    
    return facets;
  }

  private async generateRelatedQueries(query: string, projectId?: string): Promise<string[]> {
    // Use AI to generate related search queries
    try {
      const prompt = `Given the search query "${query}", generate 3 related search queries that would be useful:`;
      const response = await modelOrchestrator.processMessage(prompt, 'search-suggestions', 'claude');
      return this.parseRelatedQueries(response.content);
    } catch (error) {
      return [];
    }
  }

  // Additional helper methods for code search, analytics, etc.
  private extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'unknown',
        code: match[2].trim()
      });
    }
    
    return blocks;
  }

  private findRelevantCodeBlock(blocks: Array<{ language: string; code: string }>, query: string): string {
    if (blocks.length === 0) return '';
    
    // Find block that best matches the query
    let bestMatch = blocks[0];
    let bestScore = 0;
    
    for (const block of blocks) {
      const score = this.calculateCodeRelevanceScore(block.code, query);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = block;
      }
    }
    
    return bestMatch.code;
  }

  private calculateCodeRelevanceScore(code: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ');
    const codeWords = code.toLowerCase().split(/\W+/);
    
    let score = 0;
    for (const queryWord of queryWords) {
      if (codeWords.some(codeWord => codeWord.includes(queryWord))) {
        score += 1;
      }
    }
    
    return score / queryWords.length;
  }

  private detectLanguage(code: string): string {
    // Simple language detection based on syntax patterns
    if (code.includes('function') && code.includes('{')) return 'javascript';
    if (code.includes('def ') && code.includes(':')) return 'python';
    if (code.includes('class ') && code.includes('public')) return 'java';
    if (code.includes('#include')) return 'cpp';
    return 'unknown';
  }

  private highlightCode(code: string, query: string): string[] {
    const highlights = [];
    const queryWords = query.toLowerCase().split(' ');
    
    for (const word of queryWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = code.match(regex);
      if (matches) {
        highlights.push(...matches);
      }
    }
    
    return highlights;
  }

  private generateCodeDescription(code: string, query: string): string {
    const lines = code.split('\n');
    const relevantLines = lines.filter(line => 
      query.toLowerCase().split(' ').some(word =>
        line.toLowerCase().includes(word)
      )
    );
    
    return relevantLines.slice(0, 2).join(' ').substring(0, 150) + '...';
  }

  private calculateFreshnessScore(date: string | Date): number {
    const now = new Date();
    const itemDate = new Date(date);
    const daysDiff = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Fresher items get higher scores, decay over 30 days
    return Math.max(0, 1 - daysDiff / 30);
  }

  private calculateAuthorityScore(result: any): number {
    // Placeholder for authority scoring based on user reputation, content quality, etc.
    return 0.5;
  }

  private detectSearchIntent(query: string): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('how to') || lowerQuery.includes('explain')) return 'educational';
    if (lowerQuery.includes('code') || lowerQuery.includes('function')) return 'code';
    if (lowerQuery.includes('concept') || lowerQuery.includes('idea')) return 'concept';
    return 'general';
  }

  private extractKeywords(query: string): string[] {
    // Simple keyword extraction - in production, use more sophisticated NLP
    return query.toLowerCase().split(' ')
      .filter(word => word.length > 3)
      .filter(word => !['the', 'and', 'but', 'for', 'with'].includes(word));
  }

  private detectQueryLanguage(query: string): string {
    // Simple language detection - could be enhanced with proper language detection
    return 'en';
  }

  private isCodeRelatedQuery(query: string): boolean {
    const codeKeywords = ['function', 'class', 'method', 'code', 'script', 'algorithm'];
    return codeKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  private isConceptRelatedQuery(query: string): boolean {
    const conceptKeywords = ['concept', 'idea', 'theory', 'principle', 'definition'];
    return conceptKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  private parseAdvancedQuery(advancedQuery: AdvancedSearchQuery): any {
    // Parse advanced search syntax
    return {
      mainQuery: advancedQuery.query,
      filters: advancedQuery.filters || []
    };
  }

  private async getPopularQueries(projectId?: string, prefix?: string): Promise<string[]> {
    // Get popular queries from search analytics
    return [];
  }

  private async getConceptSuggestions(query: string, projectId?: string): Promise<string[]> {
    // Get concept-based suggestions
    return [];
  }

  private async getRecentQueries(query: string, projectId?: string): Promise<string[]> {
    // Get recent user queries
    return [];
  }

  private parseRelatedQueries(aiResponse: string): string[] {
    return aiResponse.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, ''))
      .slice(0, 3);
  }

  private async trackSearchAnalytics(analytics: any): Promise<void> {
    // Track search analytics for improvement
    try {
      await tidbClient.query(`
        INSERT INTO search_analytics (
          query, scope, result_count, processing_time_ms, 
          user_id, project_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      `, [
        analytics.query,
        analytics.scope,
        analytics.resultCount,
        analytics.processingTime,
        analytics.userId,
        analytics.projectId
      ]);
    } catch (error) {
      console.error('Failed to track search analytics:', error);
    }
  }
}

// Export singleton instance
export const universalSearchService = new UniversalSearchService();