/**
 * Kimi (Moonshot AI) client implementation
 * Handles Kimi API integration with streaming, rate limiting, and optimization
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

interface KimiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface KimiRequest {
  model: string;
  messages: KimiMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface KimiResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface KimiStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class KimiClient implements IAIModelClient {
  public readonly model: AIModel = 'kimi';
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
    this.baseUrl = config.baseUrl || 'https://api.moonshot.cn/v1';
    
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
    maxContextLength: 200000, // Kimi v1.5 supports 200K context
    supportsStreaming: true,
    supportsSystemMessages: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    pricePerInputToken: 0.000001, // Very competitive pricing
    pricePerOutputToken: 0.000002,
    rateLimitRpm: 3000, // Conservative estimate
    rateLimitTpm: 1000000,
    supportedLanguages: ['zh', 'en', 'ja', 'ko'], // Strong in Chinese
    strengths: [
      'Long context processing (200K tokens)',
      'Chinese language understanding',
      'Cost-effective processing',
      'Fast response times',
      'Document analysis and summarization',
      'Multi-language support (especially CJK)'
    ],
    weaknesses: [
      'Limited function calling capabilities',
      'Smaller training dataset compared to GPT-4/Claude',
      'Less creative writing compared to other models',
      'Limited availability outside China'
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
      const kimiRequest: KimiRequest = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForKimi(request.messages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.3,
        stream: false
      };

      const response = await this.makeRequest('/chat/completions', 'POST', kimiRequest);
      const completion = response as KimiResponse;
      
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
          kimiId: completion.id,
          model: completion.model
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
      const kimiRequest: KimiRequest = {
        model: this.getModelVariant(request),
        messages: this.formatMessagesForKimi(request.messages, request.systemPrompt),
        max_tokens: request.maxTokens || this.config.maxTokens || 4096,
        temperature: request.temperature ?? this.config.temperature ?? 0.3,
        stream: true
      };

      const response = await this.makeStreamRequest('/chat/completions', kimiRequest);
      
      let completionId = '';
      let finished = false;
      let finishReason: 'stop' | 'length' | 'error' | undefined;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

      for await (const chunk of response) {
        const data = chunk as KimiStreamChunk;
        
        if (!completionId) completionId = data.id;

        const choice = data.choices[0];
        if (!choice) continue;

        const delta = choice.delta?.content || '';
        finished = choice.finish_reason !== null && choice.finish_reason !== undefined;
        
        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }

        if (data.usage) {
          usage = {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens
          };
        }

        yield {
          id: completionId,
          model: this.model,
          delta,
          finished,
          finishReason,
          usage: finished ? usage : undefined,
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
      const response = await this.makeRequest('/models', 'GET');
      return Array.isArray(response.data) && response.data.length > 0;
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
   * Optimize prompt specifically for Kimi
   */
  async optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization> {
    const optimizations: PromptOptimization['optimizations'] = [];
    let optimizedPrompt = prompt;

    // 1. Kimi excels at structured, clear instructions
    if (!prompt.includes('÷') && !prompt.includes('Please') && prompt.length > 100) {
      const structuredPrompt = `÷	gåBŒû¡\n\n${prompt}\n\n÷Ð›æÆŒÆn„ÞT`;
      optimizations.push({
        type: 'format',
        description: 'Added polite Chinese formatting preferred by Kimi',
        before: prompt.substring(0, 100) + '...',
        after: structuredPrompt.substring(0, 100) + '...'
      });
      optimizedPrompt = structuredPrompt;
    }

    // 2. Add context for better understanding
    if (context?.branchContext?.branchSummary) {
      const contextPrompt = `Ìoáo${context.branchContext.branchSummary}\n\nSMû¡${optimizedPrompt}`;
      optimizations.push({
        type: 'specificity',
        description: 'Added context in Chinese for better Kimi understanding',
        before: optimizedPrompt.substring(0, 50) + '...',
        after: contextPrompt.substring(0, 50) + '...'
      });
      optimizedPrompt = contextPrompt;
    }

    // 3. Leverage Kimi's strength in document analysis
    if (prompt.includes('analyze') || prompt.includes('summarize') || prompt.includes('') || prompt.includes(';Ó')) {
      const analysisPrompt = `${optimizedPrompt}\n\n÷(åÓ„ÛL\n1. ;Â¹\n2. æÆ\n3. ÓºŒú®`;
      optimizations.push({
        type: 'structure',
        description: 'Added analysis structure optimized for Kimi',
        before: optimizedPrompt.substring(-50),
        after: analysisPrompt.substring(-50)
      });
      optimizedPrompt = analysisPrompt;
    }

    // 4. Optimize for Kimi's very large context window
    if (optimizedPrompt.length > 100000) {
      optimizedPrompt = optimizedPrompt.substring(0, 100000) + '...\n\n÷úŽ
ðáoÛL';
      optimizations.push({
        type: 'length',
        description: 'Optimized length for Kimi\'s large context window',
        before: `${prompt.length} characters`,
        after: `${optimizedPrompt.length} characters`
      });
    }

    return {
      model: this.model,
      originalPrompt: prompt,
      optimizedPrompt,
      optimizations,
      estimatedImprovementScore: optimizations.length * 0.18 // 18% per optimization for Kimi
    };
  }

  /**
   * Estimate cost for request
   */
  estimateCost(request: ChatCompletionRequest): number {
    // Conservative token estimation for Kimi: ~3 characters per token
    const inputTokens = JSON.stringify(request.messages).length / 3;
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
    // Use Kimi's latest model
    return 'moonshot-v1-8k';
  }

  private formatMessagesForKimi(
    messages: Array<{ role: string; content: string }>, 
    systemPrompt?: string
  ): KimiMessage[] {
    const formattedMessages: KimiMessage[] = [];

    // Add system message if provided
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }

    // Convert messages to Kimi format
    for (const message of messages) {
      if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
        formattedMessages.push({
          role: message.role as 'user' | 'assistant' | 'system',
          content: message.content
        });
      }
    }

    return formattedMessages;
  }

  private async makeRequest(endpoint: string, method: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Synapse-AI-Platform/1.0'
    };

    const requestOptions: RequestInit = {
      method,
      headers
    };

    if (body && method !== 'GET') {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  private async* makeStreamRequest(endpoint: string, body: any): AsyncGenerator<any, void, unknown> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'User-Agent': 'Synapse-AI-Platform/1.0'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body reader available');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            
            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (error) {
              console.warn('Failed to parse Kimi stream chunk:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private mapFinishReason(reason: string | null): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
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

  private updateRateLimits(completion: KimiResponse): void {
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
    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      return this.createAIModelError('Rate limit exceeded', {
        type: 'rate_limit',
        statusCode: 429,
        retryable: true,
        retryAfter: 60,
        originalError: error
      });
    }

    if (error.message?.includes('400') || error.message?.includes('invalid')) {
      return this.createAIModelError('Invalid request', {
        type: 'invalid_request',
        statusCode: 400,
        retryable: false,
        originalError: error
      });
    }

    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      return this.createAIModelError('Invalid API key', {
        type: 'api_error',
        statusCode: 401,
        retryable: false,
        originalError: error
      });
    }

    if (error.message?.includes('5') || error.message?.includes('server')) {
      return this.createAIModelError('Kimi API error', {
        type: 'api_error',
        statusCode: 500,
        retryable: true,
        originalError: error
      });
    }

    return this.createAIModelError(error.message || 'Unknown Kimi error', {
      type: 'unknown',
      retryable: false,
      originalError: error
    });
  }
}