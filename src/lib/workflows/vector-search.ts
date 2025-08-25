/**
 * Enhanced Vector Search Service for SYNAPSE AI Platform
 * Combines TiDB Serverless vector search with full-text search for optimal results
 * Demonstrates hackathon requirements: hybrid search, performance optimization, real-time analytics
 */

import type {
  VectorSearchRequest,
  VectorSearchResult,
  HybridSearchConfig,
  SearchFilters,
  SearchAnalytics,
  TiDBPerformanceMetrics
} from '../../types/workflow';

import { TiDBClient } from '../tidb/client';
import { EmbeddingService } from '../ai/embeddings';

export interface VectorSearchServiceConfig {
  tidbClient: TiDBClient;
  embeddingService: EmbeddingService;
  performanceTracking: boolean;
  caching: {
    enabled: boolean;
    ttl: number; // seconds
  };
  defaultWeights: {
    vector: number;
    fulltext: number;
  };
}

export class VectorSearchService {
  private searchCache = new Map<string, { result: VectorSearchResult[]; timestamp: number }>();
  private performanceMetrics: SearchAnalytics = {
    totalSearches: 0,
    averageLatency: 0,
    cacheHitRate: 0,
    vectorSearches: 0,
    fulltextSearches: 0,
    hybridSearches: 0,
    tidbPerformanceMetrics: {
      averageQueryTime: 0,
      vectorOperations: 0,
      fulltextOperations: 0,
      indexHits: 0
    }
  };

  constructor(private config: VectorSearchServiceConfig) {}

  /**
   * Hybrid search combining vector similarity and full-text search
   * This is a core hackathon demonstration feature
   */
  async hybridSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const startTime = Date.now();
    const searchId = this.generateSearchId(request);

    try {
      // Check cache first
      if (this.config.caching.enabled) {
        const cached = this.getCachedResult(searchId);
        if (cached) {
          this.updateCacheMetrics(true);
          return cached;
        }
      }

      // Generate query embedding for vector search
      const queryEmbedding = await this.config.embeddingService.generateSingleEmbedding(
        request.query,
        'text-embedding-3-small'
      );

      // Execute parallel search operations
      const [vectorResults, fulltextResults] = await Promise.all([
        this.executeVectorSearch(request, queryEmbedding),
        this.executeFulltextSearch(request)
      ]);

      // Combine and rank results
      const hybridResults = this.combineAndRankResults(
        vectorResults,
        fulltextResults,
        request.hybridConfig || {
          vectorWeight: this.config.defaultWeights.vector,
          fulltextWeight: this.config.defaultWeights.fulltext,
          normalizeScores: true,
          minCombinedScore: 0.3
        }
      );

      // Apply filters and limits
      const filteredResults = this.applyFilters(hybridResults, request.filters);
      const finalResults = filteredResults.slice(0, request.maxResults || 20);

      // Cache results
      if (this.config.caching.enabled) {
        this.cacheResult(searchId, finalResults);
        this.updateCacheMetrics(false);
      }

      // Update performance metrics
      await this.updatePerformanceMetrics('hybrid', Date.now() - startTime);

      // Add search metadata
      const resultsWithMetadata = this.addSearchMetadata(finalResults, {
        searchType: 'hybrid',
        processingTime: Date.now() - startTime,
        vectorResults: vectorResults.length,
        fulltextResults: fulltextResults.length,
        combinedResults: hybridResults.length,
        queryEmbedding: queryEmbedding.slice(0, 5), // Sample for debugging
        tidbMetrics: await this.getTiDBMetrics()
      });

      return resultsWithMetadata;

    } catch (error) {
      console.error('Hybrid search failed:', error);
      throw new Error(`Hybrid search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Pure vector similarity search using TiDB VECTOR operations
   */
  async vectorSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const startTime = Date.now();

    try {
      const queryEmbedding = await this.config.embeddingService.generateSingleEmbedding(request.query);
      const results = await this.executeVectorSearch(request, queryEmbedding);
      
      await this.updatePerformanceMetrics('vector', Date.now() - startTime);
      return this.addSearchMetadata(results, {
        searchType: 'vector',
        processingTime: Date.now() - startTime,
        queryEmbedding: queryEmbedding.slice(0, 5)
      });

    } catch (error) {
      throw new Error(`Vector search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Full-text search using TiDB FULLTEXT indexes
   */
  async fulltextSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const startTime = Date.now();

    try {
      const results = await this.executeFulltextSearch(request);
      
      await this.updatePerformanceMetrics('fulltext', Date.now() - startTime);
      return this.addSearchMetadata(results, {
        searchType: 'fulltext',
        processingTime: Date.now() - startTime
      });

    } catch (error) {
      throw new Error(`Fulltext search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Multi-source search across different content types
   */
  async multiSourceSearch(request: VectorSearchRequest & { sources: string[] }): Promise<VectorSearchResult[]> {
    const searchPromises = request.sources.map(async (source) => {
      const sourceRequest = { ...request, contentType: source };
      return this.hybridSearch(sourceRequest);
    });

    const sourceResults = await Promise.all(searchPromises);
    const combinedResults = sourceResults.flat();

    // Re-rank combined results from multiple sources
    return this.rankMultiSourceResults(combinedResults, request);
  }

  /**
   * Semantic search with concept expansion
   */
  async semanticSearch(request: VectorSearchRequest & { expandConcepts?: boolean }): Promise<VectorSearchResult[]> {
    let searchQuery = request.query;

    // Expand query with related concepts if requested
    if (request.expandConcepts) {
      const relatedConcepts = await this.findRelatedConcepts(request.query, request.projectId);
      if (relatedConcepts.length > 0) {
        searchQuery = `${request.query} ${relatedConcepts.join(' ')}`;
      }
    }

    return this.hybridSearch({ ...request, query: searchQuery });
  }

  /**
   * Get search performance analytics for hackathon demo
   */
  getPerformanceAnalytics(): SearchAnalytics {
    return { ...this.performanceMetrics };
  }

  /**
   * Search suggestions based on partial query
   */
  async getSearchSuggestions(partialQuery: string, projectId?: string): Promise<string[]> {
    if (partialQuery.length < 2) return [];

    try {
      const suggestions = await this.config.tidbClient.query(
        `
        SELECT DISTINCT 
          CASE 
            WHEN content LIKE ? THEN SUBSTRING(content, LOCATE(?, content), 100)
            WHEN title LIKE ? THEN title
            ELSE name 
          END as suggestion
        FROM (
          SELECT content, NULL as title, NULL as name FROM messages WHERE content LIKE ? AND (? IS NULL OR project_id = ?)
          UNION ALL
          SELECT NULL as content, title, NULL as name FROM conversations WHERE title LIKE ? AND (? IS NULL OR project_id = ?)
          UNION ALL
          SELECT NULL as content, NULL as title, name FROM concepts WHERE name LIKE ? AND (? IS NULL OR project_id = ?)
        ) suggestions
        WHERE suggestion IS NOT NULL
        ORDER BY LENGTH(suggestion)
        LIMIT 10
        `,
        [
          `%${partialQuery}%`, partialQuery, `%${partialQuery}%`,
          `%${partialQuery}%`, projectId, projectId,
          `%${partialQuery}%`, projectId, projectId,
          `%${partialQuery}%`, projectId, projectId
        ]
      );

      return suggestions.map((row: any) => row.suggestion);
    } catch (error) {
      console.warn('Failed to get search suggestions:', error);
      return [];
    }
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.searchCache.clear();
  }

  /**
   * Private implementation methods
   */
  private async executeVectorSearch(request: VectorSearchRequest, queryEmbedding: number[]): Promise<VectorSearchResult[]> {
    const embeddingVector = `[${queryEmbedding.join(',')}]`;
    const similarityThreshold = request.similarityThreshold || 0.7;
    
    let query = '';
    let params: any[] = [];

    switch (request.contentType || 'all') {
      case 'messages':
        query = `
          SELECT 
            m.id,
            m.content,
            m.role,
            m.model,
            m.created_at,
            b.name as branch_name,
            c.title as conversation_title,
            VEC_COSINE_DISTANCE(m.content_embedding, ?) as similarity,
            'message' as content_type
          FROM messages m
          JOIN branches b ON m.branch_id = b.id
          JOIN conversations c ON b.conversation_id = c.id
          WHERE VEC_COSINE_DISTANCE(m.content_embedding, ?) < ?
          ${request.projectId ? 'AND c.project_id = ?' : ''}
          ORDER BY similarity
          LIMIT ?
        `;
        params = [embeddingVector, embeddingVector, 1 - similarityThreshold];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      case 'documents':
        query = `
          SELECT 
            d.id,
            d.filename,
            d.content,
            d.metadata,
            d.processed_at,
            VEC_COSINE_DISTANCE(d.content_embedding, ?) as similarity,
            'document' as content_type
          FROM documents d
          WHERE VEC_COSINE_DISTANCE(d.content_embedding, ?) < ?
          ${request.projectId ? 'AND d.project_id = ?' : ''}
          ORDER BY similarity
          LIMIT ?
        `;
        params = [embeddingVector, embeddingVector, 1 - similarityThreshold];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      case 'concepts':
        query = `
          SELECT 
            c.id,
            c.name,
            c.description,
            c.mention_count,
            c.created_at,
            VEC_COSINE_DISTANCE(c.concept_embedding, ?) as similarity,
            'concept' as content_type
          FROM concepts c
          WHERE VEC_COSINE_DISTANCE(c.concept_embedding, ?) < ?
          ${request.projectId ? 'AND c.project_id = ?' : ''}
          ORDER BY similarity
          LIMIT ?
        `;
        params = [embeddingVector, embeddingVector, 1 - similarityThreshold];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      default: // 'all'
        query = `
          SELECT * FROM (
            SELECT 
              m.id,
              m.content,
              m.created_at,
              VEC_COSINE_DISTANCE(m.content_embedding, ?) as similarity,
              'message' as content_type,
              b.name as context_name
            FROM messages m
            JOIN branches b ON m.branch_id = b.id
            JOIN conversations c ON b.conversation_id = c.id
            WHERE VEC_COSINE_DISTANCE(m.content_embedding, ?) < ?
            ${request.projectId ? 'AND c.project_id = ?' : ''}
            
            UNION ALL
            
            SELECT 
              d.id,
              d.content,
              d.processed_at as created_at,
              VEC_COSINE_DISTANCE(d.content_embedding, ?) as similarity,
              'document' as content_type,
              d.filename as context_name
            FROM documents d
            WHERE VEC_COSINE_DISTANCE(d.content_embedding, ?) < ?
            ${request.projectId ? 'AND d.project_id = ?' : ''}
            
            UNION ALL
            
            SELECT 
              c.id,
              c.description as content,
              c.created_at,
              VEC_COSINE_DISTANCE(c.concept_embedding, ?) as similarity,
              'concept' as content_type,
              c.name as context_name
            FROM concepts c
            WHERE VEC_COSINE_DISTANCE(c.concept_embedding, ?) < ?
            ${request.projectId ? 'AND c.project_id = ?' : ''}
          ) combined_results
          ORDER BY similarity
          LIMIT ?
        `;
        
        params = [
          embeddingVector, embeddingVector, 1 - similarityThreshold,
          embeddingVector, embeddingVector, 1 - similarityThreshold,
          embeddingVector, embeddingVector, 1 - similarityThreshold
        ];
        
        if (request.projectId) {
          params.splice(3, 0, request.projectId);
          params.splice(7, 0, request.projectId);
          params.splice(11, 0, request.projectId);
        }
        
        params.push(request.maxResults || 20);
        break;
    }

    const results = await this.config.tidbClient.query(query, params);
    
    return results.map((row: any) => ({
      id: row.id,
      content: row.content || row.description,
      contentType: row.content_type,
      score: 1 - row.similarity, // Convert distance to similarity score
      metadata: {
        ...row,
        searchType: 'vector',
        similarity: 1 - row.similarity
      }
    }));
  }

  private async executeFulltextSearch(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    let query = '';
    let params: any[] = [];

    const searchTerms = request.query.split(' ').filter(term => term.length > 2).join(' ');
    if (!searchTerms) return [];

    switch (request.contentType || 'all') {
      case 'messages':
        query = `
          SELECT 
            m.id,
            m.content,
            m.role,
            m.model,
            m.created_at,
            b.name as branch_name,
            c.title as conversation_title,
            MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
            'message' as content_type
          FROM messages m
          JOIN branches b ON m.branch_id = b.id
          JOIN conversations c ON b.conversation_id = c.id
          WHERE MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE)
          ${request.projectId ? 'AND c.project_id = ?' : ''}
          ORDER BY relevance DESC
          LIMIT ?
        `;
        params = [searchTerms, searchTerms];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      case 'documents':
        query = `
          SELECT 
            d.id,
            d.filename,
            d.content,
            d.metadata,
            d.processed_at,
            MATCH(d.filename, d.content) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
            'document' as content_type
          FROM documents d
          WHERE MATCH(d.filename, d.content) AGAINST(? IN NATURAL LANGUAGE MODE)
          ${request.projectId ? 'AND d.project_id = ?' : ''}
          ORDER BY relevance DESC
          LIMIT ?
        `;
        params = [searchTerms, searchTerms];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      case 'concepts':
        query = `
          SELECT 
            c.id,
            c.name,
            c.description,
            c.mention_count,
            c.created_at,
            MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
            'concept' as content_type
          FROM concepts c
          WHERE MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE)
          ${request.projectId ? 'AND c.project_id = ?' : ''}
          ORDER BY relevance DESC
          LIMIT ?
        `;
        params = [searchTerms, searchTerms];
        if (request.projectId) params.push(request.projectId);
        params.push(request.maxResults || 20);
        break;

      default: // 'all'
        query = `
          SELECT * FROM (
            SELECT 
              m.id,
              m.content,
              m.created_at,
              MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
              'message' as content_type,
              b.name as context_name
            FROM messages m
            JOIN branches b ON m.branch_id = b.id
            JOIN conversations c ON b.conversation_id = c.id
            WHERE MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE)
            ${request.projectId ? 'AND c.project_id = ?' : ''}
            
            UNION ALL
            
            SELECT 
              d.id,
              d.content,
              d.processed_at as created_at,
              MATCH(d.filename, d.content) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
              'document' as content_type,
              d.filename as context_name
            FROM documents d
            WHERE MATCH(d.filename, d.content) AGAINST(? IN NATURAL LANGUAGE MODE)
            ${request.projectId ? 'AND d.project_id = ?' : ''}
            
            UNION ALL
            
            SELECT 
              c.id,
              c.description as content,
              c.created_at,
              MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance,
              'concept' as content_type,
              c.name as context_name
            FROM concepts c
            WHERE MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE)
            ${request.projectId ? 'AND c.project_id = ?' : ''}
          ) combined_results
          WHERE relevance > 0
          ORDER BY relevance DESC
          LIMIT ?
        `;
        
        params = [searchTerms, searchTerms, searchTerms, searchTerms, searchTerms, searchTerms];
        
        if (request.projectId) {
          params.splice(2, 0, request.projectId);
          params.splice(6, 0, request.projectId);
          params.splice(10, 0, request.projectId);
        }
        
        params.push(request.maxResults || 20);
        break;
    }

    const results = await this.config.tidbClient.query(query, params);
    
    return results.map((row: any) => ({
      id: row.id,
      content: row.content || row.description,
      contentType: row.content_type,
      score: row.relevance,
      metadata: {
        ...row,
        searchType: 'fulltext',
        relevance: row.relevance
      }
    }));
  }

  private combineAndRankResults(
    vectorResults: VectorSearchResult[],
    fulltextResults: VectorSearchResult[],
    config: HybridSearchConfig
  ): VectorSearchResult[] {
    const combinedResults = new Map<string, VectorSearchResult>();

    // Add vector results
    for (const result of vectorResults) {
      const normalizedScore = config.normalizeScores ? this.normalizeScore(result.score, 0, 1) : result.score;
      combinedResults.set(result.id, {
        ...result,
        score: normalizedScore * config.vectorWeight,
        metadata: {
          ...result.metadata,
          vectorScore: normalizedScore,
          fulltextScore: 0,
          combinedScore: normalizedScore * config.vectorWeight
        }
      });
    }

    // Add/merge fulltext results
    for (const result of fulltextResults) {
      const normalizedScore = config.normalizeScores ? this.normalizeScore(result.score, 0, 10) : result.score;
      const existing = combinedResults.get(result.id);
      
      if (existing) {
        // Merge scores
        const combinedScore = existing.score + (normalizedScore * config.fulltextWeight);
        existing.score = combinedScore;
        existing.metadata.fulltextScore = normalizedScore;
        existing.metadata.combinedScore = combinedScore;
      } else {
        // Add new result
        combinedResults.set(result.id, {
          ...result,
          score: normalizedScore * config.fulltextWeight,
          metadata: {
            ...result.metadata,
            vectorScore: 0,
            fulltextScore: normalizedScore,
            combinedScore: normalizedScore * config.fulltextWeight
          }
        });
      }
    }

    // Filter by minimum score and sort
    return Array.from(combinedResults.values())
      .filter(result => result.score >= (config.minCombinedScore || 0))
      .sort((a, b) => b.score - a.score);
  }

  private normalizeScore(score: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }

  private applyFilters(results: VectorSearchResult[], filters?: SearchFilters): VectorSearchResult[] {
    if (!filters) return results;

    let filtered = results;

    if (filters.contentTypes?.length) {
      filtered = filtered.filter(result => filters.contentTypes!.includes(result.contentType));
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      filtered = filtered.filter(result => {
        const date = new Date(result.metadata.created_at);
        return (!start || date >= start) && (!end || date <= end);
      });
    }

    if (filters.minScore) {
      filtered = filtered.filter(result => result.score >= filters.minScore!);
    }

    return filtered;
  }

  private rankMultiSourceResults(results: VectorSearchResult[], request: VectorSearchRequest): VectorSearchResult[] {
    // Apply source-specific scoring and re-rank
    return results
      .map(result => ({
        ...result,
        score: this.adjustScoreBySource(result.score, result.contentType)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, request.maxResults || 20);
  }

  private adjustScoreBySource(score: number, contentType: string): number {
    // Give slight preference to different content types based on context
    const adjustments: Record<string, number> = {
      'message': 1.0,
      'document': 1.1,
      'concept': 0.9
    };
    
    return score * (adjustments[contentType] || 1.0);
  }

  private async findRelatedConcepts(query: string, projectId?: string): Promise<string[]> {
    try {
      const queryEmbedding = await this.config.embeddingService.generateSingleEmbedding(query);
      const embeddingVector = `[${queryEmbedding.join(',')}]`;
      
      const results = await this.config.tidbClient.query(
        `
        SELECT name
        FROM concepts
        WHERE VEC_COSINE_DISTANCE(concept_embedding, ?) < 0.8
        ${projectId ? 'AND project_id = ?' : ''}
        ORDER BY VEC_COSINE_DISTANCE(concept_embedding, ?)
        LIMIT 5
        `,
        projectId ? [embeddingVector, projectId, embeddingVector] : [embeddingVector, embeddingVector]
      );

      return results.map((row: any) => row.name);
    } catch (error) {
      console.warn('Failed to find related concepts:', error);
      return [];
    }
  }

  private addSearchMetadata(results: VectorSearchResult[], metadata: any): VectorSearchResult[] {
    return results.map(result => ({
      ...result,
      metadata: {
        ...result.metadata,
        searchMetadata: metadata
      }
    }));
  }

  private generateSearchId(request: VectorSearchRequest): string {
    const key = `${request.query}_${request.contentType || 'all'}_${request.projectId || 'global'}_${request.maxResults || 20}`;
    return Buffer.from(key).toString('base64');
  }

  private getCachedResult(searchId: string): VectorSearchResult[] | null {
    const cached = this.searchCache.get(searchId);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > (this.config.caching.ttl * 1000);
    if (isExpired) {
      this.searchCache.delete(searchId);
      return null;
    }

    return cached.result;
  }

  private cacheResult(searchId: string, result: VectorSearchResult[]): void {
    this.searchCache.set(searchId, {
      result,
      timestamp: Date.now()
    });

    // Clean old cache entries if needed
    if (this.searchCache.size > 1000) {
      const entries = Array.from(this.searchCache.entries());
      const sortedByAge = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = sortedByAge.slice(0, 200); // Remove oldest 200 entries
      
      for (const [key] of toDelete) {
        this.searchCache.delete(key);
      }
    }
  }

  private updateCacheMetrics(hit: boolean): void {
    this.performanceMetrics.totalSearches++;
    const oldHits = this.performanceMetrics.cacheHitRate * (this.performanceMetrics.totalSearches - 1);
    const newHits = hit ? oldHits + 1 : oldHits;
    this.performanceMetrics.cacheHitRate = newHits / this.performanceMetrics.totalSearches;
  }

  private async updatePerformanceMetrics(searchType: 'vector' | 'fulltext' | 'hybrid', latency: number): Promise<void> {
    this.performanceMetrics.totalSearches++;
    
    // Update average latency
    const oldTotal = this.performanceMetrics.averageLatency * (this.performanceMetrics.totalSearches - 1);
    this.performanceMetrics.averageLatency = (oldTotal + latency) / this.performanceMetrics.totalSearches;

    // Update search type counters
    switch (searchType) {
      case 'vector':
        this.performanceMetrics.vectorSearches++;
        break;
      case 'fulltext':
        this.performanceMetrics.fulltextSearches++;
        break;
      case 'hybrid':
        this.performanceMetrics.hybridSearches++;
        break;
    }

    // Update TiDB performance metrics if tracking enabled
    if (this.config.performanceTracking) {
      const tidbMetrics = await this.getTiDBMetrics();
      this.performanceMetrics.tidbPerformanceMetrics = tidbMetrics;
    }
  }

  private async getTiDBMetrics(): Promise<TiDBPerformanceMetrics> {
    try {
      const metrics = await this.config.tidbClient.getPerformanceMetrics();
      return {
        averageQueryTime: metrics.averageQueryTime || 0,
        vectorOperations: metrics.vectorOperations || 0,
        fulltextOperations: metrics.fulltextOperations || 0,
        indexHits: metrics.indexHits || 0
      };
    } catch (error) {
      console.warn('Failed to get TiDB metrics:', error);
      return {
        averageQueryTime: 0,
        vectorOperations: 0,
        fulltextOperations: 0,
        indexHits: 0
      };
    }
  }
}