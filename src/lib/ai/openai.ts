/**
 * OpenAI GPT-4 client implementation
 * Handles GPT-4 API integration with streaming, rate limiting, and optimization
 */

import OpenAI from 'openai';
import type {
  AIModel,
  AIModelConfig,
  AIModelCapabilities,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingResponse,
  ConversationContext,
  PromptOptimization,
  AIModelError,
  IAIModelClient
} from '../../types/ai';

export class OpenAIClient implements IAIModelClient {
  public readonly model: AIModel = 'gpt4';
  private client: OpenAI;
  private rateLimitTracker: {
    requests: { count: number; resetTime: Date };
    tokens: { count: number; resetTime: Date };
  };
  private performanceMetrics: {
    requestCount: number;
    successCount: number;
    totalLatency: number;
    lastRequestTime: Date;
  };

  constructor(public readonly config: AIModelConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });

    this.rateLimitTracker = {
      requests: { count: 0, resetTime: new Date() },
      tokens: { count: 0, resetTime: new Date() }
    };

    this.performanceMetrics = {
      requestCount: 0,
      successCount: 0,
      totalLatency: 0,
      lastRequestTime: new Date()
    };
  }

  public readonly capabilities: AIModelCapabilities = {
    maxContextLength: 128000, // GPT-4 Turbo
    supportsStreaming: true,
    supportsSystemMessages: true,
    supportsFunctionCalling: true,
    supportsVision: false, // Standard GPT-4
    pricePerInputToken: 0.00001, // $0.01 per 1K tokens
    pricePerOutputToken: 0.00003, // $0.03 per 1K tokens
    rateLimitRpm: 10000, // Tier 5 rate limits
    rateLimitTpm: 2000000,
    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
    strengths: [
      'Complex reasoning and analysis',
      'Code generation and debugging', 
      'Mathematical problem solving',
      'Creative writing and ideation',
      'Structured data processing',
      'Multi-step problem decomposition'
    ],
    weaknesses: [
      'Knowledge cutoff limitations',
      'No real-time data access',
      'Occasional hallucinations',
      'High token costs for long conversations'
    ]
  };

  public get isEnabled(): boolean {
    return this.config.enabled && !!this.config.apiKey;
  }

  /**
   * Main chat completion method
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.canMakeRequest()) {
      throw this.createAIModelError('Rate limit exceeded', {
        type: 'rate_limit',
        retryable: true,
        retryAfter: Math.ceil((this.rateLimitTracker.requests.resetTime.getTime() - Date.now()) / 1000)
      });
    }

    const startTime = Date.now();
    this.performanceMetrics.requestCount++;

    try {
      // Optimize prompt for GPT-4 if enabled
      const optimizedMessages = request.metadata?.contextSummary && this.config.temperature !== undefined
        ? await this.optimizeMessagesForGPT4(request.messages, request.metadata.contextSummary)
        : request.messages;

      // Prepare OpenAI-specific request
      const openAIRequest: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForOpenAI(optimizedMessages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        stream: false,
        user: request.metadata?.conversationId
      };

      const completion = await this.client.chat.completions.create(openAIRequest);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      this.updateRateLimits(completion);

      const choice = completion.choices[0];
      if (!choice) {
        throw this.createAIModelError('No response choices returned', {
          type: 'api_error',
          retryable: false
        });
      }

      return {
        id: completion.id,
        model: this.model,
        content: choice.message.content || '',
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: completion.usage?.prompt_tokens || 0,
          completionTokens: completion.usage?.completion_tokens || 0,
          totalTokens: completion.usage?.total_tokens || 0
        },
        processingTimeMs: processingTime,
        timestamp: new Date(),
        metadata: {
          openaiId: completion.id,
          model: completion.model,
          systemFingerprint: completion.system_fingerprint
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      throw this.handleError(error);
    }
  }

  /**
   * Streaming chat completion
   */
  async* streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamingResponse, void, unknown> {
    if (!this.canMakeRequest()) {
      throw this.createAIModelError('Rate limit exceeded', {
        type: 'rate_limit',
        retryable: true,
        retryAfter: Math.ceil((this.rateLimitTracker.requests.resetTime.getTime() - Date.now()) / 1000)
      });
    }

    const startTime = Date.now();
    this.performanceMetrics.requestCount++;

    try {
      // Optimize prompt for GPT-4 if enabled
      const optimizedMessages = request.metadata?.contextSummary
        ? await this.optimizeMessagesForGPT4(request.messages, request.metadata.contextSummary)
        : request.messages;

      const openAIRequest: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForOpenAI(optimizedMessages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        stream: true,
        user: request.metadata?.conversationId
      };

      const stream = await this.client.chat.completions.create(openAIRequest);
      
      let completionId = '';
      let totalTokens = 0;
      let finished = false;
      let finishReason: 'stop' | 'length' | 'error' | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (!completionId) completionId = chunk.id;

        const delta = choice.delta?.content || '';
        finished = choice.finish_reason !== null;
        
        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
          totalTokens = chunk.usage?.total_tokens || 0;
        }

        yield {
          id: completionId,
          model: this.model,
          delta,
          finished,
          finishReason,
          usage: finished && totalTokens > 0 ? {
            promptTokens: chunk.usage?.prompt_tokens || 0,
            completionTokens: chunk.usage?.completion_tokens || 0,
            totalTokens
          } : undefined,
          processingTimeMs: finished ? Date.now() - startTime : undefined
        };
      }

      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);
      throw this.handleError(error);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo', // Use cheaper model for health check
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5
      });
      return !!response.choices?.[0]?.message?.content;
    } catch {
      return false;
    }
  }

  /**
   * Get current status and metrics
   */
  async getStatus() {
    const healthy = await this.healthCheck();
    const errorRate = this.performanceMetrics.requestCount > 0 
      ? (this.performanceMetrics.requestCount - this.performanceMetrics.successCount) / this.performanceMetrics.requestCount 
      : 0;
    
    return {
      healthy,
      latency: this.performanceMetrics.requestCount > 0 
        ? this.performanceMetrics.totalLatency / this.performanceMetrics.requestCount 
        : 0,
      errorRate,
      rateLimitStatus: this.getRateLimitStatus()
    };
  }

  /**
   * Optimize prompt specifically for GPT-4
   */
  async optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization> {
    const optimizations: PromptOptimization['optimizations'] = [];
    let optimizedPrompt = prompt;

    // 1. Add clear structure for GPT-4
    if (!prompt.includes('###') && !prompt.includes('**Task:**')) {
      const structuredPrompt = `**Task:** ${prompt}\n\n**Context:** Please provide a comprehensive response that addresses the request above.`;
      optimizations.push({
        type: 'structure',
        description: 'Added clear task structure for better GPT-4 understanding',
        before: prompt.substring(0, 100) + '...',
        after: structuredPrompt.substring(0, 100) + '...'
      });
      optimizedPrompt = structuredPrompt;
    }

    // 2. Add relevant context if available
    if (context?.branchContext?.branchSummary) {
      const contextPrompt = `**Previous Context:** ${context.branchContext.branchSummary}\n\n${optimizedPrompt}`;
      optimizations.push({
        type: 'specificity',
        description: 'Added branch context for continuity',
        before: optimizedPrompt.substring(0, 50) + '...',
        after: contextPrompt.substring(0, 50) + '...'
      });
      optimizedPrompt = contextPrompt;
    }

    // 3. Optimize length for GPT-4's context window
    if (optimizedPrompt.length > 10000) {
      optimizedPrompt = optimizedPrompt.substring(0, 10000) + '...';
      optimizations.push({
        type: 'length',
        description: 'Truncated prompt to fit within optimal context length',
        before: `${prompt.length} characters`,
        after: `${optimizedPrompt.length} characters`
      });
    }

    return {
      model: this.model,
      originalPrompt: prompt,
      optimizedPrompt,
      optimizations,
      estimatedImprovementScore: optimizations.length * 0.15 // 15% per optimization
    };
  }

  /**
   * Estimate cost for request
   */
  estimateCost(request: ChatCompletionRequest): number {
    // Rough token estimation: ~4 characters per token
    const inputTokens = JSON.stringify(request.messages).length / 4;
    const outputTokens = request.maxTokens || 1000;
    
    return (inputTokens * this.capabilities.pricePerInputToken) + 
           (outputTokens * this.capabilities.pricePerOutputToken);
  }

  /**
   * Check if we can make a request given rate limits
   */
  canMakeRequest(): boolean {
    const now = new Date();
    
    // Reset counters if time window has passed
    if (now >= this.rateLimitTracker.requests.resetTime) {
      this.rateLimitTracker.requests = { count: 0, resetTime: new Date(now.getTime() + 60000) };
    }
    if (now >= this.rateLimitTracker.tokens.resetTime) {
      this.rateLimitTracker.tokens = { count: 0, resetTime: new Date(now.getTime() + 60000) };
    }

    return this.rateLimitTracker.requests.count < (this.config.rateLimitRpm || this.capabilities.rateLimitRpm) &&
           this.rateLimitTracker.tokens.count < (this.config.rateLimitTpm || this.capabilities.rateLimitTpm);
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus() {
    const maxRequests = this.config.rateLimitRpm || this.capabilities.rateLimitRpm;
    const maxTokens = this.config.rateLimitTpm || this.capabilities.rateLimitTpm;

    return {
      remainingRequests: Math.max(0, maxRequests - this.rateLimitTracker.requests.count),
      remainingTokens: Math.max(0, maxTokens - this.rateLimitTracker.tokens.count),
      resetTime: this.rateLimitTracker.requests.resetTime
    };
  }

  /**
   * Private helper methods
   */
  private getModelVariant(request: ChatCompletionRequest): string {
    // Use GPT-4 Turbo for better performance and cost efficiency
    return 'gpt-4-1106-preview';
  }

  private formatMessagesForOpenAI(
    messages: Array<{ role: string; content: string }>, 
    systemPrompt?: string
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Add system message if provided
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }

    // Convert messages to OpenAI format
    for (const message of messages) {
      if (message.role === 'user' || message.role === 'assistant') {
        formattedMessages.push({
          role: message.role,
          content: message.content
        });
      }
    }

    return formattedMessages;
  }

  private async optimizeMessagesForGPT4(
    messages: Array<{ role: string; content: string }>,
    contextSummary: string
  ): Promise<Array<{ role: string; content: string }>> {
    // For GPT-4, we can be more explicit about the context and structure
    const optimizedMessages = [...messages];
    
    // Add context to the first user message if it's not too long
    if (optimizedMessages.length > 0 && contextSummary.length < 500) {
      const firstMessage = optimizedMessages[0];
      if (firstMessage.role === 'user') {
        firstMessage.content = `Context: ${contextSummary}\n\nUser Request: ${firstMessage.content}`;
      }
    }

    return optimizedMessages;
  }

  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      default:
        return 'error';
    }
  }

  private updateMetrics(latency: number, success: boolean): void {
    this.performanceMetrics.totalLatency += latency;
    this.performanceMetrics.lastRequestTime = new Date();
    if (success) {
      this.performanceMetrics.successCount++;
    }
  }

  private updateRateLimits(completion: OpenAI.Chat.ChatCompletion): void {
    this.rateLimitTracker.requests.count++;
    this.rateLimitTracker.tokens.count += completion.usage?.total_tokens || 0;
  }

  private createAIModelError(message: string, options: {
    type: AIModelError['type'];
    statusCode?: number;
    retryable: boolean;
    retryAfter?: number;
    originalError?: any;
  }): AIModelError {
    const error = new Error(message) as AIModelError;
    error.model = this.model;
    error.type = options.type;
    error.statusCode = options.statusCode;
    error.retryable = options.retryable;
    error.retryAfter = options.retryAfter;
    error.originalError = options.originalError;
    return error;
  }

  private handleError(error: any): AIModelError {
    if (error.status === 429) {
      return this.createAIModelError('Rate limit exceeded', {
        type: 'rate_limit',
        statusCode: 429,
        retryable: true,
        retryAfter: parseInt(error.headers?.['retry-after'] || '60'),
        originalError: error
      });
    }

    if (error.status === 400) {
      return this.createAIModelError('Invalid request', {
        type: 'invalid_request',
        statusCode: 400,
        retryable: false,
        originalError: error
      });
    }

    if (error.status >= 500) {
      return this.createAIModelError('OpenAI API error', {
        type: 'api_error',
        statusCode: error.status,
        retryable: true,
        originalError: error
      });
    }

    return this.createAIModelError(error.message || 'Unknown OpenAI error', {
      type: 'unknown',
      retryable: false,
      originalError: error
    });
  }
}