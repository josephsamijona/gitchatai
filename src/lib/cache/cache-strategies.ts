/**
 * Intelligent Caching Strategies - Advanced caching patterns for optimal performance
 * Implements LRU, Write-through, Write-behind, and TTL-based caching strategies
 */

import { redisClient, CacheOptions } from './redis-client';
import { performance } from 'perf_hooks';
import { createHash } from 'crypto';

export interface CacheStrategy {
  name: string;
  description: string;
  defaultTTL: number;
  maxSize?: number;
  evictionPolicy?: 'LRU' | 'FIFO' | 'TTL';
}

export interface CachingContext {
  namespace: string;
  strategy: CacheStrategy;
  tags?: string[];
  priority?: 'low' | 'normal' | 'high';
  compression?: boolean;
}

export interface CacheOperation {
  key: string;
  operation: 'read' | 'write' | 'delete';
  cost: number; // Computational cost (ms)
  frequency: number; // Access frequency
  size: number; // Data size in bytes
  lastAccess: Date;
}

export class CacheStrategyManager {
  private strategies: Map<string, CacheStrategy> = new Map();
  private operationHistory: Map<string, CacheOperation> = new Map();
  private readonly HISTORY_LIMIT = 10000;

  constructor() {
    this.initializeStrategies();
  }

  /**
   * Initialize predefined caching strategies
   */
  private initializeStrategies(): void {
    // Embedding cache - High TTL for stable embeddings
    this.strategies.set('embeddings', {
      name: 'embeddings',
      description: 'Cache for AI model embeddings with high TTL',
      defaultTTL: 86400, // 24 hours
      maxSize: 100000,
      evictionPolicy: 'LRU'
    });

    // Search results - Medium TTL for dynamic content
    this.strategies.set('search', {
      name: 'search',
      description: 'Cache for search results with medium TTL',
      defaultTTL: 3600, // 1 hour
      maxSize: 50000,
      evictionPolicy: 'TTL'
    });

    // User sessions - Short TTL for security
    this.strategies.set('sessions', {
      name: 'sessions',
      description: 'Cache for user sessions with short TTL',
      defaultTTL: 1800, // 30 minutes
      maxSize: 10000,
      evictionPolicy: 'TTL'
    });

    // API responses - Medium TTL for external API data
    this.strategies.set('api_responses', {
      name: 'api_responses',
      description: 'Cache for external API responses',
      defaultTTL: 7200, // 2 hours
      maxSize: 25000,
      evictionPolicy: 'LRU'
    });

    // Database queries - Short TTL for consistency
    this.strategies.set('database', {
      name: 'database',
      description: 'Cache for database query results',
      defaultTTL: 900, // 15 minutes
      maxSize: 75000,
      evictionPolicy: 'LRU'
    });

    // Static content - Very high TTL
    this.strategies.set('static', {
      name: 'static',
      description: 'Cache for static content and assets',
      defaultTTL: 604800, // 7 days
      maxSize: 200000,
      evictionPolicy: 'FIFO'
    });

    // Real-time data - Very short TTL
    this.strategies.set('realtime', {
      name: 'realtime',
      description: 'Cache for real-time data with very short TTL',
      defaultTTL: 60, // 1 minute
      maxSize: 5000,
      evictionPolicy: 'TTL'
    });
  }

  /**
   * Generate cache key with strategy-specific hashing
   */
  private generateCacheKey(key: string, context: CachingContext): string {
    const hash = createHash('sha256')
      .update(`${context.namespace}:${key}`)
      .digest('hex')
      .substring(0, 16);
    
    return `${context.strategy.name}:${hash}`;
  }

  /**
   * Record cache operation for analytics
   */
  private recordOperation(
    key: string,
    operation: CacheOperation['operation'],
    cost: number,
    size: number
  ): void {
    const existing = this.operationHistory.get(key);
    
    if (existing) {
      existing.frequency++;
      existing.lastAccess = new Date();
      existing.cost = (existing.cost + cost) / 2; // Running average
    } else {
      this.operationHistory.set(key, {
        key,
        operation,
        cost,
        frequency: 1,
        size,
        lastAccess: new Date()
      });
    }

    // Limit history size
    if (this.operationHistory.size > this.HISTORY_LIMIT) {
      const oldestKey = Array.from(this.operationHistory.entries())
        .sort(([, a], [, b]) => a.lastAccess.getTime() - b.lastAccess.getTime())[0][0];
      this.operationHistory.delete(oldestKey);
    }
  }

  /**
   * Intelligent cache-aside pattern with fallback
   */
  async cacheAside<T>(
    key: string,
    fetcher: () => Promise<T>,
    context: CachingContext
  ): Promise<T> {
    const startTime = performance.now();
    const cacheKey = this.generateCacheKey(key, context);
    
    try {
      // Try to get from cache first
      const cached = await redisClient.get<T>(cacheKey, {
        namespace: context.namespace,
        tags: context.tags,
        serializer: 'json'
      });

      if (cached !== null) {
        const cost = performance.now() - startTime;
        this.recordOperation(key, 'read', cost, JSON.stringify(cached).length);
        return cached;
      }

      // Cache miss - fetch data
      const data = await fetcher();
      const fetchCost = performance.now() - startTime;
      
      // Store in cache with strategy-specific TTL
      await redisClient.set(cacheKey, data, {
        ttl: context.strategy.defaultTTL,
        namespace: context.namespace,
        tags: context.tags,
        compress: context.compression,
        serializer: 'json'
      });

      this.recordOperation(key, 'write', fetchCost, JSON.stringify(data).length);
      return data;

    } catch (error) {
      console.error('Cache-aside error:', error);
      // Fallback to direct fetch
      const data = await fetcher();
      const cost = performance.now() - startTime;
      this.recordOperation(key, 'read', cost, JSON.stringify(data).length);
      return data;
    }
  }

  /**
   * Write-through caching pattern
   */
  async writeThrough<T>(
    key: string,
    data: T,
    writer: (data: T) => Promise<T>,
    context: CachingContext
  ): Promise<T> {
    const startTime = performance.now();
    const cacheKey = this.generateCacheKey(key, context);
    
    try {
      // Write to primary storage first
      const result = await writer(data);
      
      // Then write to cache
      await redisClient.set(cacheKey, result, {
        ttl: context.strategy.defaultTTL,
        namespace: context.namespace,
        tags: context.tags,
        compress: context.compression,
        serializer: 'json'
      });

      const cost = performance.now() - startTime;
      this.recordOperation(key, 'write', cost, JSON.stringify(result).length);
      
      return result;

    } catch (error) {
      console.error('Write-through error:', error);
      throw error;
    }
  }

  /**
   * Write-behind (write-back) caching pattern
   */
  async writeBehind<T>(
    key: string,
    data: T,
    writer: (data: T) => Promise<T>,
    context: CachingContext,
    delay: number = 5000 // 5 second delay
  ): Promise<T> {
    const startTime = performance.now();
    const cacheKey = this.generateCacheKey(key, context);
    
    try {
      // Write to cache immediately
      await redisClient.set(cacheKey, data, {
        ttl: context.strategy.defaultTTL,
        namespace: context.namespace,
        tags: context.tags,
        compress: context.compression,
        serializer: 'json'
      });

      // Schedule background write to primary storage
      setTimeout(async () => {
        try {
          await writer(data);
          console.log(`Write-behind completed for key: ${key}`);
        } catch (error) {
          console.error('Write-behind background write failed:', error);
          // Optionally invalidate cache on write failure
          await redisClient.del(cacheKey, { namespace: context.namespace });
        }
      }, delay);

      const cost = performance.now() - startTime;
      this.recordOperation(key, 'write', cost, JSON.stringify(data).length);
      
      return data;

    } catch (error) {
      console.error('Write-behind error:', error);
      throw error;
    }
  }

  /**
   * Refresh-ahead caching pattern
   */
  async refreshAhead<T>(
    key: string,
    fetcher: () => Promise<T>,
    context: CachingContext,
    refreshThreshold: number = 0.8 // Refresh when 80% of TTL has passed
  ): Promise<T> {
    const startTime = performance.now();
    const cacheKey = this.generateCacheKey(key, context);
    
    try {
      const cached = await redisClient.get<T>(cacheKey, {
        namespace: context.namespace,
        tags: context.tags,
        serializer: 'json'
      });

      if (cached !== null) {
        // Check if refresh is needed (async background refresh)
        const ttl = await redisClient.getClient().ttl(
          redisClient['generateKey'](cacheKey, { namespace: context.namespace })
        );
        
        const refreshTime = context.strategy.defaultTTL * refreshThreshold;
        if (ttl > 0 && ttl < refreshTime) {
          // Background refresh
          setTimeout(async () => {
            try {
              const freshData = await fetcher();
              await redisClient.set(cacheKey, freshData, {
                ttl: context.strategy.defaultTTL,
                namespace: context.namespace,
                tags: context.tags,
                compress: context.compression,
                serializer: 'json'
              });
              console.log(`Refresh-ahead completed for key: ${key}`);
            } catch (error) {
              console.error('Refresh-ahead background refresh failed:', error);
            }
          }, 0);
        }

        const cost = performance.now() - startTime;
        this.recordOperation(key, 'read', cost, JSON.stringify(cached).length);
        return cached;
      }

      // Cache miss - fetch and store
      const data = await fetcher();
      await redisClient.set(cacheKey, data, {
        ttl: context.strategy.defaultTTL,
        namespace: context.namespace,
        tags: context.tags,
        compress: context.compression,
        serializer: 'json'
      });

      const cost = performance.now() - startTime;
      this.recordOperation(key, 'write', cost, JSON.stringify(data).length);
      return data;

    } catch (error) {
      console.error('Refresh-ahead error:', error);
      const data = await fetcher();
      const cost = performance.now() - startTime;
      this.recordOperation(key, 'read', cost, JSON.stringify(data).length);
      return data;
    }
  }

  /**
   * Bulk cache operations with pipeline
   */
  async bulkGet<T>(
    keys: string[],
    context: CachingContext
  ): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();
    
    try {
      const pipeline = redisClient.getClient().pipeline();
      const cacheKeys = keys.map(key => this.generateCacheKey(key, context));
      
      // Add all get operations to pipeline
      for (const cacheKey of cacheKeys) {
        pipeline.get(redisClient['generateKey'](cacheKey, { namespace: context.namespace }));
      }

      const pipelineResults = await pipeline.exec();
      
      // Process results
      if (pipelineResults) {
        for (let i = 0; i < keys.length; i++) {
          const [error, value] = pipelineResults[i] || [null, null];
          if (!error && value !== null) {
            try {
              results.set(keys[i], JSON.parse(value as string));
            } catch {
              results.set(keys[i], value as T);
            }
          } else {
            results.set(keys[i], null);
          }
        }
      }

    } catch (error) {
      console.error('Bulk get error:', error);
      // Set all keys to null on error
      keys.forEach(key => results.set(key, null));
    }

    return results;
  }

  /**
   * Bulk cache set with pipeline
   */
  async bulkSet<T>(
    data: Map<string, T>,
    context: CachingContext
  ): Promise<boolean> {
    try {
      const pipeline = redisClient.getClient().pipeline();
      
      for (const [key, value] of data.entries()) {
        const cacheKey = this.generateCacheKey(key, context);
        const fullKey = redisClient['generateKey'](cacheKey, { namespace: context.namespace });
        const serializedValue = JSON.stringify(value);
        
        pipeline.setex(fullKey, context.strategy.defaultTTL, serializedValue);
        
        // Handle tags
        if (context.tags) {
          for (const tag of context.tags) {
            const tagKey = redisClient['generateKey'](`tag:${tag}`, { namespace: context.namespace });
            pipeline.sadd(tagKey, fullKey);
            pipeline.expire(tagKey, context.strategy.defaultTTL);
          }
        }
      }

      await pipeline.exec();
      return true;

    } catch (error) {
      console.error('Bulk set error:', error);
      return false;
    }
  }

  /**
   * Get strategy by name
   */
  getStrategy(name: string): CacheStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Get all available strategies
   */
  getAllStrategies(): CacheStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get cache operation analytics
   */
  getOperationAnalytics(): {
    totalOperations: number;
    avgCost: number;
    mostFrequent: CacheOperation[];
    recentOperations: CacheOperation[];
    costDistribution: { low: number; medium: number; high: number };
  } {
    const operations = Array.from(this.operationHistory.values());
    
    const totalOperations = operations.length;
    const avgCost = operations.reduce((sum, op) => sum + op.cost, 0) / totalOperations || 0;
    
    const mostFrequent = operations
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
    
    const recentOperations = operations
      .sort((a, b) => b.lastAccess.getTime() - a.lastAccess.getTime())
      .slice(0, 20);

    const costDistribution = operations.reduce(
      (dist, op) => {
        if (op.cost < 10) dist.low++;
        else if (op.cost < 100) dist.medium++;
        else dist.high++;
        return dist;
      },
      { low: 0, medium: 0, high: 0 }
    );

    return {
      totalOperations,
      avgCost,
      mostFrequent,
      recentOperations,
      costDistribution
    };
  }

  /**
   * Clear operation history
   */
  clearOperationHistory(): void {
    this.operationHistory.clear();
  }
}

// Export singleton instance
export const cacheStrategyManager = new CacheStrategyManager();