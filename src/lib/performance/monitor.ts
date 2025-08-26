/**
 * Performance Monitor - Advanced performance monitoring and optimization system
 * Tracks system metrics, query performance, and provides optimization insights
 */

import { performance } from 'perf_hooks';
import { redisClient } from '../cache/redis-client';
import { tidbClient } from '../tidb/client';
import EventEmitter from 'events';

export interface PerformanceMetric {
  id: string;
  name: string;
  type: 'database' | 'cache' | 'api' | 'computation' | 'network';
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  resourceUsage?: {
    memory?: number;
    cpu?: number;
    network?: number;
  };
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
  lastCheck: Date;
  components: {
    database: ComponentHealth;
    cache: ComponentHealth;
    memory: ComponentHealth;
    api: ComponentHealth;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'critical';
  responseTime: number;
  errorRate: number;
  throughput: number;
  availability: number;
  lastCheck: Date;
}

export interface OptimizationInsight {
  type: 'cache_miss' | 'slow_query' | 'memory_pressure' | 'high_error_rate' | 'resource_contention';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
  impact: string;
  estimatedGain?: string;
  actionable: boolean;
  detectedAt: Date;
}

export interface PerformanceReport {
  period: { start: Date; end: Date };
  summary: {
    totalRequests: number;
    avgResponseTime: number;
    errorRate: number;
    throughput: number;
    cacheHitRate: number;
  };
  trends: {
    responseTime: number[]; // Hourly averages
    errorRate: number[]; // Hourly error rates
    throughput: number[]; // Hourly request counts
  };
  topSlowQueries: PerformanceMetric[];
  insights: OptimizationInsight[];
  systemHealth: SystemHealth;
}

export class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetric[] = [];
  private insights: OptimizationInsight[] = [];
  private readonly MAX_METRICS = 10000;
  private readonly MAX_INSIGHTS = 100;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startMonitoring();
  }

  /**
   * Start continuous monitoring
   */
  private startMonitoring(): void {
    // Collect metrics every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Health check every 5 minutes
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 300000);
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: Omit<PerformanceMetric, 'id' | 'timestamp'>): void {
    const fullMetric: PerformanceMetric = {
      ...metric,
      id: this.generateMetricId(),
      timestamp: new Date()
    };

    this.metrics.push(fullMetric);

    // Limit metrics array size
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }

    // Analyze for optimization insights
    this.analyzeMetric(fullMetric);

    // Emit metric event
    this.emit('metric', fullMetric);
  }

  /**
   * Measure and record function execution time
   */
  async measureAsync<T>(
    name: string,
    type: PerformanceMetric['type'],
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      
      this.recordMetric({
        name,
        type,
        duration,
        success: true,
        metadata,
        resourceUsage: {
          memory: endMemory.heapUsed - startMemory.heapUsed,
        }
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.recordMetric({
        name,
        type,
        duration,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata
      });

      throw error;
    }
  }

  /**
   * Measure synchronous function execution
   */
  measureSync<T>(
    name: string,
    type: PerformanceMetric['type'],
    fn: () => T,
    metadata?: Record<string, any>
  ): T {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = fn();
      const duration = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      
      this.recordMetric({
        name,
        type,
        duration,
        success: true,
        metadata,
        resourceUsage: {
          memory: endMemory.heapUsed - startMemory.heapUsed,
        }
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.recordMetric({
        name,
        type,
        duration,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata
      });

      throw error;
    }
  }

  /**
   * Collect system-level metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      // Memory usage
      const memoryUsage = process.memoryUsage();
      this.recordMetric({
        name: 'system_memory',
        type: 'computation',
        duration: 0,
        success: true,
        metadata: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          external: memoryUsage.external,
          rss: memoryUsage.rss
        }
      });

      // Cache statistics
      const cacheStats = await redisClient.getStats();
      this.recordMetric({
        name: 'cache_performance',
        type: 'cache',
        duration: cacheStats.avgResponseTime,
        success: true,
        metadata: {
          hitRate: cacheStats.hitRate,
          totalRequests: cacheStats.totalRequests,
          memoryUsage: cacheStats.memoryUsage
        }
      });

      // Database connection health
      try {
        const startTime = performance.now();
        await tidbClient.query('SELECT 1');
        const dbResponseTime = performance.now() - startTime;
        
        this.recordMetric({
          name: 'database_health',
          type: 'database',
          duration: dbResponseTime,
          success: true,
          metadata: {
            connectionHealth: 'good'
          }
        });
      } catch (error) {
        this.recordMetric({
          name: 'database_health',
          type: 'database',
          duration: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }

    } catch (error) {
      console.error('Error collecting system metrics:', error);
    }
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<SystemHealth> {
    const healthCheck: SystemHealth = {
      status: 'healthy',
      score: 100,
      issues: [],
      recommendations: [],
      lastCheck: new Date(),
      components: {
        database: await this.checkDatabaseHealth(),
        cache: await this.checkCacheHealth(),
        memory: this.checkMemoryHealth(),
        api: this.checkApiHealth()
      }
    };

    // Calculate overall health score
    const componentScores = Object.values(healthCheck.components).map(component => {
      switch (component.status) {
        case 'healthy': return 100;
        case 'degraded': return 60;
        case 'critical': return 20;
      }
    });

    healthCheck.score = componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length;

    // Determine overall status
    if (healthCheck.score >= 80) {
      healthCheck.status = 'healthy';
    } else if (healthCheck.score >= 50) {
      healthCheck.status = 'degraded';
      healthCheck.issues.push('System performance is degraded');
      healthCheck.recommendations.push('Review component health and optimize slow components');
    } else {
      healthCheck.status = 'critical';
      healthCheck.issues.push('System performance is critical');
      healthCheck.recommendations.push('Immediate attention required for critical components');
    }

    this.emit('healthCheck', healthCheck);
    return healthCheck;
  }

  /**
   * Check database component health
   */
  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    const recentMetrics = this.getRecentMetrics('database', 300000); // Last 5 minutes
    
    if (recentMetrics.length === 0) {
      return {
        status: 'healthy',
        responseTime: 0,
        errorRate: 0,
        throughput: 0,
        availability: 100,
        lastCheck: new Date()
      };
    }

    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length;
    const errorRate = (recentMetrics.filter(m => !m.success).length / recentMetrics.length) * 100;
    const throughput = recentMetrics.length / 5; // Per minute

    let status: ComponentHealth['status'] = 'healthy';
    if (avgResponseTime > 1000 || errorRate > 10) {
      status = 'critical';
    } else if (avgResponseTime > 500 || errorRate > 5) {
      status = 'degraded';
    }

    return {
      status,
      responseTime: avgResponseTime,
      errorRate,
      throughput,
      availability: 100 - errorRate,
      lastCheck: new Date()
    };
  }

  /**
   * Check cache component health
   */
  private async checkCacheHealth(): Promise<ComponentHealth> {
    try {
      const stats = await redisClient.getStats();
      const isConnected = await redisClient.ping();

      let status: ComponentHealth['status'] = 'healthy';
      if (!isConnected || stats.hitRate < 0.3) {
        status = 'critical';
      } else if (stats.hitRate < 0.6) {
        status = 'degraded';
      }

      return {
        status,
        responseTime: stats.avgResponseTime,
        errorRate: 0, // Redis errors are handled separately
        throughput: stats.totalRequests,
        availability: isConnected ? 100 : 0,
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        status: 'critical',
        responseTime: 0,
        errorRate: 100,
        throughput: 0,
        availability: 0,
        lastCheck: new Date()
      };
    }
  }

  /**
   * Check memory health
   */
  private checkMemoryHealth(): ComponentHealth {
    const memoryUsage = process.memoryUsage();
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

    let status: ComponentHealth['status'] = 'healthy';
    if (memoryUsagePercent > 90) {
      status = 'critical';
    } else if (memoryUsagePercent > 80) {
      status = 'degraded';
    }

    return {
      status,
      responseTime: 0,
      errorRate: 0,
      throughput: 0,
      availability: 100,
      lastCheck: new Date()
    };
  }

  /**
   * Check API health
   */
  private checkApiHealth(): ComponentHealth {
    const recentMetrics = this.getRecentMetrics('api', 300000); // Last 5 minutes
    
    if (recentMetrics.length === 0) {
      return {
        status: 'healthy',
        responseTime: 0,
        errorRate: 0,
        throughput: 0,
        availability: 100,
        lastCheck: new Date()
      };
    }

    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length;
    const errorRate = (recentMetrics.filter(m => !m.success).length / recentMetrics.length) * 100;
    const throughput = recentMetrics.length / 5; // Per minute

    let status: ComponentHealth['status'] = 'healthy';
    if (avgResponseTime > 5000 || errorRate > 15) {
      status = 'critical';
    } else if (avgResponseTime > 2000 || errorRate > 10) {
      status = 'degraded';
    }

    return {
      status,
      responseTime: avgResponseTime,
      errorRate,
      throughput,
      availability: 100 - errorRate,
      lastCheck: new Date()
    };
  }

  /**
   * Analyze metric for optimization insights
   */
  private analyzeMetric(metric: PerformanceMetric): void {
    const insights: OptimizationInsight[] = [];

    // Slow query detection
    if (metric.type === 'database' && metric.duration > 1000) {
      insights.push({
        type: 'slow_query',
        severity: metric.duration > 5000 ? 'critical' : 'high',
        description: `Slow database query detected: ${metric.name} took ${metric.duration.toFixed(2)}ms`,
        recommendation: 'Consider adding indexes, optimizing query structure, or implementing caching',
        impact: 'High response times affect user experience',
        estimatedGain: `Potential 50-80% response time improvement`,
        actionable: true,
        detectedAt: new Date()
      });
    }

    // Cache miss pattern detection
    if (metric.type === 'cache' && !metric.success) {
      const recentCacheMisses = this.metrics
        .filter(m => m.type === 'cache' && !m.success && 
          (Date.now() - m.timestamp.getTime()) < 60000)
        .length;

      if (recentCacheMisses > 10) {
        insights.push({
          type: 'cache_miss',
          severity: 'medium',
          description: `High cache miss rate detected: ${recentCacheMisses} misses in last minute`,
          recommendation: 'Review caching strategy, increase TTL, or pre-warm cache',
          impact: 'Increased load on primary data sources',
          estimatedGain: 'Up to 70% reduction in backend queries',
          actionable: true,
          detectedAt: new Date()
        });
      }
    }

    // Memory pressure detection
    if (metric.name === 'system_memory' && metric.metadata) {
      const heapUsagePercent = (metric.metadata.heapUsed / metric.metadata.heapTotal) * 100;
      if (heapUsagePercent > 85) {
        insights.push({
          type: 'memory_pressure',
          severity: heapUsagePercent > 95 ? 'critical' : 'high',
          description: `High memory usage detected: ${heapUsagePercent.toFixed(1)}% heap utilization`,
          recommendation: 'Consider memory optimization, garbage collection tuning, or scaling',
          impact: 'Risk of out-of-memory errors and performance degradation',
          estimatedGain: 'Improved stability and performance',
          actionable: true,
          detectedAt: new Date()
        });
      }
    }

    // High error rate detection
    const recentErrors = this.metrics
      .filter(m => !m.success && (Date.now() - m.timestamp.getTime()) < 300000)
      .length;

    if (recentErrors > 20) {
      insights.push({
        type: 'high_error_rate',
        severity: 'high',
        description: `High error rate detected: ${recentErrors} errors in last 5 minutes`,
        recommendation: 'Investigate error causes, implement better error handling, and monitoring',
        impact: 'Poor user experience and potential data loss',
        actionable: true,
        detectedAt: new Date()
      });
    }

    // Add insights
    for (const insight of insights) {
      this.addInsight(insight);
    }
  }

  /**
   * Add optimization insight
   */
  private addInsight(insight: OptimizationInsight): void {
    this.insights.push(insight);

    // Limit insights array size
    if (this.insights.length > this.MAX_INSIGHTS) {
      this.insights.shift();
    }

    this.emit('insight', insight);
  }

  /**
   * Get recent metrics
   */
  private getRecentMetrics(type?: PerformanceMetric['type'], timeWindow: number = 300000): PerformanceMetric[] {
    const cutoff = Date.now() - timeWindow;
    return this.metrics.filter(metric => 
      metric.timestamp.getTime() > cutoff && 
      (type ? metric.type === type : true)
    );
  }

  /**
   * Generate performance report
   */
  generateReport(hours: number = 24): PerformanceReport {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const periodMetrics = this.metrics.filter(m => m.timestamp.getTime() > cutoff);

    const totalRequests = periodMetrics.length;
    const successfulRequests = periodMetrics.filter(m => m.success);
    const avgResponseTime = successfulRequests.reduce((sum, m) => sum + m.duration, 0) / successfulRequests.length || 0;
    const errorRate = ((totalRequests - successfulRequests.length) / totalRequests) * 100 || 0;
    const throughput = totalRequests / hours;

    // Calculate cache hit rate
    const cacheMetrics = periodMetrics.filter(m => m.type === 'cache');
    const cacheHits = cacheMetrics.filter(m => m.success).length;
    const cacheHitRate = cacheMetrics.length > 0 ? (cacheHits / cacheMetrics.length) * 100 : 0;

    // Generate hourly trends
    const trends = this.generateTrends(periodMetrics, hours);

    // Get top slow queries
    const topSlowQueries = periodMetrics
      .filter(m => m.type === 'database')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return {
      period: {
        start: new Date(cutoff),
        end: new Date()
      },
      summary: {
        totalRequests,
        avgResponseTime,
        errorRate,
        throughput,
        cacheHitRate
      },
      trends,
      topSlowQueries,
      insights: this.insights.slice(-20), // Last 20 insights
      systemHealth: {} as SystemHealth // Would be populated by current health check
    };
  }

  /**
   * Generate hourly trends
   */
  private generateTrends(metrics: PerformanceMetric[], hours: number): PerformanceReport['trends'] {
    const trends = {
      responseTime: Array(hours).fill(0),
      errorRate: Array(hours).fill(0),
      throughput: Array(hours).fill(0)
    };

    const hourlyBuckets = Array(hours).fill(0).map(() => ({
      metrics: [] as PerformanceMetric[],
      errors: 0
    }));

    // Bucket metrics by hour
    metrics.forEach(metric => {
      const hoursAgo = Math.floor((Date.now() - metric.timestamp.getTime()) / (60 * 60 * 1000));
      if (hoursAgo < hours) {
        const bucketIndex = hours - 1 - hoursAgo;
        hourlyBuckets[bucketIndex].metrics.push(metric);
        if (!metric.success) {
          hourlyBuckets[bucketIndex].errors++;
        }
      }
    });

    // Calculate trends
    hourlyBuckets.forEach((bucket, index) => {
      if (bucket.metrics.length > 0) {
        trends.responseTime[index] = bucket.metrics.reduce((sum, m) => sum + m.duration, 0) / bucket.metrics.length;
        trends.errorRate[index] = (bucket.errors / bucket.metrics.length) * 100;
        trends.throughput[index] = bucket.metrics.length;
      }
    });

    return trends;
  }

  /**
   * Get current insights
   */
  getInsights(limit: number = 50): OptimizationInsight[] {
    return this.insights.slice(-limit);
  }

  /**
   * Get metrics by type
   */
  getMetrics(type?: PerformanceMetric['type'], limit: number = 1000): PerformanceMetric[] {
    const filtered = type ? this.metrics.filter(m => m.type === type) : this.metrics;
    return filtered.slice(-limit);
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Clear all insights
   */
  clearInsights(): void {
    this.insights = [];
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Generate unique metric ID
   */
  private generateMetricId(): string {
    return `metric_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();