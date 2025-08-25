import { tidbClient, TiDBError, TiDBErrorType } from './client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Common database queries and utilities
 * Provides high-level database operations for the SYNAPSE platform
 */

export interface ConversationData {
  id: string;
  projectId?: string;
  title: string;
  titleEmbedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchData {
  id: string;
  conversationId: string;
  parentBranchId?: string;
  name: string;
  model: 'claude' | 'gpt4' | 'kimi' | 'grok';
  contextSummary?: string;
  contextEmbedding: number[];
  createdAt: Date;
}

export interface MessageData {
  id: string;
  branchId: string;
  role: 'user' | 'assistant';
  content: string;
  contentEmbedding: number[];
  model?: string;
  tokenCount: number;
  processingTimeMs: number;
  createdAt: Date;
}

export interface DocumentData {
  id: string;
  projectId: string;
  filename: string;
  content: string;
  contentEmbedding: number[];
  metadata: Record<string, any>;
  s3Key?: string;
  fileSize: number;
  mimeType: string;
  processedAt: Date;
}

export interface ConceptData {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  conceptEmbedding: number[];
  mentionCount: number;
  confidenceScore: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database Query Service
 */
export class DatabaseQueries {
  /**
   * Create a new conversation
   */
  static async createConversation(
    title: string,
    titleEmbedding: number[],
    projectId?: string
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO conversations (id, project_id, title, title_embedding)
        VALUES (?, ?, ?, ?)
      `;

      await tidbClient.query(sql, [id, projectId, title, JSON.stringify(titleEmbedding)]);
      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create conversation', error);
    }
  }

  /**
   * Get conversation by ID
   */
  static async getConversation(id: string): Promise<ConversationData | null> {
    try {
      const sql = `
        SELECT id, project_id as projectId, title, title_embedding as titleEmbedding,
               created_at as createdAt, updated_at as updatedAt
        FROM conversations
        WHERE id = ?
      `;

      const result = await tidbClient.query<ConversationData>(sql, [id]);
      
      if (result.rows.length === 0) return null;
      
      const conversation = result.rows[0];
      conversation.titleEmbedding = JSON.parse(conversation.titleEmbedding as any);
      
      return conversation;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get conversation', error);
    }
  }

  /**
   * Create a new branch
   */
  static async createBranch(
    conversationId: string,
    name: string,
    model: 'claude' | 'gpt4' | 'kimi' | 'grok',
    contextEmbedding: number[],
    parentBranchId?: string,
    contextSummary?: string
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO branches (id, conversation_id, parent_branch_id, name, model, context_summary, context_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      await tidbClient.query(sql, [
        id,
        conversationId,
        parentBranchId,
        name,
        model,
        contextSummary,
        JSON.stringify(contextEmbedding)
      ]);

      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create branch', error);
    }
  }

  /**
   * Get branches for a conversation
   */
  static async getBranches(conversationId: string): Promise<BranchData[]> {
    try {
      const sql = `
        SELECT id, conversation_id as conversationId, parent_branch_id as parentBranchId,
               name, model, context_summary as contextSummary, context_embedding as contextEmbedding,
               created_at as createdAt
        FROM branches
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `;

      const result = await tidbClient.query<BranchData>(sql, [conversationId]);
      
      return result.rows.map(branch => ({
        ...branch,
        contextEmbedding: JSON.parse(branch.contextEmbedding as any)
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get branches', error);
    }
  }

  /**
   * Create a new message
   */
  static async createMessage(
    branchId: string,
    role: 'user' | 'assistant',
    content: string,
    contentEmbedding: number[],
    model?: string,
    tokenCount = 0,
    processingTimeMs = 0
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO messages (id, branch_id, role, content, content_embedding, model, token_count, processing_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await tidbClient.query(sql, [
        id,
        branchId,
        role,
        content,
        JSON.stringify(contentEmbedding),
        model,
        tokenCount,
        processingTimeMs
      ]);

      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create message', error);
    }
  }

  /**
   * Get messages for a branch
   */
  static async getMessages(branchId: string): Promise<MessageData[]> {
    try {
      const sql = `
        SELECT id, branch_id as branchId, role, content, content_embedding as contentEmbedding,
               model, token_count as tokenCount, processing_time_ms as processingTimeMs,
               created_at as createdAt
        FROM messages
        WHERE branch_id = ?
        ORDER BY created_at ASC
      `;

      const result = await tidbClient.query<MessageData>(sql, [branchId]);
      
      return result.rows.map(message => ({
        ...message,
        contentEmbedding: JSON.parse(message.contentEmbedding as any)
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get messages', error);
    }
  }

  /**
   * Create a new document
   */
  static async createDocument(
    projectId: string,
    filename: string,
    content: string,
    contentEmbedding: number[],
    metadata: Record<string, any> = {},
    s3Key?: string,
    fileSize = 0,
    mimeType = 'text/plain'
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO documents (id, project_id, filename, content, content_embedding, metadata, s3_key, file_size, mime_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await tidbClient.query(sql, [
        id,
        projectId,
        filename,
        content,
        JSON.stringify(contentEmbedding),
        JSON.stringify(metadata),
        s3Key,
        fileSize,
        mimeType
      ]);

      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create document', error);
    }
  }

  /**
   * Get documents for a project
   */
  static async getDocuments(projectId: string): Promise<DocumentData[]> {
    try {
      const sql = `
        SELECT id, project_id as projectId, filename, content, content_embedding as contentEmbedding,
               metadata, s3_key as s3Key, file_size as fileSize, mime_type as mimeType,
               processed_at as processedAt
        FROM documents
        WHERE project_id = ?
        ORDER BY processed_at DESC
      `;

      const result = await tidbClient.query<DocumentData>(sql, [projectId]);
      
      return result.rows.map(doc => ({
        ...doc,
        contentEmbedding: JSON.parse(doc.contentEmbedding as any),
        metadata: JSON.parse(doc.metadata as any)
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get documents', error);
    }
  }

  /**
   * Create a new concept
   */
  static async createConcept(
    projectId: string,
    name: string,
    conceptEmbedding: number[],
    description?: string,
    mentionCount = 1,
    confidenceScore = 0.5
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO concepts (id, project_id, name, description, concept_embedding, mention_count, confidence_score)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      await tidbClient.query(sql, [
        id,
        projectId,
        name,
        description,
        JSON.stringify(conceptEmbedding),
        mentionCount,
        confidenceScore
      ]);

      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create concept', error);
    }
  }

  /**
   * Get concepts for a project
   */
  static async getConcepts(projectId: string): Promise<ConceptData[]> {
    try {
      const sql = `
        SELECT id, project_id as projectId, name, description, concept_embedding as conceptEmbedding,
               mention_count as mentionCount, confidence_score as confidenceScore,
               created_at as createdAt, updated_at as updatedAt
        FROM concepts
        WHERE project_id = ?
        ORDER BY mention_count DESC, confidence_score DESC
      `;

      const result = await tidbClient.query<ConceptData>(sql, [projectId]);
      
      return result.rows.map(concept => ({
        ...concept,
        conceptEmbedding: JSON.parse(concept.conceptEmbedding as any)
      }));
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get concepts', error);
    }
  }

  /**
   * Update concept mention count
   */
  static async updateConceptMentions(conceptId: string, increment = 1): Promise<void> {
    try {
      const sql = `
        UPDATE concepts 
        SET mention_count = mention_count + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      await tidbClient.query(sql, [increment, conceptId]);
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to update concept mentions', error);
    }
  }

  /**
   * Create concept relationship
   */
  static async createConceptRelationship(
    sourceConceptId: string,
    targetConceptId: string,
    relationshipType: 'related' | 'parent' | 'child' | 'similar' | 'opposite' | 'causes' | 'enables',
    strength = 0.5
  ): Promise<string> {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO concept_relationships (id, source_concept_id, target_concept_id, relationship_type, strength)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE strength = VALUES(strength)
      `;

      await tidbClient.query(sql, [id, sourceConceptId, targetConceptId, relationshipType, strength]);
      return id;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to create concept relationship', error);
    }
  }

  /**
   * Get conversation tree structure
   */
  static async getConversationTree(conversationId: string): Promise<{
    conversation: ConversationData;
    branches: Array<BranchData & { messages: MessageData[] }>;
  }> {
    try {
      // Get conversation
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Get branches
      const branches = await this.getBranches(conversationId);

      // Get messages for each branch
      const branchesWithMessages = await Promise.all(
        branches.map(async (branch) => ({
          ...branch,
          messages: await this.getMessages(branch.id)
        }))
      );

      return {
        conversation,
        branches: branchesWithMessages
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get conversation tree', error);
    }
  }

  /**
   * Get project overview
   */
  static async getProjectOverview(projectId: string): Promise<{
    conversations: ConversationData[];
    documents: DocumentData[];
    concepts: ConceptData[];
    stats: {
      totalConversations: number;
      totalBranches: number;
      totalMessages: number;
      totalDocuments: number;
      totalConcepts: number;
    };
  }> {
    try {
      // Get conversations
      const conversationsSql = `
        SELECT id, project_id as projectId, title, title_embedding as titleEmbedding,
               created_at as createdAt, updated_at as updatedAt
        FROM conversations
        WHERE project_id = ?
        ORDER BY updated_at DESC
        LIMIT 10
      `;

      const conversationsResult = await tidbClient.query<ConversationData>(conversationsSql, [projectId]);
      const conversations = conversationsResult.rows.map(conv => ({
        ...conv,
        titleEmbedding: JSON.parse(conv.titleEmbedding as any)
      }));

      // Get documents and concepts
      const [documents, concepts] = await Promise.all([
        this.getDocuments(projectId),
        this.getConcepts(projectId)
      ]);

      // Get stats
      const statsSql = `
        SELECT 
          (SELECT COUNT(*) FROM conversations WHERE project_id = ?) as totalConversations,
          (SELECT COUNT(*) FROM branches b JOIN conversations c ON b.conversation_id = c.id WHERE c.project_id = ?) as totalBranches,
          (SELECT COUNT(*) FROM messages m JOIN branches b ON m.branch_id = b.id JOIN conversations c ON b.conversation_id = c.id WHERE c.project_id = ?) as totalMessages,
          (SELECT COUNT(*) FROM documents WHERE project_id = ?) as totalDocuments,
          (SELECT COUNT(*) FROM concepts WHERE project_id = ?) as totalConcepts
      `;

      const statsResult = await tidbClient.query(statsSql, [projectId, projectId, projectId, projectId, projectId]);

      return {
        conversations,
        documents: documents.slice(0, 10), // Limit for overview
        concepts: concepts.slice(0, 10), // Limit for overview
        stats: statsResult.rows[0] || {
          totalConversations: 0,
          totalBranches: 0,
          totalMessages: 0,
          totalDocuments: 0,
          totalConcepts: 0
        }
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get project overview', error);
    }
  }

  /**
   * Delete conversation and all related data
   */
  static async deleteConversation(conversationId: string): Promise<void> {
    try {
      await tidbClient.transaction(async (connection) => {
        // Delete messages (cascade will handle this, but explicit for clarity)
        await connection.query(`
          DELETE m FROM messages m
          JOIN branches b ON m.branch_id = b.id
          WHERE b.conversation_id = ?
        `, [conversationId]);

        // Delete branches
        await connection.query('DELETE FROM branches WHERE conversation_id = ?', [conversationId]);

        // Delete conversation
        await connection.query('DELETE FROM conversations WHERE id = ?', [conversationId]);
      });
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to delete conversation', error);
    }
  }

  /**
   * Delete document and update related concepts
   */
  static async deleteDocument(documentId: string): Promise<void> {
    try {
      await tidbClient.transaction(async (connection) => {
        // Get document info first
        const docResult = await connection.query('SELECT project_id FROM documents WHERE id = ?', [documentId]);
        
        if (docResult[0].length === 0) {
          throw new Error('Document not found');
        }

        // Delete document
        await connection.query('DELETE FROM documents WHERE id = ?', [documentId]);

        // Note: In a real implementation, you might want to update concept mention counts
        // based on the deleted document content
      });
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to delete document', error);
    }
  }

  /**
   * Batch insert messages for performance
   */
  static async batchInsertMessages(messages: Omit<MessageData, 'id' | 'createdAt'>[]): Promise<string[]> {
    try {
      const ids: string[] = [];
      const values: any[] = [];

      for (const message of messages) {
        const id = uuidv4();
        ids.push(id);
        values.push([
          id,
          message.branchId,
          message.role,
          message.content,
          JSON.stringify(message.contentEmbedding),
          message.model,
          message.tokenCount,
          message.processingTimeMs
        ]);
      }

      if (values.length > 0) {
        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const sql = `
          INSERT INTO messages (id, branch_id, role, content, content_embedding, model, token_count, processing_time_ms)
          VALUES ${placeholders}
        `;

        await tidbClient.query(sql, values.flat());
      }

      return ids;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to batch insert messages', error);
    }
  }
}

export default DatabaseQueries;