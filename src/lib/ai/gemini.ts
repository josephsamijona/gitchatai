/**
 * Gemini client implementation using Google's Generative AI SDK
 * Handles Gemini API integration with streaming, rate limiting, and optimization
 */

import { GoogleGenerativeAI, GenerativeModel, ChatSession } from '@google/generative-ai';
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

export class GeminiClient implements IAIModelClient {
  public readonly model: AIModel = 'gemini';
  private client: GoogleGenerativeAI;
  private generativeModel: GenerativeModel;
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
  private activeChatSessions: Map<string, ChatSession> = new Map();

  constructor(public readonly config: AIModelConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.generativeModel = this.client.getGenerativeModel({ 
      model: this.getModelVariant(config),
      generationConfig: {
        maxOutputTokens: config.maxTokens || 8192,
        temperature: config.temperature || 0.7
      }
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
    maxContextLength: 1048576, // Gemini Pro 1.5: 1M tokens
    supportsStreaming: true,
    supportsSystemMessages: true,
    supportsFunctionCalling: true,
    supportsVision: true, // Gemini supports multimodal
    pricePerInputToken: 0.00000125, // $1.25 per million input tokens
    pricePerOutputToken: 0.000005, // $5 per million output tokens
    rateLimitRpm: 1500, // Conservative estimate
    rateLimitTpm: 32000,
    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'bn'],
    strengths: [
      'Extremely large context window (1M tokens)',
      'Strong multimodal capabilities (text, images, video)',
      'Excellent code generation and analysis',
      'Fast inference speed',
      'Cost-effective pricing',
      'Strong reasoning and mathematical capabilities',
      'Good multilingual support',
      'Real-time information access (with search)'
    ],
    weaknesses: [
      'May be more verbose than other models',
      'Sometimes overconfident in responses',
      'Limited fine-tuning capabilities',
      'Newer model with less community knowledge'
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
      // Format messages for Gemini
      const { prompt, systemInstruction } = this.formatMessagesForGemini(request.messages, request.systemPrompt);

      // Create model with system instruction if provided
      const model = systemInstruction 
        ? this.client.getGenerativeModel({ 
            model: this.getModelVariant(this.config),
            systemInstruction: systemInstruction,
            generationConfig: {
              maxOutputTokens: request.maxTokens || this.config.maxTokens || 8192,
              temperature: request.temperature ?? this.config.temperature ?? 0.7,
            }
          })
        : this.generativeModel;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, true);
      this.updateRateLimits(response);

      const content = response.text();
      const usage = response.usageMetadata;

      return {
        id: this.generateId(),
        model: this.model,
        content,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
        usage: {
          promptTokens: usage?.promptTokenCount || 0,
          completionTokens: usage?.candidatesTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0
        },
        processingTimeMs: processingTime,
        timestamp: new Date(),
        metadata: {
          geminiModel: this.getModelVariant(this.config),
          finishReason: response.candidates?.[0]?.finishReason,
          safetyRatings: response.candidates?.[0]?.safetyRatings
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
      const { prompt, systemInstruction } = this.formatMessagesForGemini(request.messages, request.systemPrompt);

      const model = systemInstruction 
        ? this.client.getGenerativeModel({ 
            model: this.getModelVariant(this.config),
            systemInstruction: systemInstruction,
            generationConfig: {
              maxOutputTokens: request.maxTokens || this.config.maxTokens || 8192,
              temperature: request.temperature ?? this.config.temperature ?? 0.7,
            }
          })
        : this.generativeModel;

      const result = await model.generateContentStream(prompt);
      
      const completionId = this.generateId();
      let totalText = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        totalText += chunkText;
        
        yield {
          id: completionId,
          model: this.model,
          delta: chunkText,
          finished: false
        };
      }

      // Final chunk with completion info
      const finalResult = await result.response;
      const usage = finalResult.usageMetadata;

      yield {
        id: completionId,
        model: this.model,
        delta: '',
        finished: true,
        finishReason: this.mapFinishReason(finalResult.candidates?.[0]?.finishReason),
        usage: {
          promptTokens: usage?.promptTokenCount || 0,
          completionTokens: usage?.candidatesTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0
        },
        processingTimeMs: Date.now() - startTime
      };

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
      const model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent('ping');
      const response = await result.response;
      return !!response.text();
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
   * Optimize prompt specifically for Gemini
   */
  async optimizePrompt(prompt: string, context?: ConversationContext): Promise<PromptOptimization> {
    const optimizations: PromptOptimization['optimizations'] = [];
    let optimizedPrompt = prompt;

    // 1. Gemini performs well with clear structure and formatting
    if (!prompt.includes('**') && !prompt.includes('##') && prompt.length > 200) {
      const formattedPrompt = `${prompt}\n\n**Please provide a well-structured response with clear headings and bullet points where appropriate.**`;
      optimizations.push({
        type: 'structure',
        description: 'Added formatting guidance for better structure',
        before: prompt.substring(0, 100) + '...',
        after: formattedPrompt.substring(0, 100) + '...'
      });
      optimizedPrompt = formattedPrompt;
    }

    // 2. Add conversation context if available
    if (context?.branchContext?.branchSummary) {
      const contextPrompt = `## Context\n${context.branchContext.branchSummary}\n\n## Current Request\n${optimizedPrompt}`;
      optimizations.push({
        type: 'context',
        description: 'Added conversation context with clear sections',
        before: optimizedPrompt.substring(0, 50) + '...',
        after: contextPrompt.substring(0, 50) + '...'
      });
      optimizedPrompt = contextPrompt;
    }

    // 3. Gemini excels with step-by-step reasoning for complex tasks
    if (prompt.includes('analyze') || prompt.includes('solve') || prompt.includes('explain')) {
      const reasoningPrompt = `${optimizedPrompt}\n\nPlease think through this step by step and provide your reasoning.`;
      optimizations.push({
        type: 'reasoning',
        description: 'Added step-by-step reasoning request',
        before: optimizedPrompt.substring(-50),
        after: reasoningPrompt.substring(-50)
      });
      optimizedPrompt = reasoningPrompt;
    }

    // 4. Leverage Gemini's massive context window efficiently
    if (optimizedPrompt.length > 100000) {
      // Gemini can handle very large contexts, but let's structure it better
      const structuredPrompt = this.structureLargePrompt(optimizedPrompt);
      optimizations.push({
        type: 'length',
        description: 'Structured large prompt for better processing',
        before: `${prompt.length} characters (unstructured)`,
        after: `${structuredPrompt.length} characters (structured)`
      });
      optimizedPrompt = structuredPrompt;
    }

    // 5. Add relevant documents context if available
    if (context?.relevantDocuments?.length) {
      const documentsContext = `## Relevant Documents\n${context.relevantDocuments
        .map((doc, i) => `${i + 1}. ${doc.content.substring(0, 200)}...`)
        .join('\n')}\n\n${optimizedPrompt}`;
      optimizations.push({
        type: 'context',
        description: 'Added relevant documents context',
        before: 'No document context',
        after: `${context.relevantDocuments.length} documents referenced`
      });
      optimizedPrompt = documentsContext;
    }

    return {
      model: this.model,
      originalPrompt: prompt,
      optimizedPrompt,
      optimizations,
      estimatedImprovementScore: optimizations.length * 0.15 // 15% per optimization for Gemini
    };
  }

  /**
   * Estimate cost for request
   */
  estimateCost(request: ChatCompletionRequest): number {
    // Gemini token estimation: ~4 characters per token
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
  private getModelVariant(config: AIModelConfig): string {
    // Default to Gemini 1.5 Flash for best performance and availability
    // Note: gemini-1.5-pro might not be available for all users
    return 'gemini-1.5-flash';
  }

  private formatMessagesForGemini(
    messages: Array<{ role: string; content: string }>, 
    systemPrompt?: string
  ): { prompt: string; systemInstruction?: string } {
    let prompt = '';
    let systemInstruction = systemPrompt;

    // Handle conversation history
    const conversationHistory = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => {
        const roleLabel = msg.role === 'user' ? 'Human' : 'Assistant';
        return `${roleLabel}: ${msg.content}`;
      })
      .join('\n\n');

    // Get the last user message as the main prompt
    const lastUserMessage = messages.filter(msg => msg.role === 'user').pop();
    
    if (conversationHistory && lastUserMessage) {
      prompt = `${conversationHistory}\n\nHuman: ${lastUserMessage.content}`;
    } else if (lastUserMessage) {
      prompt = lastUserMessage.content;
    } else {
      prompt = messages.map(msg => msg.content).join('\n');
    }

    // Combine system messages if any
    const systemMessages = messages.filter(msg => msg.role === 'system');
    if (systemMessages.length > 0) {
      const combinedSystemPrompt = systemMessages.map(msg => msg.content).join('\n\n');
      systemInstruction = systemInstruction 
        ? `${systemInstruction}\n\n${combinedSystemPrompt}`
        : combinedSystemPrompt;
    }

    return { prompt, systemInstruction };
  }

  private structureLargePrompt(prompt: string): string {
    // Break down large prompts into sections for better processing
    const sections = prompt.split('\n\n');
    const structuredSections = sections.map((section, index) => {
      if (section.length > 1000) {
        return `## Section ${index + 1}\n${section}`;
      }
      return section;
    });

    return structuredSections.join('\n\n');
  }

  private mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
      default:
        return 'error';
    }
  }

  private generateId(): string {
    return `gemini_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private updateMetrics(latency: number, success: boolean): void {
    this.performanceMetrics.totalLatency += latency;
    this.performanceMetrics.lastRequestTime = new Date();
    if (success) {
      this.performanceMetrics.successCount++;
    }
  }

  private updateRateLimits(response: any): void {
    this.rateLimitTracker.requests.count++;
    const usage = response.usageMetadata;
    if (usage) {
      this.rateLimitTracker.tokens.count += usage.totalTokenCount || 0;
    }
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
    // Handle Gemini-specific errors
    if (error.message?.includes('quota')) {
      return this.createAIModelError('Quota exceeded', {
        type: 'rate_limit',
        statusCode: 429,
        retryable: true,
        retryAfter: 60,
        originalError: error
      });
    }

    if (error.message?.includes('API key')) {
      return this.createAIModelError('Invalid API key', {
        type: 'authentication',
        statusCode: 401,
        retryable: false,
        originalError: error
      });
    }

    if (error.message?.includes('content too long')) {
      return this.createAIModelError('Request too large', {
        type: 'context_limit',
        statusCode: 413,
        retryable: false,
        originalError: error
      });
    }

    if (error.message?.includes('safety')) {
      return this.createAIModelError('Content filtered by safety policy', {
        type: 'content_filter',
        statusCode: 400,
        retryable: false,
        originalError: error
      });
    }

    return this.createAIModelError(error.message || 'Unknown Gemini error', {
      type: 'unknown',
      retryable: false,
      originalError: error
    });
  }
}