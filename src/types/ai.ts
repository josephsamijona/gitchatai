/**
 * AI model types and interfaces for multi-model orchestration
 * Defines standardized interfaces for Claude, GPT-4, Kimi, Grok, and Gemini
 */

export type AIModel = 'claude' | 'gpt4' | 'kimi' | 'grok' | 'gemini';

export interface AIModelConfig {
  name: AIModel;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  enabled: boolean;
  priority?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  model?: AIModel;
  tokenCount?: number;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model: AIModel;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  systemPrompt?: string;
  metadata?: {
    conversationId?: string;
    branchId?: string;
    projectId?: string;
    contextSummary?: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  model: AIModel;
  content: string;
  finishReason: 'stop' | 'length' | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  processingTimeMs: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface StreamingResponse {
  id: string;
  model: AIModel;
  delta: string;
  finished: boolean;
  finishReason?: 'stop' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  processingTimeMs?: number;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  processingTimeMs: number;
}

export interface AIModelCapabilities {
  maxContextLength: number;
  supportsStreaming: boolean;
  supportsSystemMessages: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  pricePerInputToken: number;
  pricePerOutputToken: number;
  rateLimitRpm: number;
  rateLimitTpm: number;
  supportedLanguages: string[];
  strengths: string[];
  weaknesses: string[];
}

export interface ConversationContext {
  conversationId: string;
  branchId: string;
  projectId?: string;
  customInstructions?: string;
  recentMessages: ChatMessage[];
  relevantDocuments?: Array<{
    id: string;
    content: string;
    similarity: number;
  }>;
  relatedConcepts?: Array<{
    id: string;
    name: string;
    description: string;
    similarity: number;
  }>;
  branchContext?: {
    parentMessages: ChatMessage[];
    branchSummary: string;
    model: AIModel;
  };
}

export interface ModelOrchestrationOptions {
  preferredModel?: AIModel;
  fallbackModels?: AIModel[];
  maxRetries?: number;
  retryDelay?: number;
  timeoutMs?: number;
  enableContextRetrieval?: boolean;
  contextRetrievalLimit?: number;
  preserveContext?: boolean;
  optimizePrompts?: boolean;
}

export interface AIModelPerformanceMetrics {
  model: AIModel;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  totalTokensUsed: number;
  totalCost: number;
  uptime: number;
  lastRequestTime: Date;
  errorRate: number;
  averageQualityScore?: number;
}

export interface ModelSwitchEvent {
  fromModel: AIModel;
  toModel: AIModel;
  reason: 'user_request' | 'failure' | 'optimization' | 'fallback';
  conversationId: string;
  branchId: string;
  timestamp: Date;
  contextPreserved: boolean;
  switchTimeMs: number;
}

export interface AIModelError extends Error {
  model: AIModel;
  type: 'api_error' | 'rate_limit' | 'timeout' | 'invalid_request' | 'context_limit' | 'authentication' | 'content_filter' | 'unknown';
  statusCode?: number;
  retryable: boolean;
  retryAfter?: number;
  originalError?: any;
}

export interface PromptOptimization {
  model: AIModel;
  originalPrompt: string;
  optimizedPrompt: string;
  optimizations: Array<{
    type: 'format' | 'length' | 'specificity' | 'examples' | 'structure' | 'context' | 'reasoning';
    description: string;
    before: string;
    after: string;
  }>;
  estimatedImprovementScore: number;
}

export interface ContextRetrieval {
  vectorResults: Array<{
    id: string;
    content: string;
    embedding: number[];
    similarity: number;
    type: 'message' | 'document' | 'concept';
  }>;
  fullTextResults: Array<{
    id: string;
    content: string;
    score: number;
    type: 'message' | 'document' | 'concept';
  }>;
  hybridResults: Array<{
    id: string;
    content: string;
    vectorSimilarity: number;
    textScore: number;
    combinedScore: number;
    type: 'message' | 'document' | 'concept';
  }>;
  retrievalTimeMs: number;
  totalResults: number;
}

// Base interface that all AI model clients must implement
export interface IAIModelClient {
  readonly model: AIModel;
  readonly capabilities: AIModelCapabilities;
  readonly config: AIModelConfig;
  readonly isEnabled: boolean;

  // Core chat completion methods
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamingResponse, void, unknown>;

  // Health and status methods
  healthCheck(): Promise<boolean>;
  getStatus(): Promise<{
    healthy: boolean;
    latency: number;
    errorRate: number;
    rateLimitStatus: {
      remainingRequests: number;
      remainingTokens: number;
      resetTime: Date;
    };
  }>;

  // Prompt optimization specific to this model
  optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization>;

  // Cost estimation
  estimateCost(request: ChatCompletionRequest): number;

  // Rate limit management
  canMakeRequest(): boolean;
  getRateLimitStatus(): {
    remainingRequests: number;
    remainingTokens: number;
    resetTime: Date;
  };
}

// Factory interface for creating model clients
export interface AIModelClientFactory {
  createClient(config: AIModelConfig): IAIModelClient;
  getSupportedModels(): AIModel[];
  validateConfig(config: AIModelConfig): boolean;
}