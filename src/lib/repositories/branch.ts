/**
 * Branch repository for Git-style conversation branching
 * Handles branches with context embeddings and model switching
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateBranchInput, validateUpdateBranchInput } from '../utils/validation';
import type { 
  Branch, 
  CreateBranchInput, 
  UpdateBranchInput,
  BranchWithHierarchy,
  BranchTreeNode,
  BranchStatistics,
  ValidationResult,
  VectorSearchResult,
  AIModel
} from '../../types';

export class BranchRepository extends BaseRepository<Branch, CreateBranchInput, UpdateBranchInput> {
  protected tableName = 'branches';

  protected validateCreate = validateCreateBranchInput;
  protected validateUpdate = validateUpdateBranchInput;

  protected mapRowToEntity = (row: any): Branch => {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      parentBranchId: row.parent_branch_id || undefined,
      name: row.name,
      model: row.model as AIModel,
      contextSummary: row.context_summary || undefined,
      contextEmbedding: this.parseEmbedding(row.context_embedding),
      createdAt: this.parseDate(row.created_at)
    };
  };

  protected getCreateFields(input: CreateBranchInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      conversation_id: input.conversationId,
      parent_branch_id: input.parentBranchId || null,
      name: input.name,
      model: input.model,
      context_summary: input.contextSummary || null,
      context_embedding: this.serializeEmbedding([]), // Will be updated with actual embedding
      created_at: now
    };
  };

  protected getUpdateFields(input: UpdateBranchInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    if (input.name) fields.name = input.name;
    if (input.model) fields.model = input.model;
    if (input.contextSummary !== undefined) fields.context_summary = input.contextSummary;
    
    return fields;
  };

  /**
   * Update branch context embedding
   */
  async updateContextEmbedding(id: string, embedding: number[]): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET context_embedding = ? WHERE id = ?`;
    await this.executeQuery(sql, [this.serializeEmbedding(embedding), id]);
  }

  /**
   * Find branches by conversation
   */
  async findByConversation(conversationId: string): Promise<Branch[]> {
    return await this.findBy('conversation_id', conversationId);
  }

  /**
   * Find child branches
   */
  async findChildren(parentBranchId: string): Promise<Branch[]> {
    return await this.findBy('parent_branch_id', parentBranchId);
  }

  /**
   * Find root branches (no parent)
   */
  async findRoots(conversationId: string): Promise<Branch[]> {
    try {
      const sql = `
        SELECT * FROM ${this.tableName} 
        WHERE conversation_id = ? AND parent_branch_id IS NULL 
        ORDER BY created_at ASC
      `;
      const result = await this.executeQuery(sql, [conversationId]);
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find root branches: ${error}`);
    }
  }

  /**
   * Get branch with full hierarchy information
   */
  async findWithHierarchy(id: string): Promise<BranchWithHierarchy> {
    try {
      const branch = await this.findById(id);
      
      // Get parent branch
      const parentBranch = branch.parentBranchId 
        ? await this.findById(branch.parentBranchId)
        : undefined;

      // Get child branches
      const childBranches = await this.findChildren(id);

      // Calculate depth and path
      const { depth, path } = await this.calculateBranchPath(id);

      // Get message count
      const messageCountSql = `SELECT COUNT(*) as count FROM messages WHERE branch_id = ?`;
      const messageCountResult = await this.executeQuery(messageCountSql, [id]);
      const messageCount = messageCountResult.rows[0].count;

      // Get last activity
      const lastActivitySql = `
        SELECT MAX(created_at) as last_activity 
        FROM messages 
        WHERE branch_id = ?
      `;
      const lastActivityResult = await this.executeQuery(lastActivitySql, [id]);
      const lastActivity = lastActivityResult.rows[0].last_activity 
        ? this.parseDate(lastActivityResult.rows[0].last_activity)
        : branch.createdAt;

      return {
        ...branch,
        parentBranch,
        childBranches,
        depth,
        path,
        messageCount,
        lastActivity
      };
    } catch (error) {
      throw new Error(`Failed to find branch with hierarchy: ${error}`);
    }
  }

  /**
   * Calculate branch depth and path from root
   */
  private async calculateBranchPath(branchId: string): Promise<{ depth: number; path: string[] }> {
    const path: string[] = [];
    let currentId = branchId;
    let depth = 0;

    while (currentId) {
      path.unshift(currentId);
      
      const sql = `SELECT parent_branch_id FROM ${this.tableName} WHERE id = ?`;
      const result = await this.executeQuery(sql, [currentId]);
      
      if (result.rows.length === 0) break;
      
      currentId = result.rows[0].parent_branch_id;
      depth++;
    }

    return { depth, path };
  }

  /**
   * Get branch tree for visualization
   */
  async getBranchTree(conversationId: string): Promise<BranchTreeNode[]> {
    try {
      // Get all branches for the conversation
      const branches = await this.findByConversation(conversationId);
      
      // Build tree structure
      const nodeMap = new Map<string, BranchTreeNode>();
      const rootNodes: BranchTreeNode[] = [];

      // Create nodes
      for (const branch of branches) {
        const messageCountSql = `SELECT COUNT(*) as count FROM messages WHERE branch_id = ?`;
        const messageCountResult = await this.executeQuery(messageCountSql, [branch.id]);
        const messageCount = messageCountResult.rows[0].count;

        const lastActivitySql = `SELECT MAX(created_at) as last_activity FROM messages WHERE branch_id = ?`;
        const lastActivityResult = await this.executeQuery(lastActivitySql, [branch.id]);
        const lastActivity = lastActivityResult.rows[0].last_activity 
          ? this.parseDate(lastActivityResult.rows[0].last_activity)
          : branch.createdAt;

        const node: BranchTreeNode = {
          id: branch.id,
          name: branch.name,
          model: branch.model,
          parentId: branch.parentBranchId,
          children: [],
          position: { x: 0, y: 0 }, // Will be calculated by visualization
          metadata: {
            messageCount,
            lastActivity,
            isActive: false, // Will be set by client
            depth: 0 // Will be calculated
          }
        };

        nodeMap.set(branch.id, node);
      }

      // Build hierarchy and calculate positions
      for (const node of nodeMap.values()) {
        if (node.parentId) {
          const parent = nodeMap.get(node.parentId);
          if (parent) {
            parent.children.push(node);
            node.metadata.depth = parent.metadata.depth + 1;
          }
        } else {
          rootNodes.push(node);
        }
      }

      return rootNodes;
    } catch (error) {
      throw new Error(`Failed to get branch tree: ${error}`);
    }
  }

  /**
   * Search branches by context similarity
   */
  async searchByContext(
    embedding: number[], 
    conversationId?: string, 
    limit = 20, 
    threshold = 0.3
  ): Promise<VectorSearchResult[]> {
    const filters = conversationId ? { conversation_id: conversationId } : {};
    
    return await tidbClient.vectorSearch(
      embedding,
      this.tableName,
      'context_embedding',
      'context_summary',
      filters,
      limit,
      threshold
    );
  }

  /**
   * Get branch statistics
   */
  async getStatistics(conversationId?: string): Promise<BranchStatistics> {
    try {
      const whereClause = conversationId ? 'WHERE conversation_id = ?' : '';
      const params = conversationId ? [conversationId] : [];

      // Basic statistics
      const basicStatsSql = `
        SELECT 
          COUNT(*) as total_branches,
          AVG(depth_calc.depth) as average_depth,
          MAX(depth_calc.depth) as max_depth
        FROM (
          SELECT 
            id,
            (SELECT COUNT(*) FROM branches b2 WHERE b2.id = b1.parent_branch_id OR b2.parent_branch_id = b1.id) as depth
          FROM branches b1
          ${whereClause}
        ) as depth_calc
      `;

      const basicStatsResult = await this.executeQuery(basicStatsSql, params);
      const basicStats = basicStatsResult.rows[0];

      // Model distribution
      const modelDistSql = `
        SELECT model, COUNT(*) as count 
        FROM ${this.tableName} 
        ${whereClause}
        GROUP BY model
      `;
      
      const modelDistResult = await this.executeQuery(modelDistSql, params);
      const modelDistribution = modelDistResult.rows.reduce((acc, row) => {
        acc[row.model as AIModel] = row.count;
        return acc;
      }, {} as Record<AIModel, number>);

      // Activity metrics
      const activitySql = `
        SELECT 
          COUNT(CASE WHEN created_at >= CURDATE() THEN 1 END) as branches_today,
          COUNT(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as branches_this_week
        FROM ${this.tableName}
        ${whereClause}
      `;

      const activityResult = await this.executeQuery(activitySql, params);
      const activity = activityResult.rows[0];

      // Most active branch
      const mostActiveSql = `
        SELECT 
          b.id,
          COUNT(m.id) as message_count
        FROM ${this.tableName} b
        LEFT JOIN messages m ON b.id = m.branch_id
        ${whereClause}
        GROUP BY b.id
        ORDER BY message_count DESC
        LIMIT 1
      `;

      const mostActiveResult = await this.executeQuery(mostActiveSql, params);
      const mostActiveBranch = mostActiveResult.rows.length > 0 ? {
        branchId: mostActiveResult.rows[0].id,
        messageCount: mostActiveResult.rows[0].message_count
      } : { branchId: '', messageCount: 0 };

      return {
        totalBranches: basicStats.total_branches,
        averageDepth: Math.round(basicStats.average_depth || 0),
        maxDepth: basicStats.max_depth || 0,
        modelDistribution,
        branchingPatterns: {
          mostBranchedMessages: [], // Would need more complex query
          averageBranchesPerMessage: 0 // Would need more complex query
        },
        activityMetrics: {
          branchesCreatedToday: activity.branches_today,
          branchesCreatedThisWeek: activity.branches_this_week,
          mostActiveBranch
        }
      };
    } catch (error) {
      throw new Error(`Failed to get branch statistics: ${error}`);
    }
  }

  /**
   * Find branches by model
   */
  async findByModel(model: AIModel, conversationId?: string): Promise<Branch[]> {
    try {
      const whereClause = conversationId 
        ? 'WHERE model = ? AND conversation_id = ?'
        : 'WHERE model = ?';
      const params = conversationId ? [model, conversationId] : [model];

      const sql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY created_at DESC`;
      const result = await this.executeQuery(sql, params);
      
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find branches by model: ${error}`);
    }
  }

  /**
   * Get branch path from root to specified branch
   */
  async getBranchPath(branchId: string): Promise<Branch[]> {
    try {
      const { path } = await this.calculateBranchPath(branchId);
      const branches: Branch[] = [];

      for (const id of path) {
        const branch = await this.findById(id);
        branches.push(branch);
      }

      return branches;
    } catch (error) {
      throw new Error(`Failed to get branch path: ${error}`);
    }
  }
}