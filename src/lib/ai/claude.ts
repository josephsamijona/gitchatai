/**
 * Claude client implementation using Anthropic's API
 * Handles Claude API integration with streaming, rate limiting, and optimization
 */

import Anthropic from '@anthropic-ai/sdk';
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

export class ClaudeClient implements IAIModelClient {
  public readonly model: AIModel = 'claude';
  private client: Anthropic;
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
    this.client = new Anthropic({
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
    maxContextLength: 200000, // Claude 3 Sonnet/Opus
    supportsStreaming: true,
    supportsSystemMessages: true,
    supportsFunctionCalling: true,
    supportsVision: true, // Claude 3 supports vision
    pricePerInputToken: 0.000003, // $3 per million input tokens
    pricePerOutputToken: 0.000015, // $15 per million output tokens
    rateLimitRpm: 5000, // Conservative estimate
    rateLimitTpm: 800000,
    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar'],
    strengths: [
      'Long-form reasoning and analysis',
      'Nuanced conversation and context understanding',
      'Ethical reasoning and safety',
      'Creative writing and ideation',
      'Code analysis and explanation',
      'Research synthesis and summarization',
      'Thoughtful and balanced perspectives'
    ],
    weaknesses: [
      'No real-time data access',
      'Cannot browse the internet',
      'Mathematical computations (compared to specialized models)',
      'May be overly cautious in some scenarios'
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
      // Optimize messages for Claude's format
      const { messages, systemPrompt } = this.formatMessagesForClaude(request.messages, request.systemPrompt);

      // Prepare Anthropic-specific request
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model: this.getModelVariant(request),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        system: systemPrompt,
        messages: messages,
        stream: false,
        metadata: request.metadata?.conversationId ? {
          user_id: request.metadata.conversationId
        } : undefined
      };

      const completion = await this.client.messages.create(anthropicRequest);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      this.updateRateLimits(completion);

      // Extract content from Claude's response format
      const content = this.extractContentFromResponse(completion);

      return {
        id: completion.id,
        model: this.model,
        content,
        finishReason: this.mapFinishReason(completion.stop_reason),
        usage: {
          promptTokens: completion.usage.input_tokens,
          completionTokens: completion.usage.output_tokens,
          totalTokens: completion.usage.input_tokens + completion.usage.output_tokens
        },
        processingTimeMs: processingTime,
        timestamp: new Date(),
        metadata: {
          claudeId: completion.id,
          model: completion.model,
          stopReason: completion.stop_reason,
          stopSequence: completion.stop_sequence
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
      const { messages, systemPrompt } = this.formatMessagesForClaude(request.messages, request.systemPrompt);

      const anthropicRequest: Anthropic.MessageCreateParams = {
        model: this.getModelVariant(request),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        system: systemPrompt,
        messages: messages,
        stream: true,
        metadata: request.metadata?.conversationId ? {
          user_id: request.metadata.conversationId
        } : undefined
      };

      const stream = await this.client.messages.create(anthropicRequest);
      
      let completionId = '';
      let finished = false;
      let finishReason: 'stop' | 'length' | 'error' | undefined;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            completionId = event.message.id;
            usage = {
              promptTokens: event.message.usage.input_tokens,
              completionTokens: 0,
              totalTokens: event.message.usage.input_tokens
            };
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield {
                id: completionId,
                model: this.model,
                delta: event.delta.text,
                finished: false
              };
            }
            break;

          case 'message_delta':
            if (event.delta.stop_reason) {
              finishReason = this.mapFinishReason(event.delta.stop_reason);
            }
            if (event.usage) {
              usage = {
                promptTokens: usage?.promptTokens || 0,
                completionTokens: event.usage.output_tokens,
                totalTokens: (usage?.promptTokens || 0) + event.usage.output_tokens
              };
            }
            break;

          case 'message_stop':
            finished = true;
            yield {
              id: completionId,
              model: this.model,
              delta: '',
              finished: true,
              finishReason,
              usage,
              processingTimeMs: Date.now() - startTime
            };
            break;

          case 'error':
            finished = true;
            finishReason = 'error';
            yield {
              id: completionId,
              model: this.model,
              delta: '',
              finished: true,
              finishReason: 'error'
            };
            break;
        }
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
      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307', // Use fastest model for health check
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }]
      });
      return !!response.content && response.content.length > 0;
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
   * Optimize prompt specifically for Claude
   */
  async optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization> {
    const optimizations: PromptOptimization['optimizations'] = [];
    let optimizedPrompt = prompt;

    // 1. Claude prefers clear instructions and structured thinking
    if (!prompt.includes('<thinking>') && prompt.length > 200) {
      const structuredPrompt = `${prompt}\n\n<thinking>\nLet me think through this step by step:\n1. First, I'll analyze the key components of this request\n2. Then I'll provide a comprehensive response\n</thinking>`;
      optimizations.push({
        type: 'structure',
        description: 'Added structured thinking format preferred by Claude',
        before: prompt.substring(0, 100) + '...',
        after: structuredPrompt.substring(0, 100) + '...'
      });
      optimizedPrompt = structuredPrompt;
    }

    // 2. Add conversation context if available
    if (context?.branchContext?.branchSummary) {
      const contextPrompt = `Previous conversation context: ${context.branchContext.branchSummary}\n\nCurrent request: ${optimizedPrompt}`;
      optimizations.push({
        type: 'specificity',
        description: 'Added conversation context for better continuity',
        before: optimizedPrompt.substring(0, 50) + '...',
        after: contextPrompt.substring(0, 50) + '...'
      });
      optimizedPrompt = contextPrompt;
    }

    // 3. Claude performs better with explicit examples for complex tasks
    if (prompt.includes('analyze') || prompt.includes('compare') || prompt.includes('evaluate')) {
      const examplePrompt = `${optimizedPrompt}\n\nPlease provide your analysis in a clear, structured format with specific examples and reasoning.`;
      optimizations.push({
        type: 'examples',
        description: 'Added explicit request for structured analysis with examples',
        before: optimizedPrompt.substring(-50),
        after: examplePrompt.substring(-50)
      });
      optimizedPrompt = examplePrompt;
    }

    // 4. Optimize length for Claude's context window (very generous, so less aggressive truncation)
    if (optimizedPrompt.length > 50000) {
      optimizedPrompt = optimizedPrompt.substring(0, 50000) + '...';
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
      estimatedImprovementScore: optimizations.length * 0.12 // 12% per optimization for Claude
    };
  }

  /**
   * Estimate cost for request
   */
  estimateCost(request: ChatCompletionRequest): number {
    // More accurate token estimation for Claude: ~3.5 characters per token
    const inputTokens = JSON.stringify(request.messages).length / 3.5;
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
    // Default to Claude 3 Sonnet for balanced performance and cost
    return 'claude-3-sonnet-20240229';
  }

  private formatMessagesForClaude(
    messages: Array<{ role: string; content: string }>, 
    systemPrompt?: string
  ): { messages: Anthropic.MessageParam[]; systemPrompt?: string } {
    const formattedMessages: Anthropic.MessageParam[] = [];
    let combinedSystemPrompt = systemPrompt;

    // Handle conversation context and system messages
    for (const message of messages) {
      if (message.role === 'system') {
        // Claude handles system messages differently - combine them
        combinedSystemPrompt = combinedSystemPrompt 
          ? `${combinedSystemPrompt}\n\n${message.content}`
          : message.content;
      } else if (message.role === 'user' || message.role === 'assistant') {
        formattedMessages.push({
          role: message.role,
          content: message.content
        });
      }
    }

    return { messages: formattedMessages, systemPrompt: combinedSystemPrompt };
  }

  private extractContentFromResponse(completion: Anthropic.Message): string {
    if (!completion.content || completion.content.length === 0) {
      return '';
    }

    // Handle Claude's content block format
    return completion.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('');
  }

  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
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

  private updateRateLimits(completion: Anthropic.Message): void {
    this.rateLimitTracker.requests.count++;
    this.rateLimitTracker.tokens.count += completion.usage.input_tokens + completion.usage.output_tokens;
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
    // Handle Anthropic-specific errors
    if (error.status === 429) {
      return this.createAIModelError('Rate limit exceeded', {
        type: 'rate_limit',
        statusCode: 429,
        retryable: true,
        retryAfter: 60,
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

    if (error.status === 413) {
      return this.createAIModelError('Request too large', {
        type: 'context_limit',
        statusCode: 413,
        retryable: false,
        originalError: error
      });
    }

    if (error.status >= 500) {
      return this.createAIModelError('Claude API error', {
        type: 'api_error',
        statusCode: error.status,
        retryable: true,
        originalError: error
      });
    }

    return this.createAIModelError(error.message || 'Unknown Claude error', {
      type: 'unknown',
      retryable: false,
      originalError: error
    });
  }
}