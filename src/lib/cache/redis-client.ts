/**
 * Redis Client - Centralized Redis connection and caching infrastructure
 * Provides high-performance caching with intelligent strategies and monitoring
 */

import Redis from 'ioredis';
import { z } from 'zod';
import { performance } from 'perf_hooks';

// Redis configuration schema
const RedisConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(6379),
  password: z.string().optional(),
  db: z.number().default(0),
  retryDelayOnFailover: z.number().default(100),
  maxRetriesPerRequest: z.number().default(3),
  lazyConnect: z.boolean().default(true),
  keepAlive: z.number().default(30000),
  connectTimeout: z.number().default(10000),
  commandTimeout: z.number().default(5000),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compress?: boolean; // Enable compression for large values
  tags?: string[]; // Cache tags for bulk invalidation
  namespace?: string; // Cache namespace for organization
  serializer?: 'json' | 'msgpack' | 'raw'; // Serialization format
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  avgResponseTime: number;
  memoryUsage: number;
  connectedClients: number;
  lastUpdated: Date;
}

export interface CacheMetric {
  operation: 'get' | 'set' | 'del' | 'exists' | 'expire';
  key: string;
  namespace?: string;
  hit: boolean;
  responseTime: number;
  dataSize?: number;
  timestamp: Date;
}

export class RedisClient {
  private client: Redis;
  private config: RedisConfig;
  private stats: CacheStats;
  private metrics: CacheMetric[] = [];
  private readonly MAX_METRICS = 1000;
  private readonly DEFAULT_TTL = 3600; // 1 hour
  
  constructor(config: Partial<RedisConfig> = {}) {
    this.config = RedisConfigSchema.parse(config);
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalRequests: 0,
      avgResponseTime: 0,
      memoryUsage: 0,
      connectedClients: 0,
      lastUpdated: new Date()
    };

    this.client = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      retryDelayOnFailover: this.config.retryDelayOnFailover,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      lazyConnect: this.config.lazyConnect,
      keepAlive: this.config.keepAlive,
      connectTimeout: this.config.connectTimeout,
      commandTimeout: this.config.commandTimeout,
      // Connection event handlers
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // or `return 1;`
        }
        return false;
      },
    });

    this.setupEventHandlers();
  }

  /**
   * Setup Redis connection event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('Redis client connected');
    });

    this.client.on('ready', () => {
      console.log('Redis client ready');
    });

    this.client.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    this.client.on('close', () => {
      console.log('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      console.log('Redis client reconnecting...');
    });

    this.client.on('end', () => {
      console.log('Redis connection ended');
    });
  }

  /**
   * Generate cache key with namespace
   */
  private generateKey(key: string, namespace?: string): string {
    const prefix = 'synapse:';
    const ns = namespace ? `${namespace}:` : '';
    return `${prefix}${ns}${key}`;
  }

  /**
   * Serialize value for storage
   */
  private serialize(value: any, serializer: CacheOptions['serializer'] = 'json'): string {
    switch (serializer) {
      case 'json':
        return JSON.stringify(value);
      case 'raw':
        return typeof value === 'string' ? value : String(value);
      case 'msgpack':
        // For now, fall back to JSON. In production, use msgpack library
        return JSON.stringify(value);
      default:
        return JSON.stringify(value);
    }
  }

  /**
   * Deserialize value from storage
   */
  private deserialize(value: string, serializer: CacheOptions['serializer'] = 'json'): any {
    switch (serializer) {
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      case 'raw':
        return value;
      case 'msgpack':
        // For now, fall back to JSON. In production, use msgpack library
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
    }
  }

  /**
   * Record cache metric
   */
  private recordMetric(metric: CacheMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift();
    }
    
    // Update stats
    this.stats.totalRequests++;
    if (metric.hit) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    
    this.stats.hitRate = this.stats.hits / this.stats.totalRequests;
    this.stats.avgResponseTime = (
      (this.stats.avgResponseTime * (this.stats.totalRequests - 1) + metric.responseTime) /
      this.stats.totalRequests
    );
    this.stats.lastUpdated = new Date();
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const startTime = performance.now();
    const cacheKey = this.generateKey(key, options.namespace);
    
    try {
      const value = await this.client.get(cacheKey);
      const responseTime = performance.now() - startTime;
      
      if (value === null) {
        this.recordMetric({
          operation: 'get',
          key: cacheKey,
          namespace: options.namespace,
          hit: false,
          responseTime,
          timestamp: new Date()
        });
        return null;
      }

      const deserializedValue = this.deserialize(value, options.serializer);
      
      this.recordMetric({
        operation: 'get',
        key: cacheKey,
        namespace: options.namespace,
        hit: true,
        responseTime,
        dataSize: value.length,
        timestamp: new Date()
      });

      return deserializedValue;
    } catch (error) {
      console.error('Redis get error:', error);
      this.recordMetric({
        operation: 'get',
        key: cacheKey,
        namespace: options.namespace,
        hit: false,
        responseTime: performance.now() - startTime,
        timestamp: new Date()
      });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    const startTime = performance.now();
    const cacheKey = this.generateKey(key, options.namespace);
    const ttl = options.ttl || this.DEFAULT_TTL;
    
    try {
      const serializedValue = this.serialize(value, options.serializer);
      
      const result = await this.client.setex(cacheKey, ttl, serializedValue);
      const responseTime = performance.now() - startTime;
      
      // Store tags for bulk invalidation
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          const tagKey = this.generateKey(`tag:${tag}`, options.namespace);
          await this.client.sadd(tagKey, cacheKey);
          await this.client.expire(tagKey, ttl);
        }
      }
      
      this.recordMetric({
        operation: 'set',
        key: cacheKey,
        namespace: options.namespace,
        hit: true,
        responseTime,
        dataSize: serializedValue.length,
        timestamp: new Date()
      });

      return result === 'OK';
    } catch (error) {
      console.error('Redis set error:', error);
      this.recordMetric({
        operation: 'set',
        key: cacheKey,
        namespace: options.namespace,
        hit: false,
        responseTime: performance.now() - startTime,
        timestamp: new Date()
      });
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async del(key: string, options: CacheOptions = {}): Promise<boolean> {
    const startTime = performance.now();
    const cacheKey = this.generateKey(key, options.namespace);
    
    try {
      const result = await this.client.del(cacheKey);
      const responseTime = performance.now() - startTime;
      
      this.recordMetric({
        operation: 'del',
        key: cacheKey,
        namespace: options.namespace,
        hit: result > 0,
        responseTime,
        timestamp: new Date()
      });

      return result > 0;
    } catch (error) {
      console.error('Redis del error:', error);
      this.recordMetric({
        operation: 'del',
        key: cacheKey,
        namespace: options.namespace,
        hit: false,
        responseTime: performance.now() - startTime,
        timestamp: new Date()
      });
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    const startTime = performance.now();
    const cacheKey = this.generateKey(key, options.namespace);
    
    try {
      const result = await this.client.exists(cacheKey);
      const responseTime = performance.now() - startTime;
      
      this.recordMetric({
        operation: 'exists',
        key: cacheKey,
        namespace: options.namespace,
        hit: result > 0,
        responseTime,
        timestamp: new Date()
      });

      return result > 0;
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key: string, ttl: number, options: CacheOptions = {}): Promise<boolean> {
    const startTime = performance.now();
    const cacheKey = this.generateKey(key, options.namespace);
    
    try {
      const result = await this.client.expire(cacheKey, ttl);
      const responseTime = performance.now() - startTime;
      
      this.recordMetric({
        operation: 'expire',
        key: cacheKey,
        namespace: options.namespace,
        hit: result === 1,
        responseTime,
        timestamp: new Date()
      });

      return result === 1;
    } catch (error) {
      console.error('Redis expire error:', error);
      return false;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[], namespace?: string): Promise<number> {
    let deletedCount = 0;
    
    try {
      for (const tag of tags) {
        const tagKey = this.generateKey(`tag:${tag}`, namespace);
        const keys = await this.client.smembers(tagKey);
        
        if (keys.length > 0) {
          const deleted = await this.client.del(...keys);
          deletedCount += deleted;
        }
        
        // Clean up the tag key itself
        await this.client.del(tagKey);
      }
    } catch (error) {
      console.error('Redis invalidateByTags error:', error);
    }
    
    return deletedCount;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      if (memoryMatch) {
        this.stats.memoryUsage = parseInt(memoryMatch[1]);
      }

      const clients = await this.client.info('clients');
      const clientsMatch = clients.match(/connected_clients:(\d+)/);
      if (clientsMatch) {
        this.stats.connectedClients = parseInt(clientsMatch[1]);
      }
    } catch (error) {
      console.error('Error getting Redis stats:', error);
    }
    
    return { ...this.stats };
  }

  /**
   * Get recent cache metrics
   */
  getMetrics(limit: number = 100): CacheMetric[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = [];
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalRequests: 0,
      avgResponseTime: 0,
      memoryUsage: this.stats.memoryUsage,
      connectedClients: this.stats.connectedClients,
      lastUpdated: new Date()
    };
  }

  /**
   * Test Redis connection
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis ping error:', error);
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Get Redis client instance for advanced operations
   */
  getClient(): Redis {
    return this.client;
  }
}

// Export singleton instance
export const redisClient = new RedisClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
});