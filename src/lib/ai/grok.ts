/**
 * Grok (xAI) client implementation
 * Handles Grok API integration with real-time data access and streaming
 */

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

export class GrokClient implements IAIModelClient {
  public readonly model: AIModel = 'grok';
  private apiKey: string;
  private baseUrl: string;
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
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.x.ai/v1';

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
    maxContextLength: 131072, // Grok-2 context length
    supportsStreaming: true,
    supportsSystemMessages: true,
    supportsFunctionCalling: true,
    supportsVision: false, // Standard Grok-2
    pricePerInputToken: 0.000005, // Estimated pricing
    pricePerOutputToken: 0.000015, // Estimated pricing
    rateLimitRpm: 3000, // Estimated rate limits
    rateLimitTpm: 300000,
    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
    strengths: [
      'Real-time data access and current events',
      'Witty and engaging conversational style',
      'Current news and trending topics',
      'Social media and internet culture understanding',
      'Creative and humorous responses',
      'Up-to-date information retrieval'
    ],
    weaknesses: [
      'Less reliable for formal academic work',
      'Can be overly casual for professional contexts',
      'May prioritize humor over accuracy',
      'Limited historical context beyond training'
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
      // Optimize prompt for Grok's style if enabled
      const optimizedMessages = request.metadata?.contextSummary
        ? await this.optimizeMessagesForGrok(request.messages, request.metadata.contextSummary)
        : request.messages;

      // Prepare Grok-specific request
      const grokRequest = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForGrok(optimizedMessages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.8, // Higher temp for Grok's personality
        stream: false,
        user: request.metadata?.conversationId
      };

      const response = await this.makeAPIRequest('/chat/completions', grokRequest);
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      this.updateRateLimits(response);

      const choice = response.choices?.[0];
      if (!choice) {
        throw this.createAIModelError('No response choices returned', {
          type: 'api_error',
          retryable: false
        });
      }

      return {
        id: response.id,
        model: this.model,
        content: choice.message?.content || '',
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0
        },
        processingTimeMs: processingTime,
        timestamp: new Date(),
        metadata: {
          grokId: response.id,
          model: response.model,
          systemFingerprint: response.system_fingerprint
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
      // Optimize prompt for Grok's style
      const optimizedMessages = request.metadata?.contextSummary
        ? await this.optimizeMessagesForGrok(request.messages, request.metadata.contextSummary)
        : request.messages;

      const grokRequest = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForGrok(optimizedMessages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.8,
        stream: true,
        user: request.metadata?.conversationId
      };

      const stream = await this.makeStreamingRequest('/chat/completions', grokRequest);
      
      let completionId = '';
      let totalTokens = 0;
      let finished = false;
      let finishReason: 'stop' | 'length' | 'error' | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
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
      const response = await this.makeAPIRequest('/chat/completions', {
        model: 'grok-beta',
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
   * Optimize prompt specifically for Grok
   */
  async optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization> {
    const optimizations: PromptOptimization['optimizations'] = [];
    let optimizedPrompt = prompt;

    // 1. Add conversational tone for Grok's personality
    if (!prompt.toLowerCase().includes('casual') && !prompt.toLowerCase().includes('friendly')) {
      const casualPrompt = `You're having a friendly, casual conversation. ${prompt}`;
      optimizations.push({
        type: 'format',
        description: 'Added conversational tone for Grok\'s personality',
        before: prompt.substring(0, 100) + '...',
        after: casualPrompt.substring(0, 100) + '...'
      });
      optimizedPrompt = casualPrompt;
    }

    // 2. Add real-time context if available
    if (context?.branchContext?.branchSummary) {
      const contextPrompt = `Recent context: ${context.branchContext.branchSummary}\n\n${optimizedPrompt}`;
      optimizations.push({
        type: 'specificity',
        description: 'Added recent context for continuity',
        before: optimizedPrompt.substring(0, 50) + '...',
        after: contextPrompt.substring(0, 50) + '...'
      });
      optimizedPrompt = contextPrompt;
    }

    // 3. Encourage current events knowledge
    if (!prompt.toLowerCase().includes('recent') && !prompt.toLowerCase().includes('current')) {
      optimizedPrompt = `${optimizedPrompt}\n\nFeel free to reference current events or recent developments if relevant.`;
      optimizations.push({
        type: 'specificity',
        description: 'Encouraged use of real-time knowledge',
        before: prompt.length + ' characters (no current events prompt)',
        after: optimizedPrompt.length + ' characters (with current events prompt)'
      });
    }

    // 4. Optimize length for Grok's context window
    if (optimizedPrompt.length > 15000) {
      optimizedPrompt = optimizedPrompt.substring(0, 15000) + '...';
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
      estimatedImprovementScore: optimizations.length * 0.12 // 12% per optimization
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
    // Use Grok-2 for better performance
    return 'grok-beta';
  }

  private formatMessagesForGrok(
    messages: Array<{ role: string; content: string }>, 
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const formattedMessages: Array<{ role: string; content: string }> = [];

    // Add system message with Grok's personality if provided
    if (systemPrompt) {
      formattedMessages.push({ 
        role: 'system', 
        content: `${systemPrompt}\n\nRemember to be helpful, witty, and engaging while staying accurate.`
      });
    }

    // Convert messages to Grok format
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

  private async optimizeMessagesForGrok(
    messages: Array<{ role: string; content: string }>,
    contextSummary: string
  ): Promise<Array<{ role: string; content: string }>> {
    // For Grok, add contextual awareness with a casual tone
    const optimizedMessages = [...messages];
    
    // Add context to the first user message if not too long
    if (optimizedMessages.length > 0 && contextSummary.length < 500) {
      const firstMessage = optimizedMessages[0];
      if (firstMessage.role === 'user') {
        firstMessage.content = `Context: ${contextSummary}\n\nRequest: ${firstMessage.content}`;
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

  private updateRateLimits(completion: any): void {
    this.rateLimitTracker.requests.count++;
    this.rateLimitTracker.tokens.count += completion.usage?.total_tokens || 0;
  }

  private async makeAPIRequest(endpoint: string, data: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private async makeStreamingRequest(endpoint: string, data: any): Promise<AsyncIterable<any>> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') return;

                try {
                  yield JSON.parse(data);
                } catch (error) {
                  console.warn('Failed to parse SSE data:', data);
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };
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
      return this.createAIModelError('Grok API error', {
        type: 'api_error',
        statusCode: error.status,
        retryable: true,
        originalError: error
      });
    }

    return this.createAIModelError(error.message || 'Unknown Grok error', {
      type: 'unknown',
      retryable: false,
      originalError: error
    });
  }
}