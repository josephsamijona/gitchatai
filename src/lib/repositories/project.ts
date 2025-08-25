/**
 * Project repository for workspace management
 * Handles projects with team members and analytics
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateProjectInput, validateUpdateProjectInput } from '../utils/validation';
import type { 
  Project, 
  CreateProjectInput, 
  UpdateProjectInput,
  ProjectWithContext,
  ProjectStatistics,
  ProjectAnalytics,
  TeamMember,
  ValidationResult,
  PaginatedResponse,
  PaginationParams
} from '../../types';

export class ProjectRepository extends BaseRepository<Project, CreateProjectInput, UpdateProjectInput> {
  protected tableName = 'projects';

  protected validateCreate = validateCreateProjectInput;
  protected validateUpdate = validateUpdateProjectInput;

  protected mapRowToEntity = (row: any): Project => {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      customInstructions: row.custom_instructions || undefined,
      createdAt: this.parseDate(row.created_at),
      updatedAt: row.updated_at ? this.parseDate(row.updated_at) : undefined
    };
  };

  protected getCreateFields(input: CreateProjectInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      name: input.name,
      description: input.description || null,
      custom_instructions: input.customInstructions || null,
      created_at: now,
      updated_at: now
    };
  };

  protected getUpdateFields(input: UpdateProjectInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    if (input.name) fields.name = input.name;
    if (input.description !== undefined) fields.description = input.description;
    if (input.customInstructions !== undefined) fields.custom_instructions = input.customInstructions;
    
    return fields;
  };

  /**
   * Get project with full context (stats, team members, recent activity)
   */
  async findWithContext(id: string): Promise<ProjectWithContext> {
    try {
      const project = await this.findById(id);

      // Get team members
      const teamSql = `
        SELECT 
          id, email, role, joined_at, permissions
        FROM team_members 
        WHERE project_id = ? 
        ORDER BY joined_at ASC
      `;
      const teamResult = await this.executeQuery(teamSql, [id]);
      const teamMembers: TeamMember[] = teamResult.rows.map(row => ({
        id: row.id,
        projectId: id,
        email: row.email,
        role: row.role,
        joinedAt: this.parseDate(row.joined_at),
        permissions: this.parseJSON(row.permissions)
      }));

      // Get project statistics
      const statistics = await this.getStatistics(id);

      // Get recent activity
      const activitySql = `
        SELECT 
          'conversation' as activity_type,
          c.id as activity_id,
          c.title as activity_name,
          c.created_at as activity_time
        FROM conversations c
        WHERE c.project_id = ?
        UNION ALL
        SELECT 
          'document' as activity_type,
          d.id as activity_id,
          d.filename as activity_name,
          d.processed_at as activity_time
        FROM documents d
        WHERE d.project_id = ?
        ORDER BY activity_time DESC
        LIMIT 10
      `;
      
      const activityResult = await this.executeQuery(activitySql, [id, id]);
      const recentActivity = activityResult.rows.map(row => ({
        type: row.activity_type,
        id: row.activity_id,
        name: row.activity_name,
        timestamp: this.parseDate(row.activity_time)
      }));

      return {
        ...project,
        statistics,
        teamMembers,
        recentActivity
      };
    } catch (error) {
      throw new Error(`Failed to find project with context: ${error}`);
    }
  }

  /**
   * Get project statistics
   */
  async getStatistics(projectId: string): Promise<ProjectStatistics> {
    try {
      // Get basic counts
      const basicStatsSql = `
        SELECT 
          (SELECT COUNT(*) FROM conversations WHERE project_id = ?) as conversation_count,
          (SELECT COUNT(*) FROM documents WHERE project_id = ?) as document_count,
          (SELECT COUNT(*) FROM concepts WHERE project_id = ?) as concept_count,
          (SELECT COUNT(*) FROM team_members WHERE project_id = ?) as team_member_count
      `;
      
      const basicStatsResult = await this.executeQuery(basicStatsSql, [projectId, projectId, projectId, projectId]);
      const basicStats = basicStatsResult.rows[0];

      // Get message counts across all conversations
      const messageSql = `
        SELECT COUNT(m.id) as message_count
        FROM messages m
        JOIN branches b ON m.branch_id = b.id
        JOIN conversations c ON b.conversation_id = c.id
        WHERE c.project_id = ?
      `;
      
      const messageResult = await this.executeQuery(messageSql, [projectId]);
      const messageCount = messageResult.rows[0].message_count;

      // Get storage usage from documents
      const storageSql = `
        SELECT COALESCE(SUM(file_size), 0) as total_storage
        FROM documents 
        WHERE project_id = ?
      `;
      
      const storageResult = await this.executeQuery(storageSql, [projectId]);
      const storageUsedBytes = storageResult.rows[0].total_storage;

      // Get activity metrics
      const activitySql = `
        SELECT 
          COUNT(CASE WHEN c.created_at >= CURDATE() THEN 1 END) as conversations_today,
          COUNT(CASE WHEN c.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as conversations_this_week,
          COUNT(CASE WHEN c.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 END) as conversations_this_month
        FROM conversations c
        WHERE c.project_id = ?
      `;
      
      const activityResult = await this.executeQuery(activitySql, [projectId]);
      const activity = activityResult.rows[0];

      // Get most active conversation
      const mostActiveSql = `
        SELECT 
          c.id,
          c.title,
          COUNT(m.id) as message_count
        FROM conversations c
        LEFT JOIN branches b ON c.id = b.conversation_id
        LEFT JOIN messages m ON b.id = m.branch_id
        WHERE c.project_id = ?
        GROUP BY c.id, c.title
        ORDER BY message_count DESC
        LIMIT 1
      `;
      
      const mostActiveResult = await this.executeQuery(mostActiveSql, [projectId]);
      const mostActiveConversation = mostActiveResult.rows.length > 0 ? {
        conversationId: mostActiveResult.rows[0].id,
        title: mostActiveResult.rows[0].title,
        messageCount: mostActiveResult.rows[0].message_count
      } : null;

      return {
        conversationCount: basicStats.conversation_count,
        messageCount,
        documentCount: basicStats.document_count,
        conceptCount: basicStats.concept_count,
        teamMemberCount: basicStats.team_member_count,
        storageUsedBytes,
        activityMetrics: {
          conversationsToday: activity.conversations_today,
          conversationsThisWeek: activity.conversations_this_week,
          conversationsThisMonth: activity.conversations_this_month,
          mostActiveConversation
        }
      };
    } catch (error) {
      throw new Error(`Failed to get project statistics: ${error}`);
    }
  }

  /**
   * Get project analytics for HTAP demonstration
   */
  async getAnalytics(projectId: string): Promise<ProjectAnalytics> {
    try {
      // Get time-based activity patterns
      const timeSql = `
        SELECT 
          DATE(c.created_at) as date,
          COUNT(*) as conversation_count
        FROM conversations c
        WHERE c.project_id = ? AND c.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(c.created_at)
        ORDER BY date ASC
      `;
      
      const timeResult = await this.executeQuery(timeSql, [projectId]);
      const activityByDay = timeResult.rows.map(row => ({
        date: row.date,
        count: row.conversation_count
      }));

      // Get model usage distribution
      const modelSql = `
        SELECT 
          b.model,
          COUNT(*) as usage_count,
          AVG(CHAR_LENGTH(m.content)) as avg_content_length
        FROM branches b
        JOIN conversations c ON b.conversation_id = c.id
        LEFT JOIN messages m ON b.id = m.branch_id
        WHERE c.project_id = ?
        GROUP BY b.model
        ORDER BY usage_count DESC
      `;
      
      const modelResult = await this.executeQuery(modelSql, [projectId]);
      const modelUsage = modelResult.rows.reduce((acc, row) => {
        acc[row.model] = {
          count: row.usage_count,
          avgContentLength: Math.round(row.avg_content_length || 0)
        };
        return acc;
      }, {} as Record<string, { count: number; avgContentLength: number }>);

      // Get concept relationship insights
      const conceptSql = `
        SELECT 
          cr.relationship_type,
          COUNT(*) as relationship_count,
          AVG(cr.strength) as avg_strength
        FROM concept_relationships cr
        JOIN concepts c1 ON cr.source_concept_id = c1.id
        JOIN concepts c2 ON cr.target_concept_id = c2.id
        WHERE c1.project_id = ? AND c2.project_id = ?
        GROUP BY cr.relationship_type
        ORDER BY relationship_count DESC
      `;
      
      const conceptResult = await this.executeQuery(conceptSql, [projectId, projectId]);
      const conceptInsights = conceptResult.rows.map(row => ({
        type: row.relationship_type,
        count: row.relationship_count,
        avgStrength: parseFloat(row.avg_strength || 0)
      }));

      // Get performance metrics
      const performanceSql = `
        SELECT 
          AVG(pm.execution_time_ms) as avg_query_time,
          COUNT(CASE WHEN pm.success = true THEN 1 END) as successful_operations,
          COUNT(CASE WHEN pm.success = false THEN 1 END) as failed_operations
        FROM performance_metrics pm
        WHERE pm.project_id = ? AND pm.timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `;
      
      const performanceResult = await this.executeQuery(performanceSql, [projectId]);
      const performance = performanceResult.rows[0];

      return {
        projectId,
        generatedAt: new Date(),
        activityByDay,
        modelUsage,
        conceptInsights,
        performanceMetrics: {
          avgQueryTimeMs: Math.round(performance.avg_query_time || 0),
          successfulOperations: performance.successful_operations || 0,
          failedOperations: performance.failed_operations || 0,
          successRate: performance.successful_operations || performance.failed_operations
            ? (performance.successful_operations || 0) / ((performance.successful_operations || 0) + (performance.failed_operations || 0))
            : 0
        }
      };
    } catch (error) {
      throw new Error(`Failed to get project analytics: ${error}`);
    }
  }

  /**
   * Find projects for a user (based on team membership)
   */
  async findForUser(userEmail: string): Promise<Project[]> {
    try {
      const sql = `
        SELECT DISTINCT p.*
        FROM ${this.tableName} p
        JOIN team_members tm ON p.id = tm.project_id
        WHERE tm.email = ?
        ORDER BY p.updated_at DESC
      `;
      
      const result = await this.executeQuery(sql, [userEmail]);
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find projects for user: ${error}`);
    }
  }

  /**
   * Search projects by name or description
   */
  async search(query: string, userEmail?: string): Promise<Project[]> {
    try {
      const searchPattern = `%${query}%`;
      
      let sql = `
        SELECT DISTINCT p.*
        FROM ${this.tableName} p
      `;
      
      let whereConditions = [`(p.name LIKE ? OR p.description LIKE ?)`];
      let params = [searchPattern, searchPattern];
      
      if (userEmail) {
        sql += ` JOIN team_members tm ON p.id = tm.project_id`;
        whereConditions.push(`tm.email = ?`);
        params.push(userEmail);
      }
      
      sql += ` WHERE ${whereConditions.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 50`;
      
      const result = await this.executeQuery(sql, params);
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to search projects: ${error}`);
    }
  }

  /**
   * Get recent projects
   */
  async getRecent(limit = 10, userEmail?: string): Promise<Project[]> {
    try {
      let sql = `SELECT DISTINCT p.* FROM ${this.tableName} p`;
      let params: any[] = [];
      
      if (userEmail) {
        sql += ` JOIN team_members tm ON p.id = tm.project_id WHERE tm.email = ?`;
        params.push(userEmail);
      }
      
      sql += ` ORDER BY p.updated_at DESC LIMIT ?`;
      params.push(limit);
      
      const result = await this.executeQuery(sql, params);
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to get recent projects: ${error}`);
    }
  }

  /**
   * Archive/unarchive project
   */
  async setArchiveStatus(id: string, isArchived: boolean): Promise<void> {
    try {
      const sql = `UPDATE ${this.tableName} SET is_archived = ?, updated_at = NOW() WHERE id = ?`;
      await this.executeQuery(sql, [isArchived, id]);
    } catch (error) {
      throw new Error(`Failed to set archive status: ${error}`);
    }
  }

  /**
   * Get project usage summary for billing/analytics
   */
  async getUsageSummary(projectId: string, startDate: Date, endDate: Date): Promise<{
    messagesGenerated: number;
    tokensUsed: number;
    documentsProcessed: number;
    vectorSearches: number;
    storageUsedMB: number;
  }> {
    try {
      const sql = `
        SELECT 
          (SELECT COUNT(*) FROM messages m 
           JOIN branches b ON m.branch_id = b.id 
           JOIN conversations c ON b.conversation_id = c.id 
           WHERE c.project_id = ? AND m.created_at BETWEEN ? AND ?) as messages_generated,
          (SELECT COALESCE(SUM(m.token_count), 0) FROM messages m 
           JOIN branches b ON m.branch_id = b.id 
           JOIN conversations c ON b.conversation_id = c.id 
           WHERE c.project_id = ? AND m.created_at BETWEEN ? AND ?) as tokens_used,
          (SELECT COUNT(*) FROM documents d 
           WHERE d.project_id = ? AND d.processed_at BETWEEN ? AND ?) as documents_processed,
          (SELECT COUNT(*) FROM performance_metrics pm 
           WHERE pm.project_id = ? AND pm.operation_type = 'vector_search' AND pm.timestamp BETWEEN ? AND ?) as vector_searches,
          (SELECT COALESCE(SUM(d.file_size), 0) / 1024 / 1024 FROM documents d 
           WHERE d.project_id = ?) as storage_used_mb
      `;
      
      const params = [
        projectId, startDate, endDate, // messages
        projectId, startDate, endDate, // tokens
        projectId, startDate, endDate, // documents
        projectId, startDate, endDate, // vector searches
        projectId // storage
      ];
      
      const result = await this.executeQuery(sql, params);
      const row = result.rows[0];
      
      return {
        messagesGenerated: row.messages_generated,
        tokensUsed: row.tokens_used,
        documentsProcessed: row.documents_processed,
        vectorSearches: row.vector_searches,
        storageUsedMB: Math.round(row.storage_used_mb * 100) / 100
      };
    } catch (error) {
      throw new Error(`Failed to get usage summary: ${error}`);
    }
  }
}