/**
 * Embedding generation service with OpenAI integration and Redis caching
 * Handles text-to-vector conversion for semantic search and similarity calculations
 */

import OpenAI from 'openai';
import { createHash } from 'crypto';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  AIModelConfig
} from '../../types/ai';

interface CacheConfig {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  keyPrefix: string;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  ping(): Promise<string>;
}

export class EmbeddingService {
  private openai: OpenAI;
  private redis?: RedisClient;
  private cache: CacheConfig;
  private performanceMetrics: {
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
    totalLatency: number;
    apiCalls: number;
    lastRequestTime: Date;
  };

  constructor(
    private config: AIModelConfig,
    redisClient?: RedisClient,
    cacheConfig?: Partial<CacheConfig>
  ) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });

    this.redis = redisClient;
    this.cache = {
      enabled: !!redisClient,
      ttl: 86400, // 24 hours default
      keyPrefix: 'synapse:embedding:',
      ...cacheConfig
    };

    this.performanceMetrics = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalLatency: 0,
      apiCalls: 0,
      lastRequestTime: new Date()
    };
  }

  /**
   * Generate embeddings for text input with caching
   */
  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startTime = Date.now();
    this.performanceMetrics.totalRequests++;
    this.performanceMetrics.lastRequestTime = new Date();

    try {
      // Handle both single string and array inputs
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const model = request.model || 'text-embedding-3-small';
      const dimensions = request.dimensions;

      // Check cache for each input
      const cachedResults: (number[] | null)[] = [];
      const uncachedInputs: { text: string; index: number }[] = [];

      for (let i = 0; i < inputs.length; i++) {
        const text = inputs[i];
        const cacheKey = this.generateCacheKey(text, model, dimensions);
        
        if (this.cache.enabled && this.redis) {
          const cached = await this.getCachedEmbedding(cacheKey);
          if (cached) {
            cachedResults[i] = cached;
            this.performanceMetrics.cacheHits++;
          } else {
            cachedResults[i] = null;
            uncachedInputs.push({ text, index: i });
            this.performanceMetrics.cacheMisses++;
          }
        } else {
          cachedResults[i] = null;
          uncachedInputs.push({ text, index: i });
        }
      }

      // Generate embeddings for uncached inputs
      let apiResponse: OpenAI.Embeddings.CreateResponse | null = null;
      if (uncachedInputs.length > 0) {
        const apiStartTime = Date.now();
        
        const embeddingParams: OpenAI.Embeddings.EmbeddingCreateParams = {
          input: uncachedInputs.map(item => item.text),
          model,
          ...(dimensions && { dimensions })
        };

        apiResponse = await this.openai.embeddings.create(embeddingParams);
        this.performanceMetrics.apiCalls++;
        
        // Cache the results
        if (this.cache.enabled && this.redis) {
          await Promise.all(uncachedInputs.map(async (item, apiIndex) => {
            const embedding = apiResponse!.data[apiIndex].embedding;
            const cacheKey = this.generateCacheKey(item.text, model, dimensions);
            await this.cacheEmbedding(cacheKey, embedding);
          }));
        }

        // Fill in the uncached results
        uncachedInputs.forEach((item, apiIndex) => {
          cachedResults[item.index] = apiResponse!.data[apiIndex].embedding;
        });
      }

      const processingTime = Date.now() - startTime;
      this.performanceMetrics.totalLatency += processingTime;

      // Combine cached and API results
      const embeddings = cachedResults as number[][];

      return {
        embeddings,
        model,
        usage: {
          promptTokens: apiResponse?.usage?.prompt_tokens || 0,
          totalTokens: apiResponse?.usage?.total_tokens || 0
        },
        processingTimeMs: processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.performanceMetrics.totalLatency += processingTime;
      throw this.handleError(error);
    }
  }

  /**
   * Generate single embedding with caching
   */
  async generateSingleEmbedding(
    text: string, 
    model?: string, 
    dimensions?: number
  ): Promise<number[]> {
    const response = await this.generateEmbeddings({
      input: text,
      model,
      dimensions
    });
    return response.embeddings[0];
  }

  /**
   * Generate embeddings in batches for large datasets
   */
  async generateBatchEmbeddings(
    texts: string[],
    batchSize: number = 100,
    model?: string,
    dimensions?: number,
    onProgress?: (completed: number, total: number) => void
  ): Promise<number[][]> {
    const results: number[][] = [];
    const total = texts.length;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.generateEmbeddings({
        input: batch,
        model,
        dimensions
      });
      
      results.push(...response.embeddings);
      
      if (onProgress) {
        onProgress(Math.min(i + batchSize, total), total);
      }

      // Add small delay between batches to respect rate limits
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  calculateCosineSimilarity(embeddingA: number[], embeddingB: number[]): number {
    if (embeddingA.length !== embeddingB.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < embeddingA.length; i++) {
      dotProduct += embeddingA[i] * embeddingB[i];
      normA += embeddingA[i] * embeddingA[i];
      normB += embeddingB[i] * embeddingB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find most similar embeddings from a collection
   */
  findMostSimilar(
    queryEmbedding: number[],
    embeddings: Array<{ id: string; embedding: number[]; metadata?: any }>,
    topK: number = 5,
    minSimilarity: number = 0.7
  ): Array<{ id: string; similarity: number; metadata?: any }> {
    const similarities = embeddings.map(item => ({
      id: item.id,
      similarity: this.calculateCosineSimilarity(queryEmbedding, item.embedding),
      metadata: item.metadata
    }));

    return similarities
      .filter(item => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Get embedding statistics and performance metrics
   */
  getMetrics() {
    const cacheHitRate = this.performanceMetrics.totalRequests > 0 
      ? this.performanceMetrics.cacheHits / this.performanceMetrics.totalRequests 
      : 0;

    const averageLatency = this.performanceMetrics.totalRequests > 0
      ? this.performanceMetrics.totalLatency / this.performanceMetrics.totalRequests
      : 0;

    const apiCallRate = this.performanceMetrics.totalRequests > 0
      ? this.performanceMetrics.apiCalls / this.performanceMetrics.totalRequests
      : 0;

    return {
      totalRequests: this.performanceMetrics.totalRequests,
      cacheHitRate,
      cacheMisses: this.performanceMetrics.cacheMisses,
      averageLatency,
      apiCalls: this.performanceMetrics.apiCalls,
      apiCallRate,
      lastRequestTime: this.performanceMetrics.lastRequestTime,
      cacheEnabled: this.cache.enabled,
      redisConnected: !!this.redis
    };
  }

  /**
   * Health check for the embedding service
   */
  async healthCheck(): Promise<{
    openaiConnected: boolean;
    redisConnected: boolean;
    testEmbeddingWorks: boolean;
  }> {
    const results = {
      openaiConnected: false,
      redisConnected: false,
      testEmbeddingWorks: false
    };

    try {
      // Test OpenAI connection
      const testResponse = await this.openai.embeddings.create({
        input: 'test',
        model: 'text-embedding-3-small'
      });
      results.openaiConnected = !!testResponse.data?.[0]?.embedding;
      results.testEmbeddingWorks = results.openaiConnected;
    } catch (error) {
      console.warn('OpenAI embedding health check failed:', error);
    }

    try {
      // Test Redis connection
      if (this.redis) {
        await this.redis.ping();
        results.redisConnected = true;
      }
    } catch (error) {
      console.warn('Redis health check failed:', error);
    }

    return results;
  }

  /**
   * Clear embedding cache
   */
  async clearCache(pattern?: string): Promise<number> {
    if (!this.redis || !this.cache.enabled) {
      return 0;
    }

    try {
      const keyPattern = pattern || `${this.cache.keyPrefix}*`;
      // Note: In production, you'd want to use SCAN instead of KEYS for large datasets
      const keys = await this.redis.get(`keys:${keyPattern}`) || '[]';
      const keyList = JSON.parse(keys) as string[];
      
      let deletedCount = 0;
      for (const key of keyList) {
        deletedCount += await this.redis.del(key);
      }
      
      return deletedCount;
    } catch (error) {
      console.warn('Failed to clear cache:', error);
      return 0;
    }
  }

  /**
   * Private helper methods
   */
  private generateCacheKey(text: string, model: string, dimensions?: number): string {
    const content = `${text}:${model}${dimensions ? `:${dimensions}` : ''}`;
    const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);
    return `${this.cache.keyPrefix}${hash}`;
  }

  private async getCachedEmbedding(cacheKey: string): Promise<number[] | null> {
    if (!this.redis) return null;

    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('Failed to get cached embedding:', error);
      return null;
    }
  }

  private async cacheEmbedding(cacheKey: string, embedding: number[]): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.set(cacheKey, JSON.stringify(embedding), this.cache.ttl);
    } catch (error) {
      console.warn('Failed to cache embedding:', error);
    }
  }

  private handleError(error: any): Error {
    if (error?.status === 429) {
      return new Error(`OpenAI rate limit exceeded: ${error.message}`);
    }

    if (error?.status === 400) {
      return new Error(`Invalid embedding request: ${error.message}`);
    }

    if (error?.status >= 500) {
      return new Error(`OpenAI API error: ${error.message}`);
    }

    return new Error(`Embedding generation failed: ${error.message || error}`);
  }
}

/**
 * Utility functions for working with embeddings
 */
export class EmbeddingUtils {
  /**
   * Normalize embedding vector to unit length
   */
  static normalize(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return norm === 0 ? embedding : embedding.map(val => val / norm);
  }

  /**
   * Calculate Euclidean distance between embeddings
   */
  static euclideanDistance(embeddingA: number[], embeddingB: number[]): number {
    if (embeddingA.length !== embeddingB.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    const sumSquaredDiffs = embeddingA.reduce((sum, val, i) => {
      const diff = val - embeddingB[i];
      return sum + diff * diff;
    }, 0);

    return Math.sqrt(sumSquaredDiffs);
  }

  /**
   * Calculate Manhattan distance between embeddings
   */
  static manhattanDistance(embeddingA: number[], embeddingB: number[]): number {
    if (embeddingA.length !== embeddingB.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    return embeddingA.reduce((sum, val, i) => sum + Math.abs(val - embeddingB[i]), 0);
  }

  /**
   * Reduce embedding dimensionality using PCA-like approach (simplified)
   */
  static reduceDimensionality(
    embeddings: number[][],
    targetDimensions: number
  ): number[][] {
    if (embeddings.length === 0 || targetDimensions <= 0) {
      return embeddings;
    }

    const originalDims = embeddings[0].length;
    if (targetDimensions >= originalDims) {
      return embeddings;
    }

    // Simple approach: take first N dimensions
    // In production, you'd want proper PCA or other dimensionality reduction
    return embeddings.map(embedding => embedding.slice(0, targetDimensions));
  }

  /**
   * Create embedding chunks for large text
   */
  static chunkText(
    text: string, 
    maxChunkSize: number = 8000, 
    overlapSize: number = 200
  ): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + maxChunkSize, text.length);
      let chunk = text.slice(start, end);

      // Try to break at a sentence or word boundary
      if (end < text.length) {
        const lastSentence = chunk.lastIndexOf('. ');
        const lastWord = chunk.lastIndexOf(' ');
        
        if (lastSentence > maxChunkSize * 0.8) {
          chunk = chunk.slice(0, lastSentence + 2);
        } else if (lastWord > maxChunkSize * 0.8) {
          chunk = chunk.slice(0, lastWord);
        }
      }

      chunks.push(chunk.trim());
      start = Math.max(start + maxChunkSize - overlapSize, start + chunk.length);
    }

    return chunks.filter(chunk => chunk.length > 0);
  }
}

/**
 * Factory function to create embedding service with different configurations
 */
export function createEmbeddingService(
  config: AIModelConfig,
  options?: {
    redis?: RedisClient;
    cacheConfig?: Partial<CacheConfig>;
  }
): EmbeddingService {
  return new EmbeddingService(config, options?.redis, options?.cacheConfig);
}