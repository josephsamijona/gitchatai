/**
 * Workspace Service - Project workspace management with isolated contexts
 * Handles project workspaces, chat history persistence, and context isolation
 */

import { tidbClient } from '../tidb/client';
import { ProjectRepository } from '../repositories/project';
import { ConversationRepository } from '../repositories/conversation';
import { DocumentRepository } from '../repositories/document';
import { ConceptRepository } from '../repositories/concept';
import { embeddings } from '../ai/embeddings';
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectWithContext,
  ProjectTemplate,
  WorkspaceContext,
  WorkspaceSettings,
  WorkspaceAnalytics,
  ChatHistory,
  WorkspaceActivity
} from '../../types';

export class WorkspaceService {
  private projectRepo: ProjectRepository;
  private conversationRepo: ConversationRepository;
  private documentRepo: DocumentRepository;
  private conceptRepo: ConceptRepository;

  constructor() {
    this.projectRepo = new ProjectRepository();
    this.conversationRepo = new ConversationRepository();
    this.documentRepo = new DocumentRepository();
    this.conceptRepo = new ConceptRepository();
  }

  /**
   * Create a new workspace with isolated context
   */
  async createWorkspace(input: CreateProjectInput, userId: string): Promise<ProjectWithContext> {
    try {
      // Create the project
      const project = await this.projectRepo.create(input);

      // Initialize workspace context
      const workspaceContext = await this.initializeWorkspaceContext(project.id, userId);

      // Create default conversation for the workspace
      const defaultConversation = await this.conversationRepo.create({
        projectId: project.id,
        title: "Welcome to " + project.name,
        context: {
          projectId: project.id,
          customInstructions: input.customInstructions,
          workspaceSettings: workspaceContext.settings
        }
      });

      // Get full project with context
      const projectWithContext = await this.getProjectWithContext(project.id);

      // Log workspace creation activity
      await this.logActivity(project.id, userId, 'workspace_created', {
        projectName: project.name,
        conversationId: defaultConversation.id
      });

      return projectWithContext;
    } catch (error) {
      console.error('Failed to create workspace:', error);
      throw new Error('Failed to create workspace');
    }
  }

  /**
   * Get project with full context including chat history
   */
  async getProjectWithContext(projectId: string): Promise<ProjectWithContext> {
    try {
      const project = await this.projectRepo.getById(projectId);
      if (!project) {
        throw new Error('Project not found');
      }

      // Get project components
      const [documents, concepts, conversations, statistics, recentActivity] = await Promise.all([
        this.documentRepo.getByProjectId(projectId),
        this.conceptRepo.getByProjectId(projectId),
        this.conversationRepo.getByProjectId(projectId),
        this.getProjectStatistics(projectId),
        this.getRecentActivity(projectId, 20)
      ]);

      return {
        ...project,
        documents,
        concepts,
        conversations,
        statistics,
        recentActivity
      };
    } catch (error) {
      console.error('Failed to get project with context:', error);
      throw new Error('Failed to get project context');
    }
  }

  /**
   * Get chat history for a workspace
   */
  async getWorkspaceChatHistory(projectId: string, options: {
    limit?: number;
    offset?: number;
    searchQuery?: string;
    dateRange?: { start: Date; end: Date };
    conversationId?: string;
  } = {}): Promise<ChatHistory> {
    try {
      const { limit = 50, offset = 0, searchQuery, dateRange, conversationId } = options;

      let query = `
        SELECT 
          c.id as conversation_id,
          c.title as conversation_title,
          c.created_at as conversation_created,
          b.id as branch_id,
          b.name as branch_name,
          b.model as ai_model,
          m.id as message_id,
          m.role,
          m.content,
          m.created_at as message_created,
          m.token_count,
          m.processing_time_ms
        FROM conversations c
        JOIN branches b ON c.id = b.conversation_id
        JOIN messages m ON b.id = m.branch_id
        WHERE c.project_id = ?
      `;
      
      const params: any[] = [projectId];

      // Add filters
      if (conversationId) {
        query += ` AND c.id = ?`;
        params.push(conversationId);
      }

      if (searchQuery) {
        query += ` AND MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE)`;
        params.push(searchQuery);
      }

      if (dateRange) {
        query += ` AND m.created_at BETWEEN ? AND ?`;
        params.push(dateRange.start, dateRange.end);
      }

      query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const result = await tidbClient.executeQuery(query, params);

      // Group messages by conversation and branch
      const conversationMap = new Map();
      
      for (const row of result.rows) {
        const convId = row.conversation_id;
        
        if (!conversationMap.has(convId)) {
          conversationMap.set(convId, {
            id: convId,
            title: row.conversation_title,
            createdAt: row.conversation_created,
            branches: new Map()
          });
        }

        const conv = conversationMap.get(convId);
        const branchId = row.branch_id;

        if (!conv.branches.has(branchId)) {
          conv.branches.set(branchId, {
            id: branchId,
            name: row.branch_name,
            model: row.ai_model,
            messages: []
          });
        }

        conv.branches.get(branchId).messages.push({
          id: row.message_id,
          role: row.role,
          content: row.content,
          createdAt: row.message_created,
          tokenCount: row.token_count,
          processingTime: row.processing_time_ms
        });
      }

      // Convert to array format
      const conversations = Array.from(conversationMap.values()).map(conv => ({
        ...conv,
        branches: Array.from(conv.branches.values())
      }));

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(m.id) as total
        FROM conversations c
        JOIN branches b ON c.id = b.conversation_id
        JOIN messages m ON b.id = m.branch_id
        WHERE c.project_id = ?
        ${conversationId ? 'AND c.id = ?' : ''}
        ${searchQuery ? 'AND MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE)' : ''}
        ${dateRange ? 'AND m.created_at BETWEEN ? AND ?' : ''}
      `;

      const countParams = [projectId];
      if (conversationId) countParams.push(conversationId);
      if (searchQuery) countParams.push(searchQuery);
      if (dateRange) countParams.push(dateRange.start, dateRange.end);

      const countResult = await tidbClient.executeQuery(countQuery, countParams);
      const total = countResult.rows[0]?.total || 0;

      return {
        conversations,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + limit < total
        },
        searchQuery,
        dateRange
      };
    } catch (error) {
      console.error('Failed to get workspace chat history:', error);
      throw new Error('Failed to get chat history');
    }
  }

  /**
   * Initialize workspace context with default settings
   */
  private async initializeWorkspaceContext(projectId: string, userId: string): Promise<WorkspaceContext> {
    const defaultSettings: WorkspaceSettings = {
      aiModelPreferences: {
        defaultModel: 'claude',
        allowModelSwitching: true,
        preferredModels: ['claude', 'gpt4', 'kimi', 'grok']
      },
      searchSettings: {
        enableVectorSearch: true,
        enableFullTextSearch: true,
        hybridSearchWeight: 0.7,
        maxSearchResults: 20
      },
      collaborationSettings: {
        enableRealTimeUpdates: true,
        enableActivityNotifications: true,
        shareKnowledgeGraphs: true,
        allowGuestAccess: false
      },
      documentProcessingSettings: {
        autoExtractConcepts: true,
        chunkSize: 1000,
        chunkOverlap: 200,
        enableOCR: false
      },
      privacySettings: {
        encryptDocuments: false,
        retentionPeriod: 365, // days
        anonymizeExports: false
      }
    };

    const context: WorkspaceContext = {
      projectId,
      ownerId: userId,
      settings: defaultSettings,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store context in database
    await this.storeWorkspaceContext(context);

    return context;
  }

  /**
   * Store workspace context in database
   */
  private async storeWorkspaceContext(context: WorkspaceContext): Promise<void> {
    const query = `
      INSERT INTO workspace_contexts (
        project_id,
        owner_id,
        settings,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `;

    await tidbClient.executeQuery(query, [
      context.projectId,
      context.ownerId,
      JSON.stringify(context.settings),
      context.createdAt,
      context.updatedAt
    ]);
  }

  /**
   * Get workspace context
   */
  async getWorkspaceContext(projectId: string): Promise<WorkspaceContext | null> {
    try {
      const query = `
        SELECT * FROM workspace_contexts 
        WHERE project_id = ?
      `;

      const result = await tidbClient.executeQuery(query, [projectId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        projectId: row.project_id,
        ownerId: row.owner_id,
        settings: JSON.parse(row.settings),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error('Failed to get workspace context:', error);
      return null;
    }
  }

  /**
   * Update workspace settings
   */
  async updateWorkspaceSettings(projectId: string, settings: Partial<WorkspaceSettings>): Promise<WorkspaceContext> {
    try {
      const currentContext = await this.getWorkspaceContext(projectId);
      if (!currentContext) {
        throw new Error('Workspace context not found');
      }

      const updatedSettings = {
        ...currentContext.settings,
        ...settings
      };

      const query = `
        UPDATE workspace_contexts 
        SET settings = ?, updated_at = NOW()
        WHERE project_id = ?
      `;

      await tidbClient.executeQuery(query, [
        JSON.stringify(updatedSettings),
        projectId
      ]);

      return {
        ...currentContext,
        settings: updatedSettings,
        updatedAt: new Date()
      };
    } catch (error) {
      console.error('Failed to update workspace settings:', error);
      throw new Error('Failed to update workspace settings');
    }
  }

  /**
   * Search within workspace context
   */
  async searchInWorkspace(projectId: string, query: string, options: {
    includeMessages?: boolean;
    includeDocuments?: boolean;
    includeConcepts?: boolean;
    limit?: number;
  } = {}): Promise<{
    messages: any[];
    documents: any[];
    concepts: any[];
    totalResults: number;
  }> {
    try {
      const {
        includeMessages = true,
        includeDocuments = true,
        includeConcepts = true,
        limit = 20
      } = options;

      const results = {
        messages: [],
        documents: [],
        concepts: [],
        totalResults: 0
      };

      // Search messages if enabled
      if (includeMessages) {
        const messageQuery = `
          SELECT 
            m.id, m.content, m.role, m.created_at,
            c.title as conversation_title,
            b.name as branch_name, b.model,
            VEC_COSINE_DISTANCE(m.content_embedding, ?) as similarity_score
          FROM messages m
          JOIN branches b ON m.branch_id = b.id
          JOIN conversations c ON b.conversation_id = c.id
          WHERE c.project_id = ? 
            AND (
              MATCH(m.content) AGAINST(? IN NATURAL LANGUAGE MODE)
              OR VEC_COSINE_DISTANCE(m.content_embedding, ?) < 0.3
            )
          ORDER BY similarity_score ASC, m.created_at DESC
          LIMIT ?
        `;

        const queryEmbedding = await embeddings.generateEmbedding(query);
        const messageResult = await tidbClient.executeQuery(messageQuery, [
          queryEmbedding, projectId, query, queryEmbedding, limit
        ]);

        results.messages = messageResult.rows;
      }

      // Search documents if enabled
      if (includeDocuments) {
        const docQuery = `
          SELECT 
            id, filename, content, processed_at, metadata,
            VEC_COSINE_DISTANCE(content_embedding, ?) as similarity_score
          FROM documents
          WHERE project_id = ? 
            AND (
              MATCH(filename, content) AGAINST(? IN NATURAL LANGUAGE MODE)
              OR VEC_COSINE_DISTANCE(content_embedding, ?) < 0.3
            )
          ORDER BY similarity_score ASC, processed_at DESC
          LIMIT ?
        `;

        const queryEmbedding = await embeddings.generateEmbedding(query);
        const docResult = await tidbClient.executeQuery(docQuery, [
          queryEmbedding, projectId, query, queryEmbedding, limit
        ]);

        results.documents = docResult.rows;
      }

      // Search concepts if enabled
      if (includeConcepts) {
        const conceptQuery = `
          SELECT 
            id, name, description, mention_count, created_at,
            VEC_COSINE_DISTANCE(concept_embedding, ?) as similarity_score
          FROM concepts
          WHERE project_id = ? 
            AND (
              MATCH(name, description) AGAINST(? IN NATURAL LANGUAGE MODE)
              OR VEC_COSINE_DISTANCE(concept_embedding, ?) < 0.3
            )
          ORDER BY similarity_score ASC, mention_count DESC
          LIMIT ?
        `;

        const queryEmbedding = await embeddings.generateEmbedding(query);
        const conceptResult = await tidbClient.executeQuery(conceptQuery, [
          queryEmbedding, projectId, query, queryEmbedding, limit
        ]);

        results.concepts = conceptResult.rows;
      }

      results.totalResults = results.messages.length + results.documents.length + results.concepts.length;

      return results;
    } catch (error) {
      console.error('Failed to search in workspace:', error);
      throw new Error('Failed to search workspace');
    }
  }

  /**
   * Get project statistics
   */
  private async getProjectStatistics(projectId: string): Promise<any> {
    try {
      const query = `
        SELECT 
          COUNT(DISTINCT d.id) as total_documents,
          COUNT(DISTINCT c.id) as total_conversations,
          COUNT(DISTINCT b.id) as total_branches,
          COUNT(DISTINCT m.id) as total_messages,
          COUNT(DISTINCT cn.id) as total_concepts,
          COALESCE(SUM(d.file_size), 0) as storage_used
        FROM projects p
        LEFT JOIN documents d ON p.id = d.project_id
        LEFT JOIN conversations c ON p.id = c.project_id
        LEFT JOIN branches b ON c.id = b.conversation_id
        LEFT JOIN messages m ON b.id = m.branch_id
        LEFT JOIN concepts cn ON p.id = cn.project_id
        WHERE p.id = ?
      `;

      const result = await tidbClient.executeQuery(query, [projectId]);
      const stats = result.rows[0];

      return {
        totalDocuments: stats.total_documents || 0,
        totalConversations: stats.total_conversations || 0,
        totalBranches: stats.total_branches || 0,
        totalMessages: stats.total_messages || 0,
        totalConcepts: stats.total_concepts || 0,
        storageUsed: stats.storage_used || 0,
        teamMemberCount: 1, // TODO: Implement team member counting
        activityMetrics: {
          messagesThisWeek: 0, // TODO: Implement time-based metrics
          branchesThisWeek: 0,
          documentsThisWeek: 0,
          activeUsers: 1
        },
        performanceMetrics: {
          averageSearchTime: 150, // TODO: Calculate from performance metrics
          averageResponseTime: 800,
          searchAccuracy: 0.92
        }
      };
    } catch (error) {
      console.error('Failed to get project statistics:', error);
      return {
        totalDocuments: 0,
        totalConversations: 0,
        totalBranches: 0,
        totalMessages: 0,
        totalConcepts: 0,
        storageUsed: 0,
        teamMemberCount: 0,
        activityMetrics: {
          messagesThisWeek: 0,
          branchesThisWeek: 0,
          documentsThisWeek: 0,
          activeUsers: 0
        },
        performanceMetrics: {
          averageSearchTime: 0,
          averageResponseTime: 0,
          searchAccuracy: 0
        }
      };
    }
  }

  /**
   * Get recent workspace activity
   */
  private async getRecentActivity(projectId: string, limit: number = 20): Promise<WorkspaceActivity[]> {
    try {
      const query = `
        SELECT 
          id, project_id, user_id, type, description, metadata, created_at
        FROM workspace_activities
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const result = await tidbClient.executeQuery(query, [projectId, limit]);
      
      return result.rows.map(row => ({
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        type: row.type,
        description: row.description,
        metadata: JSON.parse(row.metadata || '{}'),
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('Failed to get recent activity:', error);
      return [];
    }
  }

  /**
   * Log workspace activity
   */
  async logActivity(
    projectId: string,
    userId: string,
    type: string,
    metadata: Record<string, any>,
    description?: string
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO workspace_activities (
          id, project_id, user_id, type, description, metadata, created_at
        ) VALUES (UUID(), ?, ?, ?, ?, ?, NOW())
      `;

      const activityDescription = description || this.generateActivityDescription(type, metadata);

      await tidbClient.executeQuery(query, [
        projectId,
        userId,
        type,
        activityDescription,
        JSON.stringify(metadata)
      ]);
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw error for activity logging to avoid breaking main functionality
    }
  }

  /**
   * Generate activity description based on type and metadata
   */
  private generateActivityDescription(type: string, metadata: Record<string, any>): string {
    switch (type) {
      case 'workspace_created':
        return `Created workspace "${metadata.projectName}"`;
      case 'document_uploaded':
        return `Uploaded document "${metadata.filename}"`;
      case 'conversation_started':
        return `Started new conversation "${metadata.conversationTitle}"`;
      case 'branch_created':
        return `Created branch "${metadata.branchName}"`;
      case 'concept_discovered':
        return `Discovered concept "${metadata.conceptName}"`;
      case 'member_added':
        return `Added team member ${metadata.memberEmail}`;
      default:
        return `Performed ${type} action`;
    }
  }
}

// Export singleton instance
export const workspaceService = new WorkspaceService();