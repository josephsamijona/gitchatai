/**
 * Connection Manager - Advanced connection pooling and resource management
 * Provides intelligent connection management with health monitoring and optimization
 */

import mysql from 'mysql2/promise';
import { EventEmitter } from 'events';
import { performanceMonitor } from '../performance/monitor';

export interface ConnectionPoolConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized: boolean;
  };
  // Pool-specific settings
  connectionLimit: number;
  queueLimit: number;
  acquireTimeout: number;
  timeout: number;
  idleTimeout: number;
  maxReconnects: number;
  reconnectInterval: number;
  // Advanced settings
  enableKeepAlive: boolean;
  keepAliveInitialDelay: number;
  enableHealthCheck: boolean;
  healthCheckInterval: number;
  prepareStatements: boolean;
}

export interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  queued: number;
  created: number;
  destroyed: number;
  errors: number;
  lastActivity: Date;
  uptime: number;
  avgResponseTime: number;
  peakConnections: number;
}

export interface HealthStatus {
  isHealthy: boolean;
  score: number; // 0-100
  issues: string[];
  lastCheck: Date;
  components: {
    connectivity: boolean;
    performance: boolean;
    resources: boolean;
  };
}

export class ConnectionManager extends EventEmitter {
  private pool: mysql.Pool;
  private config: ConnectionPoolConfig;
  private stats: ConnectionStats;
  private healthStatus: HealthStatus;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private startTime: Date;
  private responseTimes: number[] = [];

  constructor(config: Partial<ConnectionPoolConfig>) {
    super();
    
    this.config = {
      host: 'localhost',
      port: 4000,
      user: 'root',
      password: '',
      database: 'synapse',
      connectionLimit: 10,
      queueLimit: 0,
      acquireTimeout: 60000,
      timeout: 60000,
      idleTimeout: 300000,
      maxReconnects: 3,
      reconnectInterval: 5000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
      enableHealthCheck: true,
      healthCheckInterval: 30000,
      prepareStatements: false,
      ...config
    };

    this.startTime = new Date();
    this.stats = {
      total: 0,
      active: 0,
      idle: 0,
      queued: 0,
      created: 0,
      destroyed: 0,
      errors: 0,
      lastActivity: new Date(),
      uptime: 0,
      avgResponseTime: 0,
      peakConnections: 0
    };

    this.healthStatus = {
      isHealthy: true,
      score: 100,
      issues: [],
      lastCheck: new Date(),
      components: {
        connectivity: true,
        performance: true,
        resources: true
      }
    };

    this.initializePool();
    this.startMonitoring();
  }

  /**
   * Initialize MySQL connection pool
   */
  private initializePool(): void {
    try {
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl,
        connectionLimit: this.config.connectionLimit,
        queueLimit: this.config.queueLimit,
        acquireTimeout: this.config.acquireTimeout,
        timeout: this.config.timeout,
        idleTimeout: this.config.idleTimeout,
        maxReconnects: this.config.maxReconnects,
        reconnectOnError: (err) => {
          console.log('MySQL reconnecting due to error:', err.message);
          return true;
        },
        enableKeepAlive: this.config.enableKeepAlive,
        keepAliveInitialDelay: this.config.keepAliveInitialDelay,
      });

      this.setupEventHandlers();
      
      console.log('MySQL connection pool initialized');
      this.emit('poolCreated', this.config);

    } catch (error) {
      console.error('Failed to initialize connection pool:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Setup pool event handlers
   */
  private setupEventHandlers(): void {
    this.pool.on('connection', (connection) => {
      this.stats.created++;
      this.updateStats();
      console.log(`New connection established: ${connection.threadId}`);
      this.emit('connectionCreated', connection.threadId);
    });

    this.pool.on('release', (connection) => {
      this.stats.lastActivity = new Date();
      this.updateStats();
      this.emit('connectionReleased', connection.threadId);
    });

    this.pool.on('enqueue', () => {
      this.stats.queued++;
      this.emit('connectionQueued');
    });

    this.pool.on('error', (err) => {
      this.stats.errors++;
      this.updateStats();
      console.error('Pool error:', err);
      this.emit('error', err);
    });
  }

  /**
   * Execute query with performance monitoring
   */
  async executeQuery(
    query: string, 
    params: any[] = [],
    options: {
      timeout?: number;
      useTransaction?: boolean;
      retryCount?: number;
    } = {}
  ): Promise<any> {
    const startTime = Date.now();
    let connection: mysql.PoolConnection | null = null;
    let retryCount = 0;
    const maxRetries = options.retryCount || 3;

    while (retryCount < maxRetries) {
      try {
        // Get connection from pool
        connection = await this.getConnection(options.timeout);
        this.stats.active++;
        this.updateStats();

        // Execute query
        const [results] = await connection.execute(query, params);
        
        // Record performance metrics
        const responseTime = Date.now() - startTime;
        this.recordResponseTime(responseTime);

        await performanceMonitor.recordMetric({
          name: 'tidb_query_execution',
          type: 'database',
          duration: responseTime,
          success: true,
          metadata: {
            query: query.substring(0, 100),
            paramCount: params.length,
            connectionId: connection.threadId,
            retry: retryCount
          }
        });

        return {
          rows: results,
          executionTime: responseTime,
          connectionId: connection.threadId
        };

      } catch (error) {
        const responseTime = Date.now() - startTime;
        
        await performanceMonitor.recordMetric({
          name: 'tidb_query_execution',
          type: 'database',
          duration: responseTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            query: query.substring(0, 100),
            paramCount: params.length,
            retry: retryCount
          }
        });

        // Check if error is retryable
        if (this.isRetryableError(error) && retryCount < maxRetries - 1) {
          retryCount++;
          console.log(`Retrying query (attempt ${retryCount + 1}/${maxRetries})...`);
          await this.wait(1000 * retryCount); // Exponential backoff
          continue;
        }

        this.stats.errors++;
        this.updateStats();
        throw error;

      } finally {
        if (connection) {
          connection.release();
          this.stats.active--;
          this.updateStats();
        }
      }
    }

    throw new Error(`Query failed after ${maxRetries} attempts`);
  }

  /**
   * Execute transaction with automatic rollback on error
   */
  async executeTransaction(
    queries: Array<{ query: string; params?: any[] }>,
    options: { timeout?: number } = {}
  ): Promise<any[]> {
    const connection = await this.getConnection(options.timeout);
    const startTime = Date.now();
    
    try {
      this.stats.active++;
      await connection.beginTransaction();
      
      const results: any[] = [];
      
      for (const { query, params = [] } of queries) {
        const [result] = await connection.execute(query, params);
        results.push(result);
      }
      
      await connection.commit();
      
      const responseTime = Date.now() - startTime;
      this.recordResponseTime(responseTime);
      
      await performanceMonitor.recordMetric({
        name: 'tidb_transaction',
        type: 'database',
        duration: responseTime,
        success: true,
        metadata: {
          queryCount: queries.length,
          connectionId: connection.threadId
        }
      });

      return results;

    } catch (error) {
      await connection.rollback();
      
      const responseTime = Date.now() - startTime;
      await performanceMonitor.recordMetric({
        name: 'tidb_transaction',
        type: 'database',
        duration: responseTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          queryCount: queries.length
        }
      });

      this.stats.errors++;
      throw error;

    } finally {
      connection.release();
      this.stats.active--;
      this.updateStats();
    }
  }

  /**
   * Get connection from pool with timeout
   */
  private async getConnection(timeout?: number): Promise<mysql.PoolConnection> {
    const connectionTimeout = timeout || this.config.acquireTimeout;
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout after ${connectionTimeout}ms`));
      }, connectionTimeout);

      this.pool.getConnection((err, connection) => {
        clearTimeout(timer);
        
        if (err) {
          reject(err);
        } else {
          resolve(connection);
        }
      });
    });
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;
    
    const retryableErrors = [
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ER_LOCK_WAIT_TIMEOUT',
      'ER_LOCK_DEADLOCK'
    ];

    const errorCode = error.code || error.errno;
    const errorMessage = error.message || '';

    return retryableErrors.some(code => 
      errorCode === code || errorMessage.includes(code)
    );
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    
    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }

    // Update average response time
    this.stats.avgResponseTime = this.responseTimes.reduce((sum, t) => sum + t, 0) / this.responseTimes.length;
  }

  /**
   * Update connection statistics
   */
  private updateStats(): void {
    this.stats.total = this.stats.active + this.stats.idle;
    this.stats.uptime = Date.now() - this.startTime.getTime();
    this.stats.lastActivity = new Date();
    
    if (this.stats.active > this.stats.peakConnections) {
      this.stats.peakConnections = this.stats.active;
    }
  }

  /**
   * Start monitoring and health checks
   */
  private startMonitoring(): void {
    // Update stats every 10 seconds
    this.monitoringInterval = setInterval(() => {
      this.updatePoolStats();
    }, 10000);

    // Health check every 30 seconds (or configured interval)
    if (this.config.enableHealthCheck) {
      this.healthCheckInterval = setInterval(() => {
        this.performHealthCheck();
      }, this.config.healthCheckInterval);
    }
  }

  /**
   * Update pool statistics from MySQL
   */
  private async updatePoolStats(): Promise<void> {
    try {
      // Get connection pool status from MySQL
      const statusQuery = `
        SHOW STATUS WHERE Variable_name IN (
          'Threads_connected', 'Threads_running', 'Connection_errors_max_connections'
        )
      `;
      
      const result = await this.executeQuery(statusQuery);
      
      // Update stats based on MySQL status
      if (result.rows) {
        for (const row of result.rows) {
          switch (row.Variable_name) {
            case 'Threads_connected':
              this.stats.total = parseInt(row.Value);
              break;
            case 'Threads_running':
              this.stats.active = parseInt(row.Value);
              break;
          }
        }
      }

      this.stats.idle = this.stats.total - this.stats.active;
      
    } catch (error) {
      console.error('Failed to update pool stats:', error);
    }
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<HealthStatus> {
    const issues: string[] = [];
    const components = {
      connectivity: true,
      performance: true,
      resources: true
    };

    try {
      // Test connectivity
      const startTime = Date.now();
      await this.executeQuery('SELECT 1');
      const responseTime = Date.now() - startTime;

      // Check performance
      if (responseTime > 5000) {
        components.performance = false;
        issues.push(`High response time: ${responseTime}ms`);
      }

      if (this.stats.avgResponseTime > 2000) {
        components.performance = false;
        issues.push(`Average response time is high: ${this.stats.avgResponseTime.toFixed(2)}ms`);
      }

      // Check resource utilization
      const connectionUtilization = (this.stats.active / this.config.connectionLimit) * 100;
      if (connectionUtilization > 90) {
        components.resources = false;
        issues.push(`High connection utilization: ${connectionUtilization.toFixed(1)}%`);
      }

      if (this.stats.errors > 0) {
        const errorRate = (this.stats.errors / (this.stats.created || 1)) * 100;
        if (errorRate > 10) {
          components.connectivity = false;
          issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
        }
      }

    } catch (error) {
      components.connectivity = false;
      issues.push(`Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Calculate health score
    const componentCount = Object.keys(components).length;
    const healthyComponents = Object.values(components).filter(Boolean).length;
    const score = (healthyComponents / componentCount) * 100;

    this.healthStatus = {
      isHealthy: score >= 80,
      score,
      issues,
      lastCheck: new Date(),
      components
    };

    this.emit('healthCheck', this.healthStatus);
    return this.healthStatus;
  }

  /**
   * Get current connection statistics
   */
  getStats(): ConnectionStats {
    return { ...this.stats };
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Get pool configuration
   */
  getConfig(): ConnectionPoolConfig {
    return { ...this.config };
  }

  /**
   * Scale connection pool size
   */
  async scalePool(newLimit: number): Promise<boolean> {
    try {
      // Close existing pool
      await this.close();
      
      // Update configuration
      this.config.connectionLimit = newLimit;
      
      // Reinitialize pool
      this.initializePool();
      
      console.log(`Connection pool scaled to ${newLimit} connections`);
      this.emit('poolScaled', newLimit);
      
      return true;
    } catch (error) {
      console.error('Failed to scale connection pool:', error);
      return false;
    }
  }

  /**
   * Test connection pool performance
   */
  async performanceTest(concurrency: number = 10, iterations: number = 100): Promise<{
    avgResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    throughput: number;
    errorCount: number;
  }> {
    const results: number[] = [];
    let errorCount = 0;
    const startTime = Date.now();

    const runTest = async (): Promise<void> => {
      for (let i = 0; i < iterations; i++) {
        try {
          const testStart = Date.now();
          await this.executeQuery('SELECT 1');
          results.push(Date.now() - testStart);
        } catch (error) {
          errorCount++;
        }
      }
    };

    // Run concurrent tests
    const promises = Array(concurrency).fill(null).map(() => runTest());
    await Promise.all(promises);

    const totalTime = Date.now() - startTime;
    const avgResponseTime = results.reduce((sum, time) => sum + time, 0) / results.length;
    const maxResponseTime = Math.max(...results);
    const minResponseTime = Math.min(...results);
    const throughput = (results.length / totalTime) * 1000; // queries per second

    return {
      avgResponseTime,
      maxResponseTime,
      minResponseTime,
      throughput,
      errorCount
    };
  }

  /**
   * Wait for specified milliseconds
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close connection pool
   */
  async close(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.pool) {
      await this.pool.end();
      console.log('Connection pool closed');
      this.emit('poolClosed');
    }
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager({
  host: process.env.TIDB_HOST || 'localhost',
  port: parseInt(process.env.TIDB_PORT || '4000'),
  user: process.env.TIDB_USER || 'root',
  password: process.env.TIDB_PASSWORD || '',
  database: process.env.TIDB_DATABASE || 'synapse',
  connectionLimit: parseInt(process.env.TIDB_CONNECTION_LIMIT || '10'),
  queueLimit: parseInt(process.env.TIDB_QUEUE_LIMIT || '0'),
  acquireTimeout: parseInt(process.env.TIDB_ACQUIRE_TIMEOUT || '60000'),
  timeout: parseInt(process.env.TIDB_TIMEOUT || '60000'),
  idleTimeout: parseInt(process.env.TIDB_IDLE_TIMEOUT || '300000'),
  ssl: process.env.TIDB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});