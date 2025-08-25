/**
 * Conversation repository for database operations
 * Handles conversations with title embeddings and project relationships
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateProjectInput, validateUpdateProjectInput } from '../utils/validation';
import type { 
  Project, 
  CreateProjectInput, 
  UpdateProjectInput,
  ValidationResult,
  VectorSearchResult
} from '../../types';

// Conversation interface (extends Project for now, will be separate later)
export interface Conversation extends Project {
  title: string;
  titleEmbedding: number[];
}

export interface CreateConversationInput extends CreateProjectInput {
  title: string;
  projectId?: string;
}

export interface UpdateConversationInput extends UpdateProjectInput {
  title?: string;
}

export class ConversationRepository extends BaseRepository<Conversation, CreateConversationInput, UpdateConversationInput> {
  protected tableName = 'conversations';

  protected validateCreate = (data: unknown): ValidationResult => {
    // For now, use project validation - will be updated when conversation schema is separate
    return validateCreateProjectInput(data);
  };

  protected validateUpdate = (data: unknown): ValidationResult => {
    return validateUpdateProjectInput(data);
  };

  protected mapRowToEntity = (row: any): Conversation => {
    return {
      id: row.id,
      name: row.title || row.name, // Handle both title and name fields
      description: row.description,
      customInstructions: row.custom_instructions,
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at),
      title: row.title || row.name,
      titleEmbedding: this.parseEmbedding(row.title_embedding)
    };
  };

  protected getCreateFields(input: CreateConversationInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      project_id: input.projectId || null,
      title: input.title || input.name,
      title_embedding: this.serializeEmbedding([]), // Will be updated with actual embedding
      created_at: now,
      updated_at: now
    };
  };

  protected getUpdateFields(input: UpdateConversationInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    if (input.title) fields.title = input.title;
    if (input.name) fields.title = input.name; // Handle both title and name
    if (input.description !== undefined) fields.description = input.description;
    if (input.customInstructions !== undefined) fields.custom_instructions = input.customInstructions;
    
    return fields;
  };

  /**
   * Update conversation title embedding
   */
  async updateTitleEmbedding(id: string, embedding: number[]): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET title_embedding = ? WHERE id = ?`;
    await this.executeQuery(sql, [this.serializeEmbedding(embedding), id]);
  }

  /**
   * Search conversations by title similarity
   */
  async searchByTitle(
    embedding: number[], 
    projectId?: string, 
    limit = 20, 
    threshold = 0.3
  ): Promise<VectorSearchResult[]> {
    const filters = projectId ? { project_id: projectId } : {};
    
    return await tidbClient.vectorSearch(
      embedding,
      this.tableName,
      'title_embedding',
      'title',
      filters,
      limit,
      threshold
    );
  }

  /**
   * Find conversations by project
   */
  async findByProject(projectId: string): Promise<Conversation[]> {
    return await this.findBy('project_id', projectId);
  }

  /**
   * Get conversation statistics
   */
  async getStatistics(projectId?: string): Promise<{
    totalConversations: number;
    conversationsThisWeek: number;
    averageTitleLength: number;
    mostActiveConversation: { id: string; title: string; messageCount: number } | null;
  }> {
    try {
      const whereClause = projectId ? 'WHERE c.project_id = ?' : '';
      const params = projectId ? [projectId] : [];

      // Get basic statistics
      const statsSql = `
        SELECT 
          COUNT(*) as total_conversations,
          COUNT(CASE WHEN c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as conversations_this_week,
          AVG(CHAR_LENGTH(c.title)) as avg_title_length
        FROM conversations c
        ${whereClause}
      `;
      
      const statsResult = await this.executeQuery(statsSql, params);
      const stats = statsResult.rows[0];

      // Get most active conversation (by message count)
      const mostActiveSql = `
        SELECT 
          c.id,
          c.title,
          COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN branches b ON c.id = b.conversation_id
        LEFT JOIN messages m ON b.id = m.branch_id
        ${whereClause}
        GROUP BY c.id, c.title
        ORDER BY message_count DESC
        LIMIT 1
      `;

      const mostActiveResult = await this.executeQuery(mostActiveSql, params);
      const mostActive = mostActiveResult.rows.length > 0 ? {
        id: mostActiveResult.rows[0].id,
        title: mostActiveResult.rows[0].title,
        messageCount: mostActiveResult.rows[0].message_count
      } : null;

      return {
        totalConversations: stats.total_conversations,
        conversationsThisWeek: stats.conversations_this_week,
        averageTitleLength: Math.round(stats.avg_title_length || 0),
        mostActiveConversation: mostActive
      };
    } catch (error) {
      throw new Error(`Failed to get conversation statistics: ${error}`);
    }
  }

  /**
   * Get recent conversations
   */
  async getRecent(limit = 10, projectId?: string): Promise<Conversation[]> {
    try {
      const whereClause = projectId ? 'WHERE project_id = ?' : '';
      const params = projectId ? [projectId, limit] : [limit];
      
      const sql = `
        SELECT * FROM ${this.tableName} 
        ${whereClause}
        ORDER BY updated_at DESC 
        LIMIT ?
      `;
      
      const result = await this.executeQuery(sql, params);
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to get recent conversations: ${error}`);
    }
  }

  /**
   * Search conversations with hybrid search (title + full-text)
   */
  async hybridSearch(
    query: string,
    embedding: number[],
    projectId?: string,
    limit = 20
  ): Promise<VectorSearchResult[]> {
    const filters = projectId ? { project_id: projectId } : {};
    
    return await tidbClient.hybridSearch(
      query,
      embedding,
      this.tableName,
      'title_embedding',
      'title',
      0.7, // Vector weight
      0.3, // Text weight
      filters,
      limit
    );
  }
}