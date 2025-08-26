/**
 * ModelOrchestrator: Central AI model coordination with context preservation and fallback
 * Handles seamless model switching, context management, and multi-step workflows
 */

import type {
  AIModel,
  AIModelConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingResponse,
  ConversationContext,
  ModelOrchestrationOptions,
  AIModelPerformanceMetrics,
  ModelSwitchEvent,
  IAIModelClient,
  AIModelError,
  PromptOptimization,
  ContextRetrieval
} from '../../types/ai';

import { OpenAIClient } from './openai';
import { ClaudeClient } from './claude';
import { KimiClient } from './kimi';
import { GrokClient } from './grok';
import { GeminiClient } from './gemini';
import { EmbeddingService } from './embeddings';

interface ProcessedResponse extends ChatCompletionResponse {
  contextUsed?: ContextRetrieval;
  modelSwitchEvent?: ModelSwitchEvent;
  optimizations?: PromptOptimization;
}

interface OrchestratorConfig {
  models: Record<AIModel, AIModelConfig>;
  defaultModel: AIModel;
  fallbackChain: AIModel[];
  embeddingService?: EmbeddingService;
  contextRetrieval?: {
    enabled: boolean;
    maxResults: number;
    similarityThreshold: number;
  };
}

export class ModelOrchestrator {
  private clients: Map<AIModel, IAIModelClient> = new Map();
  private performanceMetrics: Map<AIModel, AIModelPerformanceMetrics> = new Map();
  private modelSwitchHistory: ModelSwitchEvent[] = [];
  private embeddingService?: EmbeddingService;
  
  constructor(private config: OrchestratorConfig) {
    this.initializeClients();
    this.initializePerformanceMetrics();
    this.embeddingService = config.embeddingService;
  }

  /**
   * Main orchestration method - processes message with optimal model selection
   */
  async processMessage(
    content: string,
    branchId: string,
    preferredModel?: AIModel,
    context?: ConversationContext,
    options?: ModelOrchestrationOptions
  ): Promise<ProcessedResponse> {
    const startTime = Date.now();
    let selectedModel = preferredModel || options?.preferredModel || this.config.defaultModel;
    let contextRetrieval: ContextRetrieval | undefined;
    let modelSwitchEvent: ModelSwitchEvent | undefined;
    let optimizations: PromptOptimization | undefined;

    try {
      // Step 1: Context retrieval if enabled
      if (options?.enableContextRetrieval && this.embeddingService && context) {
        contextRetrieval = await this.retrieveContext(content, context, options.contextRetrievalLimit);
      }

      // Step 2: Build enhanced conversation context
      const enhancedContext = this.buildEnhancedContext(context, contextRetrieval);

      // Step 3: Select optimal model based on request characteristics
      const optimalModel = await this.selectOptimalModel(
        content, 
        selectedModel, 
        enhancedContext, 
        options
      );

      // Step 4: Handle model switching if needed
      if (optimalModel !== selectedModel && context?.conversationId) {
        modelSwitchEvent = {
          fromModel: selectedModel,
          toModel: optimalModel,
          reason: 'optimization',
          conversationId: context.conversationId,
          branchId,
          timestamp: new Date(),
          contextPreserved: !!enhancedContext,
          switchTimeMs: Date.now() - startTime
        };
        this.modelSwitchHistory.push(modelSwitchEvent);
        selectedModel = optimalModel;
      }

      // Step 5: Optimize prompt for selected model
      if (options?.optimizePrompts) {
        const client = this.clients.get(selectedModel);
        if (client) {
          optimizations = await client.optimizePrompt(content, enhancedContext);
          content = optimizations.optimizedPrompt;
        }
      }

      // Step 6: Prepare request with enhanced context
      const request: ChatCompletionRequest = {
        messages: this.buildMessageHistory(content, enhancedContext),
        model: selectedModel,
        maxTokens: options?.timeoutMs ? Math.min(4000, Math.floor(options.timeoutMs / 10)) : undefined,
        temperature: this.getOptimalTemperature(selectedModel, content),
        systemPrompt: this.buildSystemPrompt(selectedModel, enhancedContext),
        metadata: {
          conversationId: context?.conversationId,
          branchId,
          projectId: context?.projectId,
          contextSummary: this.generateContextSummary(enhancedContext)
        }
      };

      // Step 7: Execute with fallback chain
      const response = await this.executeWithFallback(
        request,
        selectedModel,
        options?.fallbackModels || this.config.fallbackChain,
        options?.maxRetries || 3
      );

      // Step 8: Update performance metrics
      this.updatePerformanceMetrics(selectedModel, response.processingTimeMs, true);

      return {
        ...response,
        contextUsed: contextRetrieval,
        modelSwitchEvent,
        optimizations
      };

    } catch (error) {
      this.updatePerformanceMetrics(selectedModel, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Streaming version of processMessage
   */
  async* streamMessage(
    content: string,
    branchId: string,
    preferredModel?: AIModel,
    context?: ConversationContext,
    options?: ModelOrchestrationOptions
  ): AsyncGenerator<StreamingResponse, void, unknown> {
    const startTime = Date.now();
    let selectedModel = preferredModel || options?.preferredModel || this.config.defaultModel;

    try {
      // Context retrieval and model optimization (same as processMessage)
      let contextRetrieval: ContextRetrieval | undefined;
      if (options?.enableContextRetrieval && this.embeddingService && context) {
        contextRetrieval = await this.retrieveContext(content, context, options.contextRetrievalLimit);
      }

      const enhancedContext = this.buildEnhancedContext(context, contextRetrieval);
      const optimalModel = await this.selectOptimalModel(content, selectedModel, enhancedContext, options);
      
      if (optimalModel !== selectedModel) {
        selectedModel = optimalModel;
      }

      if (options?.optimizePrompts) {
        const client = this.clients.get(selectedModel);
        if (client) {
          const optimization = await client.optimizePrompt(content, enhancedContext);
          content = optimization.optimizedPrompt;
        }
      }

      const request: ChatCompletionRequest = {
        messages: this.buildMessageHistory(content, enhancedContext),
        model: selectedModel,
        maxTokens: options?.timeoutMs ? Math.min(4000, Math.floor(options.timeoutMs / 10)) : undefined,
        temperature: this.getOptimalTemperature(selectedModel, content),
        systemPrompt: this.buildSystemPrompt(selectedModel, enhancedContext),
        metadata: {
          conversationId: context?.conversationId,
          branchId,
          projectId: context?.projectId,
          contextSummary: this.generateContextSummary(enhancedContext)
        }
      };

      // Execute streaming with fallback
      const client = this.clients.get(selectedModel);
      if (!client || !client.isEnabled) {
        throw new Error(`Model ${selectedModel} is not available`);
      }

      let finished = false;
      try {
        for await (const chunk of client.streamChat(request)) {
          yield chunk;
          finished = chunk.finished;
        }
        
        if (finished) {
          this.updatePerformanceMetrics(selectedModel, Date.now() - startTime, true);
        }
      } catch (error) {
        // Try fallback models for streaming
        const fallbackModels = options?.fallbackModels || this.config.fallbackChain;
        for (const fallbackModel of fallbackModels) {
          if (fallbackModel === selectedModel) continue;
          
          const fallbackClient = this.clients.get(fallbackModel);
          if (fallbackClient && fallbackClient.isEnabled) {
            try {
              for await (const chunk of fallbackClient.streamChat({ ...request, model: fallbackModel })) {
                yield chunk;
              }
              this.updatePerformanceMetrics(fallbackModel, Date.now() - startTime, true);
              return;
            } catch (fallbackError) {
              console.warn(`Fallback model ${fallbackModel} also failed:`, fallbackError);
              continue;
            }
          }
        }
        throw error;
      }

    } catch (error) {
      this.updatePerformanceMetrics(selectedModel, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Switch model mid-conversation with context preservation
   */
  async switchModel(
    newModel: AIModel,
    conversationId: string,
    branchId: string,
    context?: ConversationContext,
    reason: ModelSwitchEvent['reason'] = 'user_request'
  ): Promise<ModelSwitchEvent> {
    const startTime = Date.now();
    const currentModel = context?.branchContext?.model || this.config.defaultModel;

    // Validate new model availability
    const newClient = this.clients.get(newModel);
    if (!newClient || !newClient.isEnabled) {
      throw new Error(`Model ${newModel} is not available`);
    }

    // Create context summary for preservation
    let contextSummary = '';
    if (context && this.embeddingService) {
      const recentMessages = context.recentMessages.slice(-5); // Last 5 messages
      contextSummary = recentMessages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }

    const switchEvent: ModelSwitchEvent = {
      fromModel: currentModel,
      toModel: newModel,
      reason,
      conversationId,
      branchId,
      timestamp: new Date(),
      contextPreserved: !!contextSummary,
      switchTimeMs: Date.now() - startTime
    };

    this.modelSwitchHistory.push(switchEvent);
    return switchEvent;
  }

  /**
   * Get comprehensive status of all models
   */
  async getModelsStatus() {
    const status: Record<AIModel, any> = {} as Record<AIModel, any>;

    for (const [model, client] of this.clients.entries()) {
      try {
        const clientStatus = await client.getStatus();
        const metrics = this.performanceMetrics.get(model);
        
        status[model] = {
          ...clientStatus,
          enabled: client.isEnabled,
          capabilities: client.capabilities,
          metrics: metrics || this.getDefaultMetrics(model),
          lastUsed: metrics?.lastRequestTime || null
        };
      } catch (error) {
        status[model] = {
          healthy: false,
          enabled: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return {
      models: status,
      defaultModel: this.config.defaultModel,
      fallbackChain: this.config.fallbackChain,
      totalSwitches: this.modelSwitchHistory.length,
      embeddingServiceAvailable: !!this.embeddingService
    };
  }

  /**
   * Get model performance analytics
   */
  getPerformanceAnalytics() {
    const analytics: Record<AIModel, any> = {} as Record<AIModel, any>;
    
    for (const [model, metrics] of this.performanceMetrics.entries()) {
      analytics[model] = {
        ...metrics,
        successRate: metrics.totalRequests > 0 
          ? (metrics.successfulRequests / metrics.totalRequests) * 100 
          : 0,
        averageCost: this.calculateAverageCost(model, metrics),
        reliability: this.calculateReliability(metrics),
        performance: this.calculatePerformanceScore(metrics)
      };
    }

    const modelSwitchAnalytics = this.analyzeModelSwitches();

    return {
      models: analytics,
      switches: modelSwitchAnalytics,
      recommendations: this.generateRecommendations(analytics)
    };
  }

  /**
   * Private helper methods
   */
  private initializeClients(): void {
    for (const [model, config] of Object.entries(this.config.models)) {
      if (!config.enabled) continue;

      let client: IAIModelClient;
      switch (model as AIModel) {
        case 'openai':
        case 'gpt4':
          client = new OpenAIClient(config);
          break;
        case 'claude':
          client = new ClaudeClient(config);
          break;
        case 'kimi':
          client = new KimiClient(config);
          break;
        case 'grok':
          client = new GrokClient(config);
          break;
        case 'gemini':
          client = new GeminiClient(config);
          break;
        default:
          console.warn(`Unknown model type: ${model}`);
          continue;
      }

      this.clients.set(model as AIModel, client);
    }
  }

  private initializePerformanceMetrics(): void {
    for (const model of this.clients.keys()) {
      this.performanceMetrics.set(model, this.getDefaultMetrics(model));
    }
  }

  private getDefaultMetrics(model: AIModel): AIModelPerformanceMetrics {
    return {
      model,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      uptime: 100,
      lastRequestTime: new Date(),
      errorRate: 0
    };
  }

  private async retrieveContext(
    content: string,
    context: ConversationContext,
    maxResults?: number
  ): Promise<ContextRetrieval> {
    if (!this.embeddingService) {
      throw new Error('Embedding service not configured');
    }

    const startTime = Date.now();
    const queryEmbedding = await this.embeddingService.generateSingleEmbedding(content);

    // Simulate vector search results (in production, this would query TiDB)
    const vectorResults = [
      {
        id: 'vec_1',
        content: 'Previous relevant conversation context...',
        embedding: queryEmbedding,
        similarity: 0.85,
        type: 'message' as const
      }
    ];

    const fullTextResults = [
      {
        id: 'txt_1',
        content: 'Full text search result...',
        score: 0.7,
        type: 'message' as const
      }
    ];

    const hybridResults = [
      {
        id: 'hyb_1',
        content: 'Hybrid search result...',
        vectorSimilarity: 0.8,
        textScore: 0.6,
        combinedScore: 0.7,
        type: 'message' as const
      }
    ];

    return {
      vectorResults,
      fullTextResults,
      hybridResults,
      retrievalTimeMs: Date.now() - startTime,
      totalResults: vectorResults.length + fullTextResults.length + hybridResults.length
    };
  }

  private buildEnhancedContext(
    context?: ConversationContext, 
    contextRetrieval?: ContextRetrieval
  ): ConversationContext | undefined {
    if (!context) return undefined;

    return {
      ...context,
      relevantDocuments: contextRetrieval?.hybridResults.map(result => ({
        id: result.id,
        content: result.content,
        similarity: result.combinedScore
      })) || context.relevantDocuments
    };
  }

  private async selectOptimalModel(
    content: string,
    currentModel: AIModel,
    context?: ConversationContext,
    options?: ModelOrchestrationOptions
  ): Promise<AIModel> {
    // Model selection logic based on content characteristics
    const contentLength = content.length;
    const isCodeRelated = /```|function|class|import|export|console\.log/.test(content);
    const isCreative = /story|poem|creative|imagine|describe/.test(content.toLowerCase());
    const isAnalytical = /analyze|compare|evaluate|assess|review/.test(content.toLowerCase());
    const needsRealTimeData = /current|recent|today|latest|now/.test(content.toLowerCase());

    // Priority scoring for each model
    const scores: Record<AIModel, number> = {
      claude: 0,
      gpt4: 0,
      kimi: 0,
      grok: 0,
      gemini: 0
    };

    // Base scoring
    scores[currentModel] += 0.1; // Slight preference for current model

    // Content-based scoring
    if (isCodeRelated) {
      scores.gpt4 += 0.3;
      scores.claude += 0.2;
      scores.gemini += 0.25; // Gemini is strong at code
    }

    if (isCreative) {
      scores.claude += 0.3;
      scores.gpt4 += 0.2;
      scores.gemini += 0.25;
    }

    if (isAnalytical) {
      scores.claude += 0.4;
      scores.gpt4 += 0.2;
      scores.gemini += 0.3; // Gemini has strong reasoning
    }

    if (needsRealTimeData) {
      scores.grok += 0.5;
      scores.gemini += 0.2; // Gemini can access real-time info with search
    }

    if (contentLength > 10000) {
      scores.claude += 0.2; // Better for long context
      scores.gemini += 0.4; // Gemini has 1M token context window
    }

    if (contentLength > 100000) {
      scores.gemini += 0.3; // Gemini excels at very long contexts
    }

    // Performance-based scoring
    for (const [model, metrics] of this.performanceMetrics.entries()) {
      const successRate = metrics.totalRequests > 0 
        ? metrics.successfulRequests / metrics.totalRequests 
        : 1;
      const avgLatency = metrics.averageLatency;
      
      scores[model] += successRate * 0.2; // Reliability bonus
      scores[model] -= Math.min(avgLatency / 10000, 0.1); // Latency penalty
    }

    // Check model availability
    for (const model of Object.keys(scores) as AIModel[]) {
      const client = this.clients.get(model);
      if (!client || !client.isEnabled) {
        scores[model] = -1;
      }
    }

    // Select model with highest score
    const optimalModel = Object.entries(scores).reduce((best, [model, score]) => 
      score > best.score ? { model: model as AIModel, score } : best,
      { model: currentModel, score: scores[currentModel] }
    ).model;

    return optimalModel;
  }

  private buildMessageHistory(
    content: string,
    context?: ConversationContext
  ) {
    const messages = [];

    // Add recent messages for context
    if (context?.recentMessages) {
      messages.push(...context.recentMessages.slice(-10)); // Last 10 messages
    }

    // Add current user message
    messages.push({
      role: 'user' as const,
      content
    });

    return messages;
  }

  private getOptimalTemperature(model: AIModel, content: string): number {
    const isCreative = /story|poem|creative|imagine|describe/.test(content.toLowerCase());
    const isAnalytical = /analyze|compare|code|function|bug/.test(content.toLowerCase());

    const baseTemperatures: Record<AIModel, number> = {
      claude: 0.7,
      gpt4: 0.7,
      kimi: 0.6,
      grok: 0.8,
      gemini: 0.7
    };

    let temperature = baseTemperatures[model];

    if (isCreative) temperature += 0.2;
    if (isAnalytical) temperature -= 0.2;

    return Math.max(0.1, Math.min(1.0, temperature));
  }

  private buildSystemPrompt(model: AIModel, context?: ConversationContext): string {
    let prompt = '';

    // Model-specific system prompts
    switch (model) {
      case 'claude':
        prompt = 'You are Claude, an AI assistant created by Anthropic. Be helpful, harmless, and honest.';
        break;
      case 'gpt4':
        prompt = 'You are a helpful AI assistant. Provide accurate, detailed, and well-structured responses.';
        break;
      case 'kimi':
        prompt = 'You are Kimi, an AI assistant by Moonshot AI. Be helpful and efficient in your responses.';
        break;
      case 'grok':
        prompt = 'You are Grok, an AI assistant with access to real-time information. Be witty and informative.';
        break;
      case 'gemini':
        prompt = 'You are Gemini, a highly capable AI assistant created by Google. Be helpful, accurate, and provide well-structured responses.';
        break;
    }

    // Add context-specific instructions
    if (context?.customInstructions) {
      prompt += `\n\nAdditional instructions: ${context.customInstructions}`;
    }

    if (context?.projectId) {
      prompt += `\n\nYou are working within project context: ${context.projectId}`;
    }

    return prompt;
  }

  private generateContextSummary(context?: ConversationContext): string {
    if (!context) return '';

    const parts = [];
    
    if (context.branchContext?.branchSummary) {
      parts.push(`Branch: ${context.branchContext.branchSummary}`);
    }

    if (context.relevantDocuments?.length) {
      parts.push(`${context.relevantDocuments.length} relevant documents found`);
    }

    if (context.recentMessages?.length) {
      parts.push(`${context.recentMessages.length} recent messages in context`);
    }

    return parts.join(' | ');
  }

  private async executeWithFallback(
    request: ChatCompletionRequest,
    preferredModel: AIModel,
    fallbackModels: AIModel[],
    maxRetries: number
  ): Promise<ChatCompletionResponse> {
    const modelsToTry = [preferredModel, ...fallbackModels.filter(m => m !== preferredModel)];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      for (const model of modelsToTry) {
        const client = this.clients.get(model);
        if (!client || !client.isEnabled) continue;

        try {
          const response = await client.chat({ ...request, model });
          
          // Log successful fallback
          if (model !== preferredModel) {
            console.log(`Fallback to model ${model} successful`);
          }

          return response;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Model ${model} failed (attempt ${attempt + 1}):`, lastError.message);
          
          // If it's a rate limit error, wait before retrying
          if (lastError.message.includes('rate limit')) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      }
    }

    throw lastError || new Error('All models failed');
  }

  private updatePerformanceMetrics(
    model: AIModel,
    latency: number,
    success: boolean
  ): void {
    const metrics = this.performanceMetrics.get(model);
    if (!metrics) return;

    metrics.totalRequests++;
    metrics.lastRequestTime = new Date();

    if (success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    // Update latency metrics (simplified)
    const oldAvg = metrics.averageLatency;
    const totalRequests = metrics.totalRequests;
    metrics.averageLatency = (oldAvg * (totalRequests - 1) + latency) / totalRequests;

    // Update error rate
    metrics.errorRate = metrics.failedRequests / metrics.totalRequests;
  }

  private calculateAverageCost(model: AIModel, metrics: AIModelPerformanceMetrics): number {
    const client = this.clients.get(model);
    if (!client) return 0;

    // Rough estimation based on token usage
    const avgTokensPerRequest = metrics.totalTokensUsed / Math.max(metrics.totalRequests, 1);
    const inputCost = avgTokensPerRequest * 0.7 * client.capabilities.pricePerInputToken;
    const outputCost = avgTokensPerRequest * 0.3 * client.capabilities.pricePerOutputToken;
    
    return inputCost + outputCost;
  }

  private calculateReliability(metrics: AIModelPerformanceMetrics): number {
    if (metrics.totalRequests === 0) return 1;
    return metrics.successfulRequests / metrics.totalRequests;
  }

  private calculatePerformanceScore(metrics: AIModelPerformanceMetrics): number {
    const reliability = this.calculateReliability(metrics);
    const latencyScore = Math.max(0, 1 - (metrics.averageLatency / 10000)); // Lower is better
    return (reliability * 0.7) + (latencyScore * 0.3);
  }

  private analyzeModelSwitches() {
    const switchReasons = this.modelSwitchHistory.reduce((acc, event) => {
      acc[event.reason] = (acc[event.reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const modelPairs = this.modelSwitchHistory.reduce((acc, event) => {
      const pair = `${event.fromModel}->${event.toModel}`;
      acc[pair] = (acc[pair] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalSwitches: this.modelSwitchHistory.length,
      switchReasons,
      commonPairs: modelPairs,
      averageSwitchTime: this.modelSwitchHistory.reduce((sum, event) => 
        sum + event.switchTimeMs, 0) / Math.max(this.modelSwitchHistory.length, 1)
    };
  }

  private generateRecommendations(analytics: Record<AIModel, any>): string[] {
    const recommendations: string[] = [];

    // Find best performing model
    const bestModel = Object.entries(analytics).reduce((best, [model, data]) => 
      data.performance > best.performance ? { model: model as AIModel, performance: data.performance } : best,
      { model: this.config.defaultModel, performance: 0 }
    );

    if (bestModel.model !== this.config.defaultModel) {
      recommendations.push(`Consider switching default model to ${bestModel.model} for better performance`);
    }

    // Check for underperforming models
    for (const [model, data] of Object.entries(analytics)) {
      if (data.errorRate > 0.1) {
        recommendations.push(`Model ${model} has high error rate (${(data.errorRate * 100).toFixed(1)}%)`);
      }
      
      if (data.averageLatency > 5000) {
        recommendations.push(`Model ${model} has high latency (${data.averageLatency.toFixed(0)}ms)`);
      }
    }

    return recommendations;
  }
}

/**
 * Factory function to create model orchestrator
 */
export function createModelOrchestrator(config: OrchestratorConfig): ModelOrchestrator {
  return new ModelOrchestrator(config);
}

/**
 * Create demo orchestrator configuration with all models including Gemini
 */
export function createDemoOrchestratorConfig(embeddingService?: EmbeddingService): OrchestratorConfig {
  return {
    models: {
      claude: {
        name: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        enabled: !!process.env.ANTHROPIC_API_KEY,
        maxTokens: 4096,
        temperature: 0.7,
        rateLimitRpm: 5000,
        rateLimitTpm: 800000
      },
      gpt4: {
        name: 'gpt4',
        apiKey: process.env.OPENAI_API_KEY || '',
        enabled: !!process.env.OPENAI_API_KEY,
        maxTokens: 4096,
        temperature: 0.7,
        rateLimitRpm: 3500,
        rateLimitTpm: 90000
      },
      kimi: {
        name: 'kimi',
        apiKey: process.env.KIMI_API_KEY || '',
        baseUrl: 'https://api.moonshot.cn/v1',
        enabled: !!process.env.KIMI_API_KEY,
        maxTokens: 4096,
        temperature: 0.6,
        rateLimitRpm: 60,
        rateLimitTpm: 200000
      },
      grok: {
        name: 'grok',
        apiKey: process.env.GROK_API_KEY || '',
        baseUrl: 'https://api.x.ai/v1',
        enabled: !!process.env.GROK_API_KEY,
        maxTokens: 4096,
        temperature: 0.8,
        rateLimitRpm: 200,
        rateLimitTpm: 120000
      },
      gemini: {
        name: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        enabled: !!process.env.GEMINI_API_KEY,
        maxTokens: 8192,
        temperature: 0.7,
        rateLimitRpm: 1500,
        rateLimitTpm: 32000
      }
    },
    defaultModel: 'claude',
    fallbackChain: ['claude', 'gpt4', 'gemini', 'kimi', 'grok'],
    embeddingService,
    contextRetrieval: {
      enabled: !!embeddingService,
      maxResults: 5,
      similarityThreshold: 0.7
    }
  };
}