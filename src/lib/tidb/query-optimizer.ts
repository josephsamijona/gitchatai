/**
 * TiDB Query Optimizer - Advanced query optimization and performance tuning
 * Provides query analysis, index recommendations, and vector search optimization
 */

import { tidbClient } from './client';
import { performanceMonitor } from '../performance/monitor';
import { redisClient } from '../cache/redis-client';
import { cacheStrategyManager } from '../cache/cache-strategies';
import { createHash } from 'crypto';

export interface QueryPlan {
  id: string;
  query: string;
  queryHash: string;
  estimatedCost: number;
  actualCost?: number;
  executionTime?: number;
  rowsExamined?: number;
  rowsReturned?: number;
  useIndex?: string;
  joinType?: string;
  optimizations: QueryOptimization[];
  cacheStrategy?: string;
}

export interface QueryOptimization {
  type: 'index' | 'query_rewrite' | 'cache' | 'partition' | 'join_order';
  description: string;
  estimatedGain: number; // Percentage improvement
  difficulty: 'easy' | 'medium' | 'hard';
  recommendation: string;
  priority: 'low' | 'medium' | 'high';
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  indexType: 'btree' | 'hash' | 'vector' | 'fulltext';
  estimatedGain: number;
  currentQueries: string[];
  createStatement: string;
  priority: 'low' | 'medium' | 'high';
}

export interface VectorSearchOptimization {
  searchType: 'cosine' | 'euclidean' | 'dot_product';
  indexParameters: {
    metric: string;
    dimensions: number;
    algorithm: string;
  };
  queryOptimizations: {
    originalQuery: string;
    optimizedQuery: string;
    estimatedSpeedup: number;
  }[];
  cacheStrategy: string;
}

export class QueryOptimizer {
  private queryHistory: Map<string, QueryPlan[]> = new Map();
  private indexRecommendations: IndexRecommendation[] = [];
  private readonly HISTORY_LIMIT = 1000;

  /**
   * Optimize query with intelligent caching and performance monitoring
   */
  async optimizeQuery(
    query: string,
    params: any[] = [],
    options: {
      useCache?: boolean;
      cacheStrategy?: string;
      forceRefresh?: boolean;
      timeout?: number;
    } = {}
  ): Promise<any> {
    const queryHash = this.generateQueryHash(query, params);
    const startTime = performance.now();

    // Use cache if enabled
    if (options.useCache && !options.forceRefresh) {
      const cacheStrategy = options.cacheStrategy || 'database';
      const context = {
        namespace: 'query_results',
        strategy: cacheStrategyManager.getStrategy(cacheStrategy)!,
        tags: ['database', 'query'],
        compression: true
      };

      try {
        return await cacheStrategyManager.cacheAside(
          queryHash,
          async () => this.executeOptimizedQuery(query, params, queryHash),
          context
        );
      } catch (error) {
        console.error('Cache-aside query execution failed:', error);
        // Fallback to direct execution
        return await this.executeOptimizedQuery(query, params, queryHash);
      }
    }

    return await this.executeOptimizedQuery(query, params, queryHash);
  }

  /**
   * Execute query with optimization and monitoring
   */
  private async executeOptimizedQuery(
    query: string,
    params: any[],
    queryHash: string
  ): Promise<any> {
    return await performanceMonitor.measureAsync(
      'tidb_query',
      'database',
      async () => {
        // Analyze query before execution
        const queryPlan = await this.analyzeQuery(query, params);
        
        // Execute query
        const result = await tidbClient.executeQuery(query, params);
        
        // Update query plan with actual execution data
        queryPlan.actualCost = result.executionTime || 0;
        queryPlan.executionTime = result.executionTime || 0;
        queryPlan.rowsReturned = Array.isArray(result.rows) ? result.rows.length : 0;
        
        // Store in query history
        this.addToQueryHistory(queryHash, queryPlan);
        
        // Check for optimization opportunities
        this.identifyOptimizations(queryPlan);
        
        return result;
      },
      {
        query: query.substring(0, 100),
        queryHash,
        paramCount: params.length
      }
    );
  }

  /**
   * Analyze query and create execution plan
   */
  private async analyzeQuery(query: string, params: any[]): Promise<QueryPlan> {
    const queryHash = this.generateQueryHash(query, params);
    
    try {
      // Get query execution plan from TiDB
      const explainQuery = `EXPLAIN ANALYZE ${query}`;
      const planResult = await tidbClient.executeQuery(explainQuery, params);
      
      const plan: QueryPlan = {
        id: this.generatePlanId(),
        query,
        queryHash,
        estimatedCost: this.extractCostFromPlan(planResult),
        optimizations: [],
        cacheStrategy: this.recommendCacheStrategy(query)
      };

      // Extract additional information from plan
      this.extractPlanDetails(planResult, plan);
      
      return plan;
    } catch (error) {
      // If EXPLAIN ANALYZE fails, create basic plan
      return {
        id: this.generatePlanId(),
        query,
        queryHash,
        estimatedCost: 0,
        optimizations: [],
        cacheStrategy: this.recommendCacheStrategy(query)
      };
    }
  }

  /**
   * Extract cost information from query plan
   */
  private extractCostFromPlan(planResult: any): number {
    // Parse TiDB execution plan to extract cost
    // This is a simplified implementation
    if (planResult.rows && planResult.rows.length > 0) {
      const firstRow = planResult.rows[0];
      if (typeof firstRow === 'object' && firstRow.cost) {
        return parseFloat(firstRow.cost) || 0;
      }
    }
    return 0;
  }

  /**
   * Extract additional plan details
   */
  private extractPlanDetails(planResult: any, plan: QueryPlan): void {
    if (planResult.rows) {
      for (const row of planResult.rows) {
        if (typeof row === 'object') {
          if (row.key && row.key.includes('IndexScan')) {
            plan.useIndex = this.extractIndexName(row.key);
          }
          if (row.task && row.task.includes('Join')) {
            plan.joinType = row.task;
          }
          if (row.count) {
            plan.rowsExamined = parseInt(row.count) || 0;
          }
        }
      }
    }
  }

  /**
   * Extract index name from plan output
   */
  private extractIndexName(key: string): string {
    const match = key.match(/table:(\w+), index:(\w+)/);
    return match ? match[2] : 'unknown';
  }

  /**
   * Recommend cache strategy based on query type
   */
  private recommendCacheStrategy(query: string): string {
    const queryLower = query.toLowerCase();
    
    if (queryLower.includes('vector') || queryLower.includes('vec_cosine_distance')) {
      return 'embeddings';
    }
    if (queryLower.includes('select') && queryLower.includes('where')) {
      return 'database';
    }
    if (queryLower.includes('fulltext')) {
      return 'search';
    }
    if (queryLower.includes('count') || queryLower.includes('sum') || queryLower.includes('avg')) {
      return 'api_responses';
    }
    
    return 'database';
  }

  /**
   * Identify optimization opportunities
   */
  private identifyOptimizations(plan: QueryPlan): void {
    const optimizations: QueryOptimization[] = [];

    // High execution time optimization
    if (plan.executionTime && plan.executionTime > 1000) {
      optimizations.push({
        type: 'query_rewrite',
        description: 'Query execution time exceeds 1 second',
        estimatedGain: 50,
        difficulty: 'medium',
        recommendation: 'Consider adding appropriate indexes or rewriting query structure',
        priority: 'high'
      });
    }

    // Missing index optimization
    if (!plan.useIndex && plan.query.toLowerCase().includes('where')) {
      optimizations.push({
        type: 'index',
        description: 'Query uses table scan instead of index',
        estimatedGain: 80,
        difficulty: 'easy',
        recommendation: 'Add index on WHERE clause columns',
        priority: 'high'
      });
    }

    // Large result set optimization
    if (plan.rowsReturned && plan.rowsReturned > 10000) {
      optimizations.push({
        type: 'query_rewrite',
        description: 'Query returns large result set',
        estimatedGain: 30,
        difficulty: 'medium',
        recommendation: 'Add LIMIT clause or implement pagination',
        priority: 'medium'
      });
    }

    // Cache optimization
    if (!plan.cacheStrategy) {
      optimizations.push({
        type: 'cache',
        description: 'Query results could benefit from caching',
        estimatedGain: 90,
        difficulty: 'easy',
        recommendation: 'Implement result caching with appropriate TTL',
        priority: 'medium'
      });
    }

    plan.optimizations = optimizations;
  }

  /**
   * Generate comprehensive index recommendations
   */
  async generateIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];
    
    try {
      // Analyze query patterns from history
      const queryPatterns = this.analyzeQueryPatterns();
      
      // Generate recommendations for each pattern
      for (const pattern of queryPatterns) {
        const recommendation = await this.createIndexRecommendation(pattern);
        if (recommendation) {
          recommendations.push(recommendation);
        }
      }

      // Add vector search specific recommendations
      const vectorRecommendations = await this.generateVectorIndexRecommendations();
      recommendations.push(...vectorRecommendations);

      this.indexRecommendations = recommendations;
      return recommendations;
    } catch (error) {
      console.error('Error generating index recommendations:', error);
      return [];
    }
  }

  /**
   * Analyze query patterns from history
   */
  private analyzeQueryPatterns(): any[] {
    const patterns: Map<string, any> = new Map();
    
    for (const [queryHash, plans] of this.queryHistory.entries()) {
      const latestPlan = plans[plans.length - 1];
      const pattern = this.extractQueryPattern(latestPlan.query);
      
      if (patterns.has(pattern.signature)) {
        const existing = patterns.get(pattern.signature)!;
        existing.frequency++;
        existing.queries.push(latestPlan.query);
        if (latestPlan.executionTime && latestPlan.executionTime > existing.maxTime) {
          existing.maxTime = latestPlan.executionTime;
        }
      } else {
        patterns.set(pattern.signature, {
          ...pattern,
          frequency: 1,
          queries: [latestPlan.query],
          maxTime: latestPlan.executionTime || 0
        });
      }
    }

    return Array.from(patterns.values())
      .filter(pattern => pattern.frequency > 5 || pattern.maxTime > 1000)
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Extract query pattern for analysis
   */
  private extractQueryPattern(query: string): any {
    const queryLower = query.toLowerCase().trim();
    
    // Basic pattern extraction
    let table = '';
    let whereColumns: string[] = [];
    let joinColumns: string[] = [];
    
    // Extract table name
    const tableMatch = queryLower.match(/from\s+(\w+)/);
    if (tableMatch) table = tableMatch[1];
    
    // Extract WHERE columns
    const whereMatches = queryLower.match(/where\s+[^(]*?(\w+)\s*[=<>]/g);
    if (whereMatches) {
      whereColumns = whereMatches.map(match => {
        const colMatch = match.match(/(\w+)\s*[=<>]/);
        return colMatch ? colMatch[1] : '';
      }).filter(col => col && col !== 'and' && col !== 'or');
    }
    
    // Extract JOIN columns
    const joinMatches = queryLower.match(/join\s+\w+\s+on\s+[^(]*?(\w+)\s*=/g);
    if (joinMatches) {
      joinColumns = joinMatches.map(match => {
        const colMatch = match.match(/on\s+[^(]*?(\w+)\s*=/);
        return colMatch ? colMatch[1] : '';
      }).filter(col => col);
    }

    const signature = `${table}_${whereColumns.sort().join('_')}_${joinColumns.sort().join('_')}`;
    
    return {
      signature,
      table,
      whereColumns,
      joinColumns,
      queryType: this.getQueryType(queryLower)
    };
  }

  /**
   * Get query type from query string
   */
  private getQueryType(queryLower: string): string {
    if (queryLower.includes('vec_cosine_distance')) return 'vector_search';
    if (queryLower.includes('fulltext')) return 'fulltext_search';
    if (queryLower.includes('join')) return 'join';
    if (queryLower.includes('group by')) return 'aggregate';
    if (queryLower.startsWith('select')) return 'select';
    if (queryLower.startsWith('insert')) return 'insert';
    if (queryLower.startsWith('update')) return 'update';
    if (queryLower.startsWith('delete')) return 'delete';
    return 'unknown';
  }

  /**
   * Create index recommendation from pattern
   */
  private async createIndexRecommendation(pattern: any): Promise<IndexRecommendation | null> {
    if (!pattern.table || pattern.whereColumns.length === 0) {
      return null;
    }

    // Check if index already exists
    const existingIndexes = await this.getExistingIndexes(pattern.table);
    const indexExists = existingIndexes.some(idx => 
      pattern.whereColumns.every(col => idx.columns.includes(col))
    );

    if (indexExists) {
      return null;
    }

    let indexType: IndexRecommendation['indexType'] = 'btree';
    if (pattern.queryType === 'vector_search') indexType = 'vector';
    else if (pattern.queryType === 'fulltext_search') indexType = 'fulltext';

    const columns = pattern.whereColumns.concat(pattern.joinColumns).filter((col, i, arr) => arr.indexOf(col) === i);
    
    return {
      table: pattern.table,
      columns,
      indexType,
      estimatedGain: this.calculateIndexGain(pattern),
      currentQueries: pattern.queries.slice(0, 5),
      createStatement: this.generateCreateIndexStatement(pattern.table, columns, indexType),
      priority: this.calculateIndexPriority(pattern)
    };
  }

  /**
   * Generate vector search index recommendations
   */
  private async generateVectorIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];
    
    const vectorTables = ['messages', 'documents', 'concepts', 'branches'];
    
    for (const table of vectorTables) {
      try {
        // Check if vector indexes exist
        const existingIndexes = await this.getExistingIndexes(table);
        const hasVectorIndex = existingIndexes.some(idx => idx.indexType === 'vector');
        
        if (!hasVectorIndex) {
          const embeddingColumn = this.getEmbeddingColumnName(table);
          if (embeddingColumn) {
            recommendations.push({
              table,
              columns: [embeddingColumn],
              indexType: 'vector',
              estimatedGain: 95,
              currentQueries: [`SELECT * FROM ${table} ORDER BY VEC_COSINE_DISTANCE(${embeddingColumn}, ?) LIMIT 10`],
              createStatement: `CREATE VECTOR INDEX idx_${table}_${embeddingColumn} ON ${table}(${embeddingColumn})`,
              priority: 'high'
            });
          }
        }
      } catch (error) {
        console.error(`Error checking vector indexes for ${table}:`, error);
      }
    }

    return recommendations;
  }

  /**
   * Get embedding column name for table
   */
  private getEmbeddingColumnName(table: string): string | null {
    const embeddingColumns: Record<string, string> = {
      'messages': 'content_embedding',
      'documents': 'content_embedding', 
      'concepts': 'concept_embedding',
      'branches': 'context_embedding'
    };
    
    return embeddingColumns[table] || null;
  }

  /**
   * Get existing indexes for table
   */
  private async getExistingIndexes(table: string): Promise<any[]> {
    try {
      const query = `
        SELECT 
          INDEX_NAME,
          COLUMN_NAME,
          INDEX_TYPE
        FROM INFORMATION_SCHEMA.TIDB_INDEXES 
        WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()
      `;
      
      const result = await tidbClient.executeQuery(query, [table]);
      
      const indexes: Map<string, any> = new Map();
      for (const row of result.rows) {
        const indexName = row.INDEX_NAME;
        if (!indexes.has(indexName)) {
          indexes.set(indexName, {
            name: indexName,
            columns: [],
            indexType: row.INDEX_TYPE.toLowerCase()
          });
        }
        indexes.get(indexName)!.columns.push(row.COLUMN_NAME);
      }
      
      return Array.from(indexes.values());
    } catch (error) {
      console.error(`Error getting existing indexes for ${table}:`, error);
      return [];
    }
  }

  /**
   * Calculate estimated performance gain from index
   */
  private calculateIndexGain(pattern: any): number {
    let gain = 50; // Base gain
    
    if (pattern.frequency > 50) gain += 30; // High frequency queries
    if (pattern.maxTime > 5000) gain += 40; // Very slow queries
    if (pattern.queryType === 'vector_search') gain += 50; // Vector searches benefit greatly
    
    return Math.min(gain, 95);
  }

  /**
   * Calculate index priority
   */
  private calculateIndexPriority(pattern: any): IndexRecommendation['priority'] {
    if (pattern.frequency > 100 || pattern.maxTime > 5000) return 'high';
    if (pattern.frequency > 20 || pattern.maxTime > 1000) return 'medium';
    return 'low';
  }

  /**
   * Generate CREATE INDEX statement
   */
  private generateCreateIndexStatement(
    table: string, 
    columns: string[], 
    indexType: IndexRecommendation['indexType']
  ): string {
    const indexName = `idx_${table}_${columns.join('_')}`;
    const columnList = columns.join(', ');
    
    switch (indexType) {
      case 'vector':
        return `CREATE VECTOR INDEX ${indexName} ON ${table}(${columnList})`;
      case 'fulltext':
        return `CREATE FULLTEXT INDEX ${indexName} ON ${table}(${columnList})`;
      case 'hash':
        return `CREATE INDEX ${indexName} USING HASH ON ${table}(${columnList})`;
      default:
        return `CREATE INDEX ${indexName} ON ${table}(${columnList})`;
    }
  }

  /**
   * Optimize vector search queries
   */
  optimizeVectorSearch(
    searchVector: number[],
    tableName: string,
    embeddingColumn: string,
    limit: number = 10,
    threshold?: number
  ): VectorSearchOptimization {
    const originalQuery = `
      SELECT *, VEC_COSINE_DISTANCE(${embeddingColumn}, ?) as distance 
      FROM ${tableName} 
      ORDER BY distance ASC 
      LIMIT ?
    `;

    let optimizedQuery = originalQuery;
    let estimatedSpeedup = 1.0;

    // Add threshold filter if provided
    if (threshold !== undefined) {
      optimizedQuery = `
        SELECT *, VEC_COSINE_DISTANCE(${embeddingColumn}, ?) as distance 
        FROM ${tableName} 
        WHERE VEC_COSINE_DISTANCE(${embeddingColumn}, ?) < ?
        ORDER BY distance ASC 
        LIMIT ?
      `;
      estimatedSpeedup *= 1.3;
    }

    // Use approximate search for large datasets
    if (limit > 100) {
      optimizedQuery = optimizedQuery.replace(
        'VEC_COSINE_DISTANCE',
        'VEC_COSINE_DISTANCE_APPROX'
      );
      estimatedSpeedup *= 2.5;
    }

    return {
      searchType: 'cosine',
      indexParameters: {
        metric: 'cosine',
        dimensions: searchVector.length,
        algorithm: 'hnsw'
      },
      queryOptimizations: [{
        originalQuery,
        optimizedQuery,
        estimatedSpeedup
      }],
      cacheStrategy: 'embeddings'
    };
  }

  /**
   * Add query to history
   */
  private addToQueryHistory(queryHash: string, plan: QueryPlan): void {
    if (!this.queryHistory.has(queryHash)) {
      this.queryHistory.set(queryHash, []);
    }
    
    const plans = this.queryHistory.get(queryHash)!;
    plans.push(plan);
    
    // Limit history size per query
    if (plans.length > 100) {
      plans.shift();
    }
    
    // Limit total history size
    if (this.queryHistory.size > this.HISTORY_LIMIT) {
      const oldestKey = this.queryHistory.keys().next().value;
      this.queryHistory.delete(oldestKey);
    }
  }

  /**
   * Generate query hash for caching
   */
  private generateQueryHash(query: string, params: any[]): string {
    const content = `${query}_${JSON.stringify(params)}`;
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Generate unique plan ID
   */
  private generatePlanId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Get query history
   */
  getQueryHistory(limit: number = 100): QueryPlan[] {
    const allPlans: QueryPlan[] = [];
    for (const plans of this.queryHistory.values()) {
      allPlans.push(...plans);
    }
    
    return allPlans
      .sort((a, b) => (b.executionTime || 0) - (a.executionTime || 0))
      .slice(0, limit);
  }

  /**
   * Get index recommendations
   */
  getIndexRecommendations(): IndexRecommendation[] {
    return this.indexRecommendations;
  }

  /**
   * Clear query history
   */
  clearHistory(): void {
    this.queryHistory.clear();
    this.indexRecommendations = [];
  }
}

// Export singleton instance
export const queryOptimizer = new QueryOptimizer();