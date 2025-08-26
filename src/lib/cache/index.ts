/**
 * Cache Module - Centralized caching infrastructure
 * Exports Redis client, caching strategies, and performance monitoring
 */

// Core caching infrastructure
export { redisClient, RedisClient } from './redis-client';
export type { CacheOptions, CacheStats, CacheMetric } from './redis-client';

// Intelligent caching strategies
export { cacheStrategyManager, CacheStrategyManager } from './cache-strategies';
export type { 
  CacheStrategy, 
  CachingContext, 
  CacheOperation 
} from './cache-strategies';

// Convenience functions for common caching patterns
import { redisClient } from './redis-client';
import { cacheStrategyManager } from './cache-strategies';

/**
 * Quick cache operations with default strategies
 */
export const cache = {
  /**
   * Cache embeddings with long TTL
   */
  async embeddings<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return cacheStrategyManager.cacheAside(key, fetcher, {
      namespace: 'embeddings',
      strategy: cacheStrategyManager.getStrategy('embeddings')!,
      tags: ['ai', 'embeddings'],
      compression: true
    });
  },

  /**
   * Cache search results with medium TTL
   */
  async search<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return cacheStrategyManager.cacheAside(key, fetcher, {
      namespace: 'search',
      strategy: cacheStrategyManager.getStrategy('search')!,
      tags: ['search', 'results'],
      compression: true
    });
  },

  /**
   * Cache database queries with short TTL
   */
  async database<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return cacheStrategyManager.cacheAside(key, fetcher, {
      namespace: 'database',
      strategy: cacheStrategyManager.getStrategy('database')!,
      tags: ['database', 'query']
    });
  },

  /**
   * Cache API responses with medium TTL
   */
  async api<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return cacheStrategyManager.cacheAside(key, fetcher, {
      namespace: 'api',
      strategy: cacheStrategyManager.getStrategy('api_responses')!,
      tags: ['api', 'external']
    });
  },

  /**
   * Cache user sessions with short TTL
   */
  async session<T>(key: string, data: T): Promise<boolean> {
    return redisClient.set(key, data, {
      ttl: 1800, // 30 minutes
      namespace: 'sessions',
      tags: ['session', 'user']
    });
  },

  /**
   * Cache static content with very long TTL
   */
  async static<T>(key: string, data: T): Promise<boolean> {
    return redisClient.set(key, data, {
      ttl: 604800, // 7 days
      namespace: 'static',
      tags: ['static', 'content']
    });
  },

  /**
   * Get cached value
   */
  async get<T>(key: string, namespace?: string): Promise<T | null> {
    return redisClient.get<T>(key, { namespace });
  },

  /**
   * Set cached value with default TTL
   */
  async set<T>(key: string, value: T, ttl?: number, namespace?: string): Promise<boolean> {
    return redisClient.set(key, value, { ttl, namespace });
  },

  /**
   * Delete cached value
   */
  async del(key: string, namespace?: string): Promise<boolean> {
    return redisClient.del(key, { namespace });
  },

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[], namespace?: string): Promise<number> {
    return redisClient.invalidateByTags(tags, namespace);
  },

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    return redisClient.getStats();
  }
};

// Default export for convenience
export default cache;