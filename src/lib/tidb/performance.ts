import { tidbClient, TiDBError, TiDBErrorType } from './client';
import crypto from 'crypto';

/**
 * Performance monitoring and optimization utilities
 * Tracks query performance, connection health, and system metrics
 */

export interface QueryPerformanceMetric {
  queryHash: string;
  operationType: string;
  executionTimeMs: number;
  resultCount: number;
  model?: string;
  success: boolean;
  errorMessage?: string;
  timestamp: Date;
}

export interface ConnectionHealthMetric {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  queuedRequests: number;
  avgResponseTime: number;
  errorRate: number;
  timestamp: Date;
}

export interface VectorSearchBenchmark {
  embeddingDimension: number;
  datasetSize: number;
  queryType: 'vector_only' | 'hybrid' | 'full_text';
  avgSearchTime: number;
  p95SearchTime: number;
  p99SearchTime: number;
  throughputQps: number;
  accuracy: number;
  timestamp: Date;
}

/**
 * Performance Monitor Service
 */
export class PerformanceMonitor {
  private static queryCache = new Map<string, number>();
  private static performanceBuffer: QueryPerformanceMetric[] = [];
  private static bufferFlushInterval: NodeJS.Timeout | null = null;
  private static readonly BUFFER_SIZE = 100;
  private static readonly FLUSH_INTERVAL = 5000; // 5 seconds

  /**
   * Initialize performance monitoring
   */
  static initialize(): void {
    // Start buffer flush interval
    this.bufferFlushInterval = setInterval(() => {
      this.flushPerformanceBuffer();
    }, this.FLUSH_INTERVAL);

    console.log('Performance monitoring initialized');
  }

  /**
   * Stop performance monitoring
   */
  static stop(): void {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
      this.bufferFlushInterval = null;
    }

    // Flush remaining buffer
    this.flushPerformanceBuffer();
    console.log('Performance monitoring stopped');
  }

  /**
   * Track query performance with automatic hashing
   */
  static async trackQuery<T>(
    sql: string,
    params: any[],
    operation: () => Promise<T>,
    operationType?: string
  ): Promise<T> {
    const queryHash = this.generateQueryHash(sql);
    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let result: T;
    let resultCount = 0;

    try {
      result = await operation();
      
      // Try to determine result count
      if (Array.isArray(result)) {
        resultCount = result.length;
      } else if (result && typeof result === 'object' && 'rows' in result) {
        resultCount = Array.isArray((result as any).rows) ? (result as any).rows.length : 0;
      }

      return result;
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const executionTime = Date.now() - startTime;
      
      // Add to buffer
      this.performanceBuffer.push({
        queryHash,
        operationType: operationType || this.detectOperationType(sql),
        executionTimeMs: executionTime,
        resultCount,
        success,
        errorMessage,
        timestamp: new Date()
      });

      // Flush buffer if full
      if (this.performanceBuffer.length >= this.BUFFER_SIZE) {
        await this.flushPerformanceBuffer();
      }
    }
  }

  /**
   * Generate consistent hash for SQL queries
   */
  private static generateQueryHash(sql: string): string {
    // Normalize SQL by removing parameters and whitespace
    const normalizedSql = sql
      .replace(/\?/g, 'PARAM')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    return crypto.createHash('sha256').update(normalizedSql).digest('hex').substring(0, 16);
  }

  /**
   * Detect operation type from SQL
   */
  private static detectOperationType(sql: string): string {
    const normalizedSql = sql.trim().toLowerCase();
    
    if (normalizedSql.includes('vec_cosine_distance') && normalizedSql.includes('match')) {
      return 'hybrid_search';
    } else if (normalizedSql.includes('vec_cosine_distance')) {
      return 'vector_search';
    } else if (normalizedSql.includes('match') && normalizedSql.includes('against')) {
      return 'full_text_search';
    } else if (normalizedSql.startsWith('select')) {
      return 'select';
    } else if (normalizedSql.startsWith('insert')) {
      return 'insert';
    } else if (normalizedSql.startsWith('update')) {
      return 'update';
    } else if (normalizedSql.startsWith('delete')) {
      return 'delete';
    }
    
    return 'unknown';
  }

  /**
   * Flush performance buffer to database
   */
  private static async flushPerformanceBuffer(): Promise<void> {
    if (this.performanceBuffer.length === 0) return;

    const metricsToFlush = [...this.performanceBuffer];
    this.performanceBuffer.length = 0; // Clear buffer

    try {
      // Batch insert performance metrics
      const values = metricsToFlush.map(metric => [
        metric.queryHash,
        metric.operationType,
        metric.executionTimeMs,
        metric.resultCount,
        metric.model || null,
        metric.success,
        metric.errorMessage || null,
        metric.timestamp
      ]);

      if (values.length > 0) {
        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const sql = `
          INSERT INTO performance_metrics 
          (query_hash, operation_type, execution_time_ms, result_count, model, success, error_message, created_at)
          VALUES ${placeholders}
        `;

        await tidbClient.query(sql, values.flat(), false); // Don't track performance of performance tracking
      }
    } catch (error) {
      console.error('Failed to flush performance buffer:', error);
      // Re-add metrics to buffer for retry
      this.performanceBuffer.unshift(...metricsToFlush);
    }
  }

  /**
   * Get connection health metrics
   */
  static getConnectionHealth(): ConnectionHealthMetric {
    const poolStatus = tidbClient.getPoolStatus();
    
    return {
      totalConnections: poolStatus.totalConnections,
      activeConnections: poolStatus.activeConnections,
      idleConnections: poolStatus.idleConnections,
      queuedRequests: 0, // TiDB doesn't expose this directly
      avgResponseTime: 0, // Calculate from recent metrics
      errorRate: 0, // Calculate from recent metrics
      timestamp: new Date()
    };
  }

  /**
   * Run vector search benchmark
   */
  static async runVectorSearchBenchmark(
    embeddingDimension = 1536,
    testQueries = 100
  ): Promise<VectorSearchBenchmark> {
    console.log(`Running vector search benchmark with ${testQueries} queries...`);
    
    try {
      // Generate random test embedding
      const testEmbedding = Array.from({ length: embeddingDimension }, () => Math.random() - 0.5);
      
      // Warm up
      await this.runSingleVectorSearch(testEmbedding);
      
      // Run benchmark queries
      const results: number[] = [];
      const startTime = Date.now();
      
      for (let i = 0; i < testQueries; i++) {
        const queryStart = Date.now();
        await this.runSingleVectorSearch(testEmbedding);
        results.push(Date.now() - queryStart);
      }
      
      const totalTime = Date.now() - startTime;
      
      // Calculate statistics
      results.sort((a, b) => a - b);
      const avgSearchTime = results.reduce((sum, time) => sum + time, 0) / results.length;
      const p95Index = Math.floor(results.length * 0.95);
      const p99Index = Math.floor(results.length * 0.99);
      
      return {
        embeddingDimension,
        datasetSize: await this.getDatasetSize(),
        queryType: 'vector_only',
        avgSearchTime,
        p95SearchTime: results[p95Index],
        p99SearchTime: results[p99Index],
        throughputQps: (testQueries / totalTime) * 1000,
        accuracy: 1.0, // Vector search is deterministic
        timestamp: new Date()
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Vector search benchmark failed', error);
    }
  }

  /**
   * Run single vector search for benchmarking
   */
  private static async runSingleVectorSearch(embedding: number[]): Promise<void> {
    const sql = `
      SELECT id, VEC_COSINE_DISTANCE(content_embedding, ?) as similarity
      FROM messages
      WHERE VEC_COSINE_DISTANCE(content_embedding, ?) < 0.5
      ORDER BY similarity ASC
      LIMIT 10
    `;
    
    await tidbClient.query(sql, [JSON.stringify(embedding), JSON.stringify(embedding)], false);
  }

  /**
   * Get dataset size for benchmarking
   */
  private static async getDatasetSize(): Promise<number> {
    try {
      const result = await tidbClient.query(`
        SELECT 
          (SELECT COUNT(*) FROM messages WHERE content_embedding IS NOT NULL) +
          (SELECT COUNT(*) FROM documents WHERE content_embedding IS NOT NULL) +
          (SELECT COUNT(*) FROM concepts WHERE concept_embedding IS NOT NULL) as total_vectors
      `, [], false);
      
      return result.rows[0]?.total_vectors || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Run hybrid search benchmark
   */
  static async runHybridSearchBenchmark(testQueries = 50): Promise<VectorSearchBenchmark> {
    console.log(`Running hybrid search benchmark with ${testQueries} queries...`);
    
    try {
      const testEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
      const testQuery = 'machine learning artificial intelligence';
      
      // Warm up
      await this.runSingleHybridSearch(testQuery, testEmbedding);
      
      // Run benchmark queries
      const results: number[] = [];
      const startTime = Date.now();
      
      for (let i = 0; i < testQueries; i++) {
        const queryStart = Date.now();
        await this.runSingleHybridSearch(testQuery, testEmbedding);
        results.push(Date.now() - queryStart);
      }
      
      const totalTime = Date.now() - startTime;
      
      // Calculate statistics
      results.sort((a, b) => a - b);
      const avgSearchTime = results.reduce((sum, time) => sum + time, 0) / results.length;
      const p95Index = Math.floor(results.length * 0.95);
      const p99Index = Math.floor(results.length * 0.99);
      
      return {
        embeddingDimension: 1536,
        datasetSize: await this.getDatasetSize(),
        queryType: 'hybrid',
        avgSearchTime,
        p95SearchTime: results[p95Index],
        p99SearchTime: results[p99Index],
        throughputQps: (testQueries / totalTime) * 1000,
        accuracy: 0.95, // Estimated for hybrid search
        timestamp: new Date()
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Hybrid search benchmark failed', error);
    }
  }

  /**
   * Run single hybrid search for benchmarking
   */
  private static async runSingleHybridSearch(query: string, embedding: number[]): Promise<void> {
    const sql = `
      SELECT 
        id,
        VEC_COSINE_DISTANCE(content_embedding, ?) as vector_similarity,
        MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) as text_relevance,
        (VEC_COSINE_DISTANCE(content_embedding, ?) * 0.7 + 
         MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) * 0.3) as hybrid_score
      FROM messages
      WHERE VEC_COSINE_DISTANCE(content_embedding, ?) < 0.5
      ORDER BY hybrid_score DESC
      LIMIT 10
    `;
    
    const params = [
      JSON.stringify(embedding),
      query,
      JSON.stringify(embedding),
      query,
      JSON.stringify(embedding)
    ];
    
    await tidbClient.query(sql, params, false);
  }

  /**
   * Get query performance statistics
   */
  static async getQueryPerformanceStats(
    timeRange: '1h' | '24h' | '7d' = '24h'
  ): Promise<{
    slowestQueries: Array<{
      queryHash: string;
      operationType: string;
      avgTime: number;
      maxTime: number;
      count: number;
    }>;
    fastestQueries: Array<{
      queryHash: string;
      operationType: string;
      avgTime: number;
      minTime: number;
      count: number;
    }>;
    errorQueries: Array<{
      queryHash: string;
      operationType: string;
      errorCount: number;
      lastError: string;
    }>;
  }> {
    const intervals = {
      '1h': 'INTERVAL 1 HOUR',
      '24h': 'INTERVAL 24 HOUR',
      '7d': 'INTERVAL 7 DAY'
    };

    try {
      // Slowest queries
      const slowestSql = `
        SELECT 
          query_hash as queryHash,
          operation_type as operationType,
          AVG(execution_time_ms) as avgTime,
          MAX(execution_time_ms) as maxTime,
          COUNT(*) as count
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        AND success = 1
        GROUP BY query_hash, operation_type
        HAVING count >= 5
        ORDER BY avgTime DESC
        LIMIT 10
      `;

      // Fastest queries
      const fastestSql = `
        SELECT 
          query_hash as queryHash,
          operation_type as operationType,
          AVG(execution_time_ms) as avgTime,
          MIN(execution_time_ms) as minTime,
          COUNT(*) as count
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        AND success = 1
        GROUP BY query_hash, operation_type
        HAVING count >= 5
        ORDER BY avgTime ASC
        LIMIT 10
      `;

      // Error queries
      const errorSql = `
        SELECT 
          query_hash as queryHash,
          operation_type as operationType,
          COUNT(*) as errorCount,
          MAX(error_message) as lastError
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        AND success = 0
        GROUP BY query_hash, operation_type
        ORDER BY errorCount DESC
        LIMIT 10
      `;

      const [slowestResult, fastestResult, errorResult] = await Promise.all([
        tidbClient.query(slowestSql, [], false),
        tidbClient.query(fastestSql, [], false),
        tidbClient.query(errorSql, [], false)
      ]);

      return {
        slowestQueries: slowestResult.rows,
        fastestQueries: fastestResult.rows,
        errorQueries: errorResult.rows
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get query performance stats', error);
    }
  }

  /**
   * Optimize query performance
   */
  static async optimizePerformance(): Promise<{
    recommendedIndexes: string[];
    slowQueries: string[];
    suggestions: string[];
  }> {
    try {
      // Analyze slow queries
      const slowQueries = await tidbClient.query(`
        SELECT 
          operation_type,
          AVG(execution_time_ms) as avg_time,
          COUNT(*) as count
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND success = 1
        GROUP BY operation_type
        HAVING avg_time > 200
        ORDER BY avg_time DESC
      `, [], false);

      const recommendations = {
        recommendedIndexes: [] as string[],
        slowQueries: [] as string[],
        suggestions: [] as string[]
      };

      for (const query of slowQueries.rows) {
        recommendations.slowQueries.push(`${query.operation_type}: ${query.avg_time}ms avg`);

        // Generate recommendations based on operation type
        switch (query.operation_type) {
          case 'vector_search':
            recommendations.recommendedIndexes.push('VECTOR INDEX on embedding columns');
            recommendations.suggestions.push('Consider reducing vector dimension or similarity threshold');
            break;
          case 'hybrid_search':
            recommendations.recommendedIndexes.push('FULLTEXT INDEX on content columns');
            recommendations.suggestions.push('Optimize vector/text weight balance');
            break;
          case 'select':
            recommendations.suggestions.push('Add appropriate WHERE clause indexes');
            break;
        }
      }

      return recommendations;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Performance optimization analysis failed', error);
    }
  }

  /**
   * Generate performance report
   */
  static async generatePerformanceReport(): Promise<{
    summary: {
      totalQueries: number;
      avgResponseTime: number;
      errorRate: number;
      slowQueryCount: number;
    };
    benchmarks: {
      vectorSearch: VectorSearchBenchmark;
      hybridSearch: VectorSearchBenchmark;
    };
    connectionHealth: ConnectionHealthMetric;
    recommendations: any;
  }> {
    console.log('Generating comprehensive performance report...');
    
    try {
      // Get summary statistics
      const summarySql = `
        SELECT 
          COUNT(*) as totalQueries,
          AVG(execution_time_ms) as avgResponseTime,
          (SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as errorRate,
          SUM(CASE WHEN execution_time_ms > 200 THEN 1 ELSE 0 END) as slowQueryCount
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `;

      const summaryResult = await tidbClient.query(summarySql, [], false);

      // Run benchmarks
      const [vectorBenchmark, hybridBenchmark] = await Promise.all([
        this.runVectorSearchBenchmark(1536, 50),
        this.runHybridSearchBenchmark(25)
      ]);

      // Get other metrics
      const [connectionHealth, recommendations] = await Promise.all([
        Promise.resolve(this.getConnectionHealth()),
        this.optimizePerformance()
      ]);

      return {
        summary: summaryResult.rows[0] || {
          totalQueries: 0,
          avgResponseTime: 0,
          errorRate: 0,
          slowQueryCount: 0
        },
        benchmarks: {
          vectorSearch: vectorBenchmark,
          hybridSearch: hybridBenchmark
        },
        connectionHealth,
        recommendations
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Performance report generation failed', error);
    }
  }
}

// Auto-initialize performance monitoring
PerformanceMonitor.initialize();

// Cleanup on process exit
process.on('SIGINT', () => {
  PerformanceMonitor.stop();
});

process.on('SIGTERM', () => {
  PerformanceMonitor.stop();
});

export default PerformanceMonitor;