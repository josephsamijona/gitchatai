/**
 * Message repository for chat messages with vector embeddings
 * Handles messages with content embeddings and performance tracking
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateMessageInput, validateUpdateMessageInput } from '../utils/validation';
import type { 
  Message, 
  CreateMessageInput, 
  UpdateMessageInput,
  MessageWithContext,
  MessageSearchResult,
  ValidationResult,
  VectorSearchResult,
  MessageRole,
  PaginatedResponse,
  PaginationParams
} from '../../types';

export class MessageRepository extends BaseRepository<Message, CreateMessageInput, UpdateMessageInput> {
  protected tableName = 'messages';

  protected validateCreate = validateCreateMessageInput;
  protected validateUpdate = validateUpdateMessageInput;

  protected mapRowToEntity = (row: any): Message => {
    return {
      id: row.id,
      branchId: row.branch_id,
      role: row.role as MessageRole,
      content: row.content,
      contentEmbedding: this.parseEmbedding(row.content_embedding),
      model: row.model || undefined,
      tokenCount: row.token_count || 0,
      processingTimeMs: row.processing_time_ms || 0,
      createdAt: this.parseDate(row.created_at)
    };
  };

  protected getCreateFields(input: CreateMessageInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      branch_id: input.branchId,
      role: input.role,
      content: input.content,
      content_embedding: this.serializeEmbedding([]), // Will be updated with actual embedding
      model: input.model || null,
      token_count: input.tokenCount || 0,
      processing_time_ms: input.processingTimeMs || 0,
      created_at: now
    };
  };

  protected getUpdateFields(input: UpdateMessageInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    if (input.content) fields.content = input.content;
    if (input.tokenCount !== undefined) fields.token_count = input.tokenCount;
    if (input.processingTimeMs !== undefined) fields.processing_time_ms = input.processingTimeMs;
    
    return fields;
  };

  /**
   * Update message content embedding
   */
  async updateContentEmbedding(id: string, embedding: number[]): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET content_embedding = ? WHERE id = ?`;
    await this.executeQuery(sql, [this.serializeEmbedding(embedding), id]);
  }

  /**
   * Find messages by branch
   */
  async findByBranch(branchId: string, params?: PaginationParams): Promise<PaginatedResponse<Message>> {
    try {
      const pagination = params || { page: 1, limit: 50 };
      const offset = (pagination.page - 1) * pagination.limit;

      // Get total count
      const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} WHERE branch_id = ?`;
      const countResult = await this.executeQuery(countSql, [branchId]);
      const total = countResult.rows[0].total;

      // Get paginated messages
      const dataSql = `
        SELECT * FROM ${this.tableName} 
        WHERE branch_id = ? 
        ORDER BY created_at ASC 
        LIMIT ? OFFSET ?
      `;
      const dataResult = await this.executeQuery(dataSql, [branchId, pagination.limit, offset]);

      const data = dataResult.rows.map(row => this.mapRowToEntity(row));
      const totalPages = Math.ceil(total / pagination.limit);

      return {
        data,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages,
          hasNext: pagination.page < totalPages,
          hasPrev: pagination.page > 1
        }
      };
    } catch (error) {
      throw new Error(`Failed to find messages by branch: ${error}`);
    }
  }

  /**
   * Find messages by role
   */
  async findByRole(role: MessageRole, branchId?: string): Promise<Message[]> {
    try {
      const whereClause = branchId 
        ? 'WHERE role = ? AND branch_id = ?'
        : 'WHERE role = ?';
      const params = branchId ? [role, branchId] : [role];

      const sql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY created_at DESC`;
      const result = await this.executeQuery(sql, params);
      
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find messages by role: ${error}`);
    }
  }

  /**
   * Get message with context (branch and conversation info)
   */
  async findWithContext(id: string): Promise<MessageWithContext> {
    try {
      const sql = `
        SELECT 
          m.*,
          b.id as branch_id,
          b.name as branch_name,
          b.model as branch_model,
          c.id as conversation_id,
          c.title as conversation_title
        FROM ${this.tableName} m
        JOIN branches b ON m.branch_id = b.id
        JOIN conversations c ON b.conversation_id = c.id
        WHERE m.id = ?
      `;

      const result = await this.executeQuery(sql, [id]);
      
      if (result.rows.length === 0) {
        throw new Error(`Message with id ${id} not found`);
      }

      const row = result.rows[0];
      const message = this.mapRowToEntity(row);

      return {
        ...message,
        branch: {
          id: row.branch_id,
          name: row.branch_name,
          model: row.branch_model
        },
        conversation: {
          id: row.conversation_id,
          title: row.conversation_title
        }
      };
    } catch (error) {
      throw new Error(`Failed to find message with context: ${error}`);
    }
  }

  /**
   * Search messages by content similarity
   */
  async searchByContent(
    embedding: number[], 
    branchId?: string, 
    conversationId?: string,
    limit = 20, 
    threshold = 0.3
  ): Promise<VectorSearchResult[]> {
    try {
      let filters: Record<string, any> = {};
      
      if (branchId) {
        filters.branch_id = branchId;
      } else if (conversationId