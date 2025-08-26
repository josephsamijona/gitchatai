import mysql from 'mysql2/promise';
import { z } from 'zod';
import { connectionManager } from './connection-manager';
import { queryOptimizer } from './query-optimizer';
import { performanceMonitor } from '../performance/monitor';

// Environment configuration schema
const TiDBConfigSchema = z.object({
  host: z.string(),
  port: z.number().default(4000),
  user: z.string(),
  password: z.string(),
  database: z.string(),
  ssl: z.object({
    rejectUnauthorized: z.boolean().default(true),
  }).optional(),
});

export type TiDBConfig = z.infer<typeof TiDBConfigSchema>;

// Connection pool configuration
const POOL_CONFIG = {
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  idleTimeout: 300000,
  maxReconnects: 3,
} as const;

// Error types for better error handling
export enum TiDBErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  QUERY_ERROR = 'QUERY_ERROR',
  VECTOR_SEARCH_ERROR = 'VECTOR_SEARCH_ERROR',
  TRANSACTION_ERROR = 'TRANSACTION_ERROR',
  SCHEMA_ERROR = 'SCHEMA_ERROR'
}

export class TiDBError extends Error {
  constructor(
    public type: TiDBErrorType,
    message: string,
    public originalError?: any
  ) {
    super(message);
    this.name = 'TiDBError';
  }
}

// Query result types
export interface QueryResult<T = any> {
  rows: T[];
  fields: mysql.FieldPacket[];
  affectedRows?: number;
  insertId?: number;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
  type: 'message' | 'document' | 'concept';
  metadata: Record<string, any>;
}

export interface PerformanceMetric {
  operationType: string;
  executionTimeMs: number;
  resultCount: number;
  model?: string;
  timestamp: Date;
}

class TiDBClient {
  private pool: mysql.Pool | null = null;
  private config: TiDBConfig | null = null;
  private isConnected = false;
  private connectionAttempts = 0;
  private maxConnectionAttempts = 3;

  /**
   * Initialize TiDB connection pool
   */
  async initialize(config: TiDBConfig): Promise<void> {
    
   try {
      // Validate configuration
      this.config = TiDBConfigSchema.parse(config);
      
      // Create connection pool
      this.pool = mysql.createPool({
        ...POOL_CONFIG,
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl,
      });

      // Test connection
      await this.testConnection();
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      console.log('TiDB connection pool initialized successfully');
    } catch (error) {
      this.connectionAttempts++;
      const errorMessage = `Failed to initialize TiDB connection (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts})`;
      
      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        throw new TiDBError(TiDBErrorType.CONNECTION_ERROR, errorMessage, error);
      }
      
      // Retry with exponential backoff
      const delay = Math.pow(2, this.connectionAttempts) * 1000;
      console.warn(`${errorMessage}, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.initialize(config);
    }
  }

  /**
   * Test database connection
   */
  private async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new TiDBError(TiDBErrorType.CONNECTION_ERROR, 'Connection pool not initialized');
    }

    try {
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
    } catch (error) {
      throw new TiDBError(TiDBErrorType.CONNECTION_ERROR, 'Connection test failed', error);
    }
  }

  /**
   * Execute a query with error handling and performance tracking
   */
  async query<T = any>(
    sql: string, 
    params: any[] = [],
    trackPerformance = true
  ): Promise<QueryResult<T>> {
    if (!this.pool || !this.isConnected) {
      throw new TiDBError(TiDBErrorType.CONNECTION_ERROR, 'Database not connected');
    }

    const startTime = Date.now();
    
    try {
      const [rows, fields] = await this.pool.execute(sql, params);
      const executionTime = Date.now() - startTime;
      
      // Track performance metrics
      if (trackPerformance) {
        await this.recordPerformanceMetric({
          operationType: this.getOperationType(sql),
          executionTimeMs: executionTime,
          resultCount: Array.isArray(rows) ? rows.length : 0,
          timestamp: new Date()
        });
      }

      return {
        rows: rows as T[],
        fields: fields as mysql.FieldPacket[],
        affectedRows: (rows as any).affectedRows,
        insertId: (rows as any).insertId
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`Query failed after ${executionTime}ms:`, sql, error);
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Query execution failed', error);
    }
  }

  /**
   * Execute vector similarity search with VEC_COSINE_DISTANCE
   */
  async vectorSearch(
    embedding: number[],
    table: string,
    embeddingColumn: string,
    contentColumn: string,
    filters: Record<string, any> = {},
    limit = 20,
    similarityThreshold = 0.3
  ): Promise<VectorSearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Build WHERE clause for filters
      const filterConditions = Object.keys(filters).map(key => `${key} = ?`);
      const whereClause = filterConditions.length > 0 
        ? `WHERE ${filterConditions.join(' AND ')} AND VEC_COSINE_DISTANCE(${embeddingColumn}, ?) < ?`
        : `WHERE VEC_COSINE_DISTANCE(${embeddingColumn}, ?) < ?`;

      const sql = `
        SELECT 
          id,
          ${contentColumn} as content,
          VEC_COSINE_DISTANCE(${embeddingColumn}, ?) as similarity,
          '${table}' as type
        FROM ${table}
        ${whereClause}
        ORDER BY similarity ASC
        LIMIT ?
      `;

      const params = [
        JSON.stringify(embedding), // First embedding for SELECT
        ...Object.values(filters),
        JSON.stringify(embedding), // Second embedding for WHERE
        similarityThreshold,
        limit
      ];

      const result = await this.query<VectorSearchResult>(sql, params);
      const executionTime = Date.now() - startTime;

      // Record performance metric
      await this.recordPerformanceMetric({
        operationType: 'vector_search',
        executionTimeMs: executionTime,
        resultCount: result.rows.length,
        timestamp: new Date()
      });

      return result.rows;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Vector search failed', error);
    }
  }

  /**
   * Execute hybrid search combining vector and full-text search
   */
  async hybridSearch(
    query: string,
    embedding: number[],
    table: string,
    embeddingColumn: string,
    contentColumn: string,
    vectorWeight = 0.7,
    textWeight = 0.3,
    filters: Record<string, any> = {},
    limit = 20
  ): Promise<VectorSearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Build WHERE clause for filters
      const filterConditions = Object.keys(filters).map(key => `${key} = ?`);
      const whereClause = filterConditions.length > 0 
        ? `WHERE ${filterConditions.join(' AND ')}`
        : '';

      const sql = `
        SELECT 
          id,
          ${contentColumn} as content,
          VEC_COSINE_DISTANCE(${embeddingColumn}, ?) as vector_similarity,
          MATCH(${contentColumn}) AGAINST(? IN NATURAL LANGUAGE MODE) as text_relevance,
          (VEC_COSINE_DISTANCE(${embeddingColumn}, ?) * ? + 
           MATCH(${contentColumn}) AGAINST(? IN NATURAL LANGUAGE MODE) * ?) as hybrid_score,
          '${table}' as type
        FROM ${table}
        ${whereClause}
        HAVING hybrid_score > 0
        ORDER BY hybrid_score DESC
        LIMIT ?
      `;

      const params = [
        JSON.stringify(embedding), // First embedding for vector similarity
        query, // First query for text relevance
        JSON.stringify(embedding), // Second embedding for hybrid score
        vectorWeight,
        query, // Second query for hybrid score
        textWeight,
        ...Object.values(filters),
        limit
      ];

      const result = await this.query<VectorSearchResult>(sql, params);
      const executionTime = Date.now() - startTime;

      // Record performance metric
      await this.recordPerformanceMetric({
        operationType: 'hybrid_search',
        executionTimeMs: executionTime,
        resultCount: result.rows.length,
        timestamp: new Date()
      });

      return result.rows;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Hybrid search failed', error);
    }
  }

  /**
   * Execute transaction with automatic rollback on error
   */
  async transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new TiDBError(TiDBErrorType.CONNECTION_ERROR, 'Database not connected');
    }

    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw new TiDBError(TiDBErrorType.TRANSACTION_ERROR, 'Transaction failed', error);
    } finally {
      connection.release();
    }
  }

  /**
   * Get real-time analytics for HTAP demonstration
   */
  async getAnalytics(timeRange: '1h' | '24h' | '7d' = '24h'): Promise<any[]> {
    const intervals = {
      '1h': 'INTERVAL 1 HOUR',
      '24h': 'INTERVAL 24 HOUR', 
      '7d': 'INTERVAL 7 DAY'
    };

    const sql = `
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as time_bucket,
        operation_type,
        AVG(execution_time_ms) as avg_time,
        COUNT(*) as operation_count,
        MIN(execution_time_ms) as min_time,
        MAX(execution_time_ms) as max_time,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95_time
      FROM performance_metrics 
      WHERE created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
      GROUP BY time_bucket, operation_type
      ORDER BY time_bucket DESC, operation_type
    `;

    const result = await this.query(sql);
    return result.rows;
  }

  /**
   * Record performance metrics for monitoring
   */
  private async recordPerformanceMetric(metric: PerformanceMetric): Promise<void> {
    try {
      const sql = `
        INSERT INTO performance_metrics 
        (operation_type, execution_time_ms, result_count, model, created_at) 
        VALUES (?, ?, ?, ?, ?)
      `;
      
      await this.query(sql, [
        metric.operationType,
        metric.executionTimeMs,
        metric.resultCount,
        metric.model || null,
        metric.timestamp
      ], false); // Don't track performance of performance tracking
    } catch (error) {
      // Don't throw errors for performance tracking failures
      console.warn('Failed to record performance metric:', error);
    }
  }

  /**
   * Determine operation type from SQL query
   */
  private getOperationType(sql: string): string {
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
   * Get connection pool status
   */
  getPoolStatus(): {
    isConnected: boolean;
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
  } {
    if (!this.pool) {
      return {
        isConnected: false,
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0
      };
    }

    return {
      isConnected: this.isConnected,
      totalConnections: (this.pool as any)._allConnections?.length || 0,
      activeConnections: (this.pool as any)._acquiringConnections?.length || 0,
      idleConnections: (this.pool as any)._freeConnections?.length || 0
    };
  }

  /**
   * Close connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      console.log('TiDB connection pool closed');
    }
  }
}

// Singleton instance
export const tidbClient = new TiDBClient();

// Helper function to initialize from environment variables
export async function initializeTiDB(): Promise<void> {
  const config: TiDBConfig = {
    host: process.env.TIDB_HOST || '',
    port: parseInt(process.env.TIDB_PORT || '4000'),
    user: process.env.TIDB_USER || '',
    password: process.env.TIDB_PASSWORD || '',
    database: process.env.TIDB_DATABASE || '',
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === 'production'
    }
  };

  await tidbClient.initialize(config);
}

export default tidbClient;