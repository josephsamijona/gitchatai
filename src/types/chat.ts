/**
 * Chat-related TypeScript interfaces for SYNAPSE platform
 * Based on TiDB schema with vector embeddings and multi-model support
 */

export type MessageRole = 'user' | 'assistant';
export type AIModel = 'claude' | 'gpt4' | 'kimi' | 'grok';

/**
 * Core message interface with vector embeddings
 */
export interface Message {
  id: string;
  branchId: string;
  role: MessageRole;
  content: string;
  contentEmbedding: number[];
  model?: string;
  tokenCount: number;
  processingTimeMs: number;
  createdAt: Date;
}

/**
 * Message creation input (without generated fields)
 */
export interface CreateMessageInput {
  branchId: string;
  role: MessageRole;
  content: string;
  model?: string;
  tokenCount?: number;
  processingTimeMs?: number;
}

/**
 * Message update input (partial fields)
 */
export interface UpdateMessageInput {
  content?: string;
  tokenCount?: number;
  processingTimeMs?: number;
}

/**
 * Message with branch context for display
 */
export interface MessageWithContext extends Message {
  branch: {
    id: string;
    name: string;
    model: AIModel;
  };
  conversation: {
    id: string;
    title: string;
  };
}

/**
 * Message search result with similarity score
 */
export interface MessageSearchResult {
  message: Message;
  similarity: number;
  highlightedContent: string;
  context: {
    branchName: string;
    conversationTitle: string;
  };
}

/**
 * Streaming message chunk for real-time updates
 */
export interface MessageChunk {
  id: string;
  content: string;
  isComplete: boolean;
  model: string;
  tokenCount?: number;
}

/**
 * Message validation schema
 */
export interface MessageValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}