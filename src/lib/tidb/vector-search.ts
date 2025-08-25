import { tidbClient, VectorSearchResult, TiDBError, TiDBErrorType } from './client';

/**
 * Vector search utilities with VEC_COSINE_DISTANCE operations
 * Optimized for TiDB Serverless vector capabilities
 */

export interface SearchFilters {
  projectId?: string;
  conversationId?: string;
  branchId?: string;
  model?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  contentType?: 'message' | 'document' | 'concept';
}

export interface HybridSearchOptions {
  vectorWeight?: number;
  textWeight?: number;
  similarityThreshold?: number;
  limit?: number;
  includeMetadata?: boolean;
}

export interface SearchResult extends VectorSearchResult {
  score: number;
  highlights?: string[];
  context?: string;
}

/**
 * Vector Search Service
 */
export class VectorSearchService {
  /**
   * Search messages by vector similarity
   */
  static async searchMessages(
    embedding: number[],
    filters: SearchFilters = {},
    limit = 20,
    similarityThreshold = 0.3
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Build dynamic WHERE clause
      const conditions: string[] = ['VEC_COSINE_DISTANCE(m.content_embedding, ?) < ?'];
      const params: any[] = [JSON.stringify(embedding), similarityThreshold];

      if (filters.projectId) {
        conditions.push('c.project_id = ?');
        params.push(filters.projectId);
      }

      if (filters.conversationId) {
        conditions.push('b.conversation_id = ?');
        params.push(filters.conversationId);
      }

      if (filters.branchId) {
        conditions.push('m.branch_id = ?');
        params.push(filters.branchId);
      }

      if (filters.model) {
        conditions.push('(m.model = ? OR b.model = ?)');
        params.push(filters.model, filters.model);
      }

      if (filters.dateRange) {
        conditions.push('m.created_at BETWEEN ? AND ?');
        params.push(filters.dateRange.start, filters.dateRange.end);
      }

      const sql = `
        SELECT 
          m.id,
          m.content,
          m.role,
          m.model,
          m.created_at,
          VEC_COSINE_DISTANCE(m.content_embedding, ?) as similarity,
          (1 - VEC_COSINE_DISTANCE(m.content_embedding, ?)) as score,
          'message' as type,
          JSON_OBJECT(
            'branchId', b.id,
            'branchName', b.name,
            'conversationId', c.id,
            'conversationTitle', c.title,
            'projectId', c.project_id,
            'tokenCount', m.token_count,
            'processingTime', m.processing_time_ms
          ) as metadata
        FROM messages m
        JOIN branches b ON m.branch_id = b.id
        JOIN conversations c ON b.conversation_id = c.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY similarity ASC
        LIMIT ?
      `;

      // Add embedding parameter for SELECT and score calculation
      const finalParams = [
        JSON.stringify(embedding), // For similarity calculation
        JSON.stringify(embedding), // For score calculation
        ...params,
        limit
      ];

      const result = await tidbClient.query<SearchResult>(sql, finalParams);
      const executionTime = Date.now() - startTime;

      console.log(`Message vector search completed in ${executionTime}ms, found ${result.rows.length} results`);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Message vector search failed', error);
    }
  }

  /**
   * Search documents by vector similarity
   */
  static async searchDocuments(
    embedding: number[],
    filters: SearchFilters = {},
    limit = 20,
    similarityThreshold = 0.3
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      const conditions: string[] = ['VEC_COSINE_DISTANCE(d.content_embedding, ?) < ?'];
      const params: any[] = [JSON.stringify(embedding), similarityThreshold];

      if (filters.projectId) {
        conditions.push('d.project_id = ?');
        params.push(filters.projectId);
      }

      if (filters.dateRange) {
        conditions.push('d.processed_at BETWEEN ? AND ?');
        params.push(filters.dateRange.start, filters.dateRange.end);
      }

      const sql = `
        SELECT 
          d.id,
          d.filename,
          SUBSTRING(d.content, 1, 500) as content,
          d.mime_type,
          d.file_size,
          d.processed_at as created_at,
          VEC_COSINE_DISTANCE(d.content_embedding, ?) as similarity,
          (1 - VEC_COSINE_DISTANCE(d.content_embedding, ?)) as score,
          'document' as type,
          JSON_OBJECT(
            'projectId', d.project_id,
            'filename', d.filename,
            'mimeType', d.mime_type,
            'fileSize', d.file_size,
            's3Key', d.s3_key,
            'metadata', d.metadata
          ) as metadata
        FROM documents d
        WHERE ${conditions.join(' AND ')}
        ORDER BY similarity ASC
        LIMIT ?
      `;

      const finalParams = [
        JSON.stringify(embedding), // For similarity calculation
        JSON.stringify(embedding), // For score calculation
        ...params,
        limit
      ];

      const result = await tidbClient.query<SearchResult>(sql, finalParams);
      const executionTime = Date.now() - startTime;

      console.log(`Document vector search completed in ${executionTime}ms, found ${result.rows.length} results`);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Document vector search failed', error);
    }
  }

  /**
   * Search concepts by vector similarity
   */
  static async searchConcepts(
    embedding: number[],
    filters: SearchFilters = {},
    limit = 20,
    similarityThreshold = 0.3
  ): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      const conditions: string[] = ['VEC_COSINE_DISTANCE(c.concept_embedding, ?) < ?'];
      const params: any[] = [JSON.stringify(embedding), similarityThreshold];

      if (filters.projectId) {
        conditions.push('c.project_id = ?');
        params.push(filters.projectId);
      }

      const sql = `
        SELECT 
          c.id,
          c.name as content,
          c.description,
          c.mention_count,
          c.confidence_score,
          c.created_at,
          VEC_COSINE_DISTANCE(c.concept_embedding, ?) as similarity,
          (1 - VEC_COSINE_DISTANCE(c.concept_embedding, ?)) as score,
          'concept' as type,
          JSON_OBJECT(
            'projectId', c.project_id,
            'name', c.name,
            'description', c.description,
            'mentionCount', c.mention_count,
            'confidenceScore', c.confidence_score
          ) as metadata
        FROM concepts c
        WHERE ${conditions.join(' AND ')}
        ORDER BY similarity ASC
        LIMIT ?
      `;

      const finalParams = [
        JSON.stringify(embedding), // For similarity calculation
        JSON.stringify(embedding), // For score calculation
        ...params,
        limit
      ];

      const result = await tidbClient.query<SearchResult>(sql, finalParams);
      const executionTime = Date.now() - startTime;

      console.log(`Concept vector search completed in ${executionTime}ms, found ${result.rows.length} results`);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Concept vector search failed', error);
    }
  }

  /**
   * Universal hybrid search across all content types
   */
  static async universalSearch(
    query: string,
    embedding: number[],
    filters: SearchFilters = {},
    options: HybridSearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      vectorWeight = 0.7,
      textWeight = 0.3,
      similarityThreshold = 0.3,
      limit = 20,
      includeMetadata = true
    } = options;

    const startTime = Date.now();
    
    try {
      // Search across messages, documents, and concepts in parallel
      const [messageResults, documentResults, conceptResults] = await Promise.all([
        this.hybridSearchMessages(query, embedding, filters, {
          vectorWeight,
          textWeight,
          similarityThreshold,
          limit: Math.ceil(limit / 3)
        }),
        this.hybridSearchDocuments(query, embedding, filters, {
          vectorWeight,
          textWeight,
          similarityThreshold,
          limit: Math.ceil(limit / 3)
        }),
        this.hybridSearchConcepts(query, embedding, filters, {
          vectorWeight,
          textWeight,
          similarityThreshold,
          limit: Math.ceil(limit / 3)
        })
      ]);

      // Combine and sort results by hybrid score
      const allResults = [
        ...messageResults,
        ...documentResults,
        ...conceptResults
      ].sort((a, b) => b.score - a.score).slice(0, limit);

      const executionTime = Date.now() - startTime;
      console.log(`Universal search completed in ${executionTime}ms, found ${allResults.length} results`);

      return allResults;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Universal search failed', error);
    }
  }

  /**
   * Hybrid search for messages combining vector and full-text search
   */
  static async hybridSearchMessages(
    query: string,
    embedding: number[],
    filters: SearchFilters = {},
    options: Partial<HybridSearchOptions> = {}
  ): Promise<SearchResult[]> {
    const { vectorWeight = 0.7, textWeight = 0.3, limit = 20 } = options;
    
    try {
      const conditions: string[] = [];
      const params: any[] = [
        JSON.stringify(embedding), // For vector similarity
        query, // For text relevance
        JSON.stringify(embedding), // For hybrid score vector part
        vectorWeight,
        query, // For hybrid score text part
        textWeight
      ];

      if (filters.projectId) {
        conditions.push('c.project_id = ?');
        params.push(filters.projectId);
      }

      if (filters.conversationId) {
        conditions.push('b.conversation_id = ?');
        params.push(filters.conversationId);
      }

      if (filters.branchId) {
        conditions.push('m.branch_id = ?');
        params.push(filters.branchId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT 
          m.id,
          m.content,
          m.role,
          m.model,
          m.created_at,
          VEC_COSINE_DISTANCE(m.content_embedding, ?) as vector_similarity,
          MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_relevance,
          ((1 - VEC_COSINE_DISTANCE(m.content_embedding, ?)) * ? + 
           MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE) * ?) as score,
          'message' as type,
          JSON_OBJECT(
            'branchId', b.id,
            'branchName', b.name,
            'conversationId', c.id,
            'conversationTitle', c.title,
            'projectId', c.project_id
          ) as metadata
        FROM messages m
        JOIN branches b ON m.branch_id = b.id
        JOIN conversations c ON b.conversation_id = c.id
        ${whereClause}
        HAVING score > 0
        ORDER BY score DESC
        LIMIT ?
      `;

      params.push(limit);

      const result = await tidbClient.query<SearchResult>(sql, params);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Hybrid message search failed', error);
    }
  }

  /**
   * Hybrid search for documents
   */
  static async hybridSearchDocuments(
    query: string,
    embedding: number[],
    filters: SearchFilters = {},
    options: Partial<HybridSearchOptions> = {}
  ): Promise<SearchResult[]> {
    const { vectorWeight = 0.7, textWeight = 0.3, limit = 20 } = options;
    
    try {
      const conditions: string[] = [];
      const params: any[] = [
        JSON.stringify(embedding), // For vector similarity
        query, // For text relevance
        JSON.stringify(embedding), // For hybrid score vector part
        vectorWeight,
        query, // For hybrid score text part
        textWeight
      ];

      if (filters.projectId) {
        conditions.push('d.project_id = ?');
        params.push(filters.projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT 
          d.id,
          d.filename,
          SUBSTRING(d.content, 1, 500) as content,
          d.processed_at as created_at,
          VEC_COSINE_DISTANCE(d.content_embedding, ?) as vector_similarity,
          MATCH(d.content, d.filename) AGAINST(? IN NATURAL LANGUAGE MODE) as text_relevance,
          ((1 - VEC_COSINE_DISTANCE(d.content_embedding, ?)) * ? + 
           MATCH(d.content, d.filename) AGAINST(? IN NATURAL LANGUAGE MODE) * ?) as score,
          'document' as type,
          JSON_OBJECT(
            'projectId', d.project_id,
            'filename', d.filename,
            'mimeType', d.mime_type,
            'fileSize', d.file_size
          ) as metadata
        FROM documents d
        ${whereClause}
        HAVING score > 0
        ORDER BY score DESC
        LIMIT ?
      `;

      params.push(limit);

      const result = await tidbClient.query<SearchResult>(sql, params);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Hybrid document search failed', error);
    }
  }

  /**
   * Hybrid search for concepts
   */
  static async hybridSearchConcepts(
    query: string,
    embedding: number[],
    filters: SearchFilters = {},
    options: Partial<HybridSearchOptions> = {}
  ): Promise<SearchResult[]> {
    const { vectorWeight = 0.7, textWeight = 0.3, limit = 20 } = options;
    
    try {
      const conditions: string[] = [];
      const params: any[] = [
        JSON.stringify(embedding), // For vector similarity
        query, // For text relevance
        JSON.stringify(embedding), // For hybrid score vector part
        vectorWeight,
        query, // For hybrid score text part
        textWeight
      ];

      if (filters.projectId) {
        conditions.push('c.project_id = ?');
        params.push(filters.projectId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT 
          c.id,
          c.name as content,
          c.description,
          c.created_at,
          VEC_COSINE_DISTANCE(c.concept_embedding, ?) as vector_similarity,
          MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE) as text_relevance,
          ((1 - VEC_COSINE_DISTANCE(c.concept_embedding, ?)) * ? + 
           MATCH(c.name, c.description) AGAINST(? IN NATURAL LANGUAGE MODE) * ?) as score,
          'concept' as type,
          JSON_OBJECT(
            'projectId', c.project_id,
            'name', c.name,
            'description', c.description,
            'mentionCount', c.mention_count,
            'confidenceScore', c.confidence_score
          ) as metadata
        FROM concepts c
        ${whereClause}
        HAVING score > 0
        ORDER BY score DESC
        LIMIT ?
      `;

      params.push(limit);

      const result = await tidbClient.query<SearchResult>(sql, params);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Hybrid concept search failed', error);
    }
  }

  /**
   * Find similar conversations based on title embeddings
   */
  static async findSimilarConversations(
    embedding: number[],
    excludeId?: string,
    projectId?: string,
    limit = 10
  ): Promise<SearchResult[]> {
    try {
      const conditions: string[] = ['VEC_COSINE_DISTANCE(title_embedding, ?) < 0.4'];
      const params: any[] = [JSON.stringify(embedding)];

      if (excludeId) {
        conditions.push('id != ?');
        params.push(excludeId);
      }

      if (projectId) {
        conditions.push('project_id = ?');
        params.push(projectId);
      }

      const sql = `
        SELECT 
          id,
          title as content,
          created_at,
          VEC_COSINE_DISTANCE(title_embedding, ?) as similarity,
          (1 - VEC_COSINE_DISTANCE(title_embedding, ?)) as score,
          'conversation' as type,
          JSON_OBJECT(
            'projectId', project_id,
            'title', title
          ) as metadata
        FROM conversations
        WHERE ${conditions.join(' AND ')}
        ORDER BY similarity ASC
        LIMIT ?
      `;

      const finalParams = [
        JSON.stringify(embedding), // For similarity calculation
        JSON.stringify(embedding), // For score calculation
        ...params,
        limit
      ];

      const result = await tidbClient.query<SearchResult>(sql, finalParams);
      
      return result.rows.map(row => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Similar conversation search failed', error);
    }
  }

  /**
   * Get search suggestions based on partial query
   */
  static async getSearchSuggestions(
    partialQuery: string,
    projectId?: string,
    limit = 5
  ): Promise<string[]> {
    try {
      const conditions: string[] = [];
      const params: any[] = [partialQuery];

      if (projectId) {
        conditions.push('c.project_id = ?');
        params.push(projectId);
      }

      const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

      const sql = `
        (SELECT DISTINCT SUBSTRING(content, 1, 100) as suggestion
         FROM messages m
         JOIN branches b ON m.branch_id = b.id
         JOIN conversations c ON b.conversation_id = c.id
         WHERE MATCH(content) AGAINST(? IN BOOLEAN MODE) ${whereClause}
         LIMIT ?)
        UNION
        (SELECT DISTINCT name as suggestion
         FROM concepts c
         WHERE MATCH(name) AGAINST(? IN BOOLEAN MODE) ${projectId ? 'AND project_id = ?' : ''}
         LIMIT ?)
        LIMIT ?
      `;

      const finalParams = [
        partialQuery,
        ...(projectId ? [projectId] : []),
        Math.ceil(limit / 2),
        partialQuery,
        ...(projectId ? [projectId] : []),
        Math.ceil(limit / 2),
        limit
      ];

      const result = await tidbClient.query(sql, finalParams);
      
      return result.rows.map(row => row.suggestion).filter(Boolean);
    } catch (error) {
      console.warn('Search suggestions failed:', error);
      return [];
    }
  }
}

export default VectorSearchService;