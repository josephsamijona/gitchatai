/**
 * Branching Service - Git-style conversation branching system
 * Handles branch creation, navigation, merging, and context preservation
 */

import { tidbClient } from '../tidb/client';
import { embeddings } from '../ai/embeddings';
import { workspaceService } from './workspace';
import { BranchRepository } from '../repositories/branch';
import { MessageRepository } from '../repositories/message';
import type {
  Branch,
  CreateBranchInput,
  UpdateBranchInput,
  BranchWithHierarchy,
  BranchTreeNode,
  BranchComparison,
  BranchMergeConfig,
  BranchMergeResult,
  BranchConflict,
  BranchNavigationState,
  BranchStatistics,
  Message,
  AIModel
} from '../../types';

export class BranchingService {
  private branchRepo: BranchRepository;
  private messageRepo: MessageRepository;

  constructor() {
    this.branchRepo = new BranchRepository();
    this.messageRepo = new MessageRepository();
  }

  /**
   * Create a new branch from any message with context preservation
   */
  async createBranchFromMessage(
    messageId: string,
    branchName: string,
    userId: string,
    options: {
      aiModel?: AIModel;
      customContext?: string;
      preserveFullHistory?: boolean;
      customInstructions?: string;
    } = {}
  ): Promise<Branch> {
    try {
      const {
        aiModel = 'claude',
        customContext,
        preserveFullHistory = true,
        customInstructions
      } = options;

      // Get the source message and its branch
      const sourceMessage = await this.messageRepo.getById(messageId);
      if (!sourceMessage) {
        throw new Error('Source message not found');
      }

      const sourceBranch = await this.branchRepo.getById(sourceMessage.branchId);
      if (!sourceBranch) {
        throw new Error('Source branch not found');
      }

      // Build context for the new branch
      const branchContext = await this.buildBranchContext(
        messageId,
        sourceBranch,
        preserveFullHistory
      );

      // Generate context embedding
      const contextText = this.generateContextText(branchContext, customContext);
      const contextEmbedding = await embeddings.generateEmbedding(contextText);

      // Create the new branch
      const newBranch = await this.branchRepo.create({
        conversationId: sourceBranch.conversationId,
        parentBranchId: sourceBranch.id,
        name: branchName,
        model: aiModel,
        contextSummary: contextText,
        branchPoint: messageId,
        customInstructions
      });

      // Store the context embedding
      await this.storeBranchContext(newBranch.id, {
        contextEmbedding,
        branchPoint: messageId,
        preservedMessages: preserveFullHistory ? branchContext.messages.length : 0,
        sourceContext: branchContext,
        customContext
      });

      // Copy context messages to the new branch if preserving full history
      if (preserveFullHistory) {
        await this.copyContextMessages(branchContext.messages, newBranch.id);
      }

      // Log branch creation activity
      await workspaceService.logActivity(
        sourceBranch.conversationId,
        userId,
        'branch_created',
        {
          branchId: newBranch.id,
          branchName,
          sourceBranchId: sourceBranch.id,
          branchPoint: messageId,
          aiModel,
          messagesPreserved: preserveFullHistory ? branchContext.messages.length : 0
        }
      );

      return newBranch;

    } catch (error) {
      console.error('Failed to create branch from message:', error);
      throw new Error('Failed to create branch from message');
    }
  }

  /**
   * Get branch tree structure with hierarchy
   */
  async getBranchTree(conversationId: string): Promise<BranchTreeNode[]> {
    try {
      const branches = await this.branchRepo.getByConversationId(conversationId);
      
      // Build branch hierarchy
      const branchMap = new Map<string, BranchTreeNode>();
      const rootBranches: BranchTreeNode[] = [];

      // First pass: create tree nodes
      for (const branch of branches) {
        const treeNode: BranchTreeNode = {
          id: branch.id,
          name: branch.name,
          model: branch.model,
          parentBranchId: branch.parentBranchId,
          children: [],
          depth: 0,
          messageCount: 0, // Will be filled later
          createdAt: branch.createdAt,
          lastActivity: branch.updatedAt || branch.createdAt,
          isActive: false, // Will be determined by frontend
          branchPoint: branch.branchPoint,
          contextSummary: branch.contextSummary?.substring(0, 100) + '...'
        };

        branchMap.set(branch.id, treeNode);

        if (!branch.parentBranchId) {
          rootBranches.push(treeNode);
        }
      }

      // Second pass: build parent-child relationships and calculate depths
      for (const branch of branches) {
        const treeNode = branchMap.get(branch.id)!;
        
        if (branch.parentBranchId) {
          const parent = branchMap.get(branch.parentBranchId);
          if (parent) {
            parent.children.push(treeNode);
            treeNode.depth = parent.depth + 1;
          }
        }
      }

      // Third pass: get message counts for each branch
      for (const treeNode of branchMap.values()) {
        treeNode.messageCount = await this.getBranchMessageCount(treeNode.id);
        treeNode.lastActivity = await this.getBranchLastActivity(treeNode.id);
      }

      return rootBranches;

    } catch (error) {
      console.error('Failed to get branch tree:', error);
      throw new Error('Failed to get branch tree');
    }
  }

  /**
   * Switch to a different branch with context loading
   */
  async switchToBranch(
    branchId: string,
    userId: string
  ): Promise<{
    branch: Branch;
    messages: Message[];
    context: any;
    navigationState: BranchNavigationState;
  }> {
    try {
      // Get the target branch
      const branch = await this.branchRepo.getById(branchId);
      if (!branch) {
        throw new Error('Branch not found');
      }

      // Get branch messages
      const messages = await this.messageRepo.getByBranchId(branchId, { 
        limit: 100,
        sortBy: 'createdAt',
        sortOrder: 'asc'
      });

      // Get branch context
      const context = await this.getBranchContext(branchId);

      // Build navigation state
      const navigationState = await this.buildNavigationState(branchId);

      // Update user's current branch (in a real app, this would be session-based)
      await this.updateUserCurrentBranch(userId, branchId);

      // Log branch switch activity
      await workspaceService.logActivity(
        branch.conversationId,
        userId,
        'branch_switched',
        {
          branchId,
          branchName: branch.name,
          messageCount: messages.length
        }
      );

      return {
        branch,
        messages,
        context,
        navigationState
      };

    } catch (error) {
      console.error('Failed to switch to branch:', error);
      throw new Error('Failed to switch to branch');
    }
  }

  /**
   * Compare two branches
   */
  async compareBranches(
    branchId1: string,
    branchId2: string
  ): Promise<BranchComparison> {
    try {
      const [branch1, branch2] = await Promise.all([
        this.branchRepo.getById(branchId1),
        this.branchRepo.getById(branchId2)
      ]);

      if (!branch1 || !branch2) {
        throw new Error('One or both branches not found');
      }

      const [messages1, messages2] = await Promise.all([
        this.messageRepo.getByBranchId(branchId1),
        this.messageRepo.getByBranchId(branchId2)
      ]);

      // Find common ancestor
      const commonAncestor = await this.findCommonAncestor(branchId1, branchId2);

      // Calculate differences
      const comparison: BranchComparison = {
        branch1: {
          id: branch1.id,
          name: branch1.name,
          model: branch1.model,
          messageCount: messages1.length,
          lastActivity: branch1.updatedAt || branch1.createdAt
        },
        branch2: {
          id: branch2.id,
          name: branch2.name,
          model: branch2.model,
          messageCount: messages2.length,
          lastActivity: branch2.updatedAt || branch2.createdAt
        },
        commonAncestor,
        differences: {
          addedMessages: this.findAddedMessages(messages1, messages2),
          removedMessages: this.findRemovedMessages(messages1, messages2),
          modifiedMessages: this.findModifiedMessages(messages1, messages2),
          modelChanges: branch1.model !== branch2.model ? {
            from: branch1.model,
            to: branch2.model
          } : undefined
        },
        similarity: await this.calculateBranchSimilarity(messages1, messages2),
        mergeability: await this.assessMergeability(branchId1, branchId2),
        divergencePoint: await this.findDivergencePoint(branchId1, branchId2)
      };

      return comparison;

    } catch (error) {
      console.error('Failed to compare branches:', error);
      throw new Error('Failed to compare branches');
    }
  }

  /**
   * Merge branches with AI-powered conflict resolution
   */
  async mergeBranches(
    targetBranchId: string,
    sourceBranchId: string,
    config: BranchMergeConfig,
    userId: string
  ): Promise<BranchMergeResult> {
    try {
      const mergeId = this.generateId();
      const startTime = new Date();

      // Validate merge feasibility
      const comparison = await this.compareBranches(targetBranchId, sourceBranchId);
      if (!comparison.mergeability.canMerge) {
        throw new Error(`Cannot merge branches: ${comparison.mergeability.reason}`);
      }

      // Get branches and messages
      const [targetBranch, sourceBranch] = await Promise.all([
        this.branchRepo.getById(targetBranchId),
        this.branchRepo.getById(sourceBranchId)
      ]);

      const [targetMessages, sourceMessages] = await Promise.all([
        this.messageRepo.getByBranchId(targetBranchId),
        this.messageRepo.getByBranchId(sourceBranchId)
      ]);

      // Detect conflicts
      const conflicts = await this.detectMergeConflicts(
        targetMessages,
        sourceMessages,
        comparison.commonAncestor
      );

      let resolvedMessages: Message[];
      let conflictResolutions: any[] = [];

      if (conflicts.length > 0 && config.strategy === 'ai_synthesis') {
        // Use AI to resolve conflicts
        const resolution = await this.resolveConflictsWithAI(
          conflicts,
          config.synthesisModel || 'claude',
          config.synthesisInstructions
        );
        resolvedMessages = resolution.messages;
        conflictResolutions = resolution.resolutions;
      } else {
        // Use simple merge strategies
        resolvedMessages = await this.mergeWithoutConflicts(
          targetMessages,
          sourceMessages,
          config.strategy
        );
      }

      // Create merged branch or update target
      let mergedBranchId: string;
      if (config.createNewBranch) {
        const mergedBranch = await this.branchRepo.create({
          conversationId: targetBranch!.conversationId,
          parentBranchId: targetBranchId,
          name: config.mergedBranchName || `Merged: ${sourceBranch!.name} → ${targetBranch!.name}`,
          model: config.preferredModel || targetBranch!.model,
          contextSummary: `Merged branch combining ${targetBranch!.name} and ${sourceBranch!.name}`,
          branchPoint: targetBranchId
        });
        mergedBranchId = mergedBranch.id;
      } else {
        mergedBranchId = targetBranchId;
      }

      // Apply resolved messages to merged branch
      for (const message of resolvedMessages) {
        if (config.createNewBranch) {
          // Copy to new branch
          await this.messageRepo.create({
            branchId: mergedBranchId,
            role: message.role,
            content: message.content,
            model: message.model,
            contextUsed: message.contextUsed,
            metadata: {
              ...message.metadata,
              mergedFrom: [targetBranchId, sourceBranchId]
            }
          });
        }
      }

      const endTime = new Date();
      const result: BranchMergeResult = {
        success: true,
        mergedBranchId,
        conflictsFound: conflicts.length,
        conflictsResolved: conflictResolutions.length,
        strategy: config.strategy,
        mergeTime: endTime.getTime() - startTime.getTime(),
        messagesInResult: resolvedMessages.length,
        conflictResolutions,
        summary: this.generateMergeSummary(
          conflicts.length,
          conflictResolutions.length,
          resolvedMessages.length,
          config.strategy
        )
      };

      // Log merge activity
      await workspaceService.logActivity(
        targetBranch!.conversationId,
        userId,
        'branches_merged',
        {
          mergeId,
          targetBranchId,
          sourceBranchId,
          mergedBranchId,
          strategy: config.strategy,
          conflictsResolved: conflictResolutions.length,
          mergeTime: result.mergeTime
        }
      );

      return result;

    } catch (error) {
      console.error('Failed to merge branches:', error);
      throw new Error(`Failed to merge branches: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get branch statistics and analytics
   */
  async getBranchStatistics(branchId: string): Promise<BranchStatistics> {
    try {
      const branch = await this.branchRepo.getById(branchId);
      if (!branch) {
        throw new Error('Branch not found');
      }

      const messages = await this.messageRepo.getByBranchId(branchId);
      
      // Calculate statistics
      const statistics: BranchStatistics = {
        branchId,
        branchName: branch.name,
        messageCount: messages.length,
        userMessages: messages.filter(m => m.role === 'user').length,
        assistantMessages: messages.filter(m => m.role === 'assistant').length,
        totalTokens: messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0),
        averageMessageLength: messages.length > 0 ? 
          messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length : 0,
        createdAt: branch.createdAt,
        lastActivity: messages.length > 0 ? 
          new Date(Math.max(...messages.map(m => m.createdAt.getTime()))) : branch.createdAt,
        aiModel: branch.model,
        parentBranchId: branch.parentBranchId,
        childBranches: await this.getChildBranchCount(branchId),
        averageResponseTime: this.calculateAverageResponseTime(messages),
        topicDrift: await this.calculateTopicDrift(messages),
        conversationDepth: await this.calculateConversationDepth(branchId),
        contextPreservationScore: await this.calculateContextPreservation(branchId)
      };

      return statistics;

    } catch (error) {
      console.error('Failed to get branch statistics:', error);
      throw new Error('Failed to get branch statistics');
    }
  }

  /**
   * Get visualization data for D3.js frontend
   */
  async getVisualizationData(conversationId: string): Promise<{
    nodes: any[];
    links: any[];
    layout: any;
    metadata: any;
  }> {
    try {
      const branchTree = await this.getBranchTree(conversationId);
      const nodes: any[] = [];
      const links: any[] = [];

      // Convert tree to D3 format
      const processNode = (treeNode: BranchTreeNode, x: number = 0, y: number = 0) => {
        const node = {
          id: treeNode.id,
          name: treeNode.name,
          model: treeNode.model,
          messageCount: treeNode.messageCount,
          depth: treeNode.depth,
          x,
          y,
          fx: null, // Fixed position for root
          fy: null,
          group: this.getModelGroup(treeNode.model),
          radius: Math.max(8, Math.min(20, Math.sqrt(treeNode.messageCount) * 2)),
          color: this.getModelColor(treeNode.model),
          lastActivity: treeNode.lastActivity,
          contextSummary: treeNode.contextSummary,
          branchPoint: treeNode.branchPoint
        };

        nodes.push(node);

        // Process children
        treeNode.children.forEach((child, index) => {
          const childX = x + (index - (treeNode.children.length - 1) / 2) * 100;
          const childY = y + 100;
          
          processNode(child, childX, childY);
          
          links.push({
            source: treeNode.id,
            target: child.id,
            type: 'branch',
            strength: this.calculateLinkStrength(treeNode, child)
          });
        });
      };

      // Process all root branches
      branchTree.forEach((root, index) => {
        processNode(root, index * 200, 0);
      });

      return {
        nodes,
        links,
        layout: {
          type: 'force',
          charge: -300,
          linkDistance: 100,
          centerForce: 0.1
        },
        metadata: {
          totalNodes: nodes.length,
          totalLinks: links.length,
          maxDepth: Math.max(...nodes.map(n => n.depth)),
          models: [...new Set(nodes.map(n => n.model))]
        }
      };

    } catch (error) {
      console.error('Failed to get visualization data:', error);
      throw new Error('Failed to get visualization data');
    }
  }

  // Private helper methods

  private async buildBranchContext(
    messageId: string,
    sourceBranch: Branch,
    preserveFullHistory: boolean
  ): Promise<{ messages: Message[]; contextSummary: string }> {
    const messages = await this.messageRepo.getByBranchId(sourceBranch.id);
    
    // Find the branch point message
    const branchPointIndex = messages.findIndex(m => m.id === messageId);
    
    // Get context messages (up to branch point)
    const contextMessages = preserveFullHistory 
      ? messages.slice(0, branchPointIndex + 1)
      : messages.slice(Math.max(0, branchPointIndex - 10), branchPointIndex + 1);

    const contextSummary = this.generateContextSummary(contextMessages);

    return {
      messages: contextMessages,
      contextSummary
    };
  }

  private generateContextText(context: any, customContext?: string): string {
    let contextText = `Branch context: ${context.contextSummary}`;
    
    if (customContext) {
      contextText += `\nCustom context: ${customContext}`;
    }
    
    return contextText;
  }

  private generateContextSummary(messages: Message[]): string {
    const recentMessages = messages.slice(-5);
    const topics = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content.substring(0, 100))
      .join('; ');
    
    return `Recent discussion: ${topics}`;
  }

  private async storeBranchContext(branchId: string, context: any): Promise<void> {
    const query = `
      INSERT INTO branch_contexts (
        branch_id, context_embedding, branch_point, preserved_messages,
        source_context, custom_context, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;

    await tidbClient.executeQuery(query, [
      branchId,
      JSON.stringify(context.contextEmbedding),
      context.branchPoint,
      context.preservedMessages,
      JSON.stringify(context.sourceContext),
      context.customContext || null
    ]);
  }

  private async copyContextMessages(messages: Message[], newBranchId: string): Promise<void> {
    for (const message of messages) {
      await this.messageRepo.create({
        branchId: newBranchId,
        role: message.role,
        content: message.content,
        model: message.model,
        contextUsed: message.contextUsed,
        metadata: {
          ...message.metadata,
          copiedFromBranch: message.branchId,
          isContextMessage: true
        }
      });
    }
  }

  private async getBranchMessageCount(branchId: string): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM messages WHERE branch_id = ?`;
    const result = await tidbClient.executeQuery(query, [branchId]);
    return result.rows[0]?.count || 0;
  }

  private async getBranchLastActivity(branchId: string): Promise<Date> {
    const query = `
      SELECT MAX(created_at) as last_activity 
      FROM messages 
      WHERE branch_id = ?
    `;
    const result = await tidbClient.executeQuery(query, [branchId]);
    return result.rows[0]?.last_activity || new Date();
  }

  private async getBranchContext(branchId: string): Promise<any> {
    const query = `SELECT * FROM branch_contexts WHERE branch_id = ?`;
    const result = await tidbClient.executeQuery(query, [branchId]);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        contextEmbedding: JSON.parse(row.context_embedding),
        branchPoint: row.branch_point,
        preservedMessages: row.preserved_messages,
        sourceContext: JSON.parse(row.source_context || '{}'),
        customContext: row.custom_context
      };
    }
    
    return null;
  }

  private async buildNavigationState(branchId: string): Promise<BranchNavigationState> {
    const branch = await this.branchRepo.getById(branchId);
    const siblings = branch?.parentBranchId 
      ? await this.branchRepo.findByParentId(branch.parentBranchId)
      : [];
    const children = await this.branchRepo.findByParentId(branchId);

    return {
      currentBranchId: branchId,
      parentBranchId: branch?.parentBranchId || null,
      childBranchIds: children.map(c => c.id),
      siblingBranchIds: siblings.filter(s => s.id !== branchId).map(s => s.id),
      breadcrumb: await this.buildBreadcrumb(branchId),
      canGoBack: !!branch?.parentBranchId,
      canGoForward: children.length > 0
    };
  }

  private async buildBreadcrumb(branchId: string): Promise<{ id: string; name: string }[]> {
    const breadcrumb: { id: string; name: string }[] = [];
    let currentBranchId: string | null = branchId;

    while (currentBranchId) {
      const branch = await this.branchRepo.getById(currentBranchId);
      if (branch) {
        breadcrumb.unshift({ id: branch.id, name: branch.name });
        currentBranchId = branch.parentBranchId;
      } else {
        break;
      }
    }

    return breadcrumb;
  }

  private async updateUserCurrentBranch(userId: string, branchId: string): Promise<void> {
    // In a real implementation, this would update user session/preferences
    console.log(`User ${userId} switched to branch ${branchId}`);
  }

  private async findCommonAncestor(branchId1: string, branchId2: string): Promise<string | null> {
    const ancestors1 = await this.getBranchAncestors(branchId1);
    const ancestors2 = await this.getBranchAncestors(branchId2);

    for (const ancestor1 of ancestors1) {
      if (ancestors2.includes(ancestor1)) {
        return ancestor1;
      }
    }

    return null;
  }

  private async getBranchAncestors(branchId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let currentId: string | null = branchId;

    while (currentId) {
      ancestors.push(currentId);
      const branch = await this.branchRepo.getById(currentId);
      currentId = branch?.parentBranchId || null;
    }

    return ancestors;
  }

  private findAddedMessages(messages1: Message[], messages2: Message[]): Message[] {
    const ids1 = new Set(messages1.map(m => m.id));
    return messages2.filter(m => !ids1.has(m.id));
  }

  private findRemovedMessages(messages1: Message[], messages2: Message[]): Message[] {
    const ids2 = new Set(messages2.map(m => m.id));
    return messages1.filter(m => !ids2.has(m.id));
  }

  private findModifiedMessages(messages1: Message[], messages2: Message[]): Array<{ 
    original: Message; 
    modified: Message; 
  }> {
    const modifications: Array<{ original: Message; modified: Message }> = [];
    
    for (const msg1 of messages1) {
      const msg2 = messages2.find(m => m.id === msg1.id);
      if (msg2 && msg1.content !== msg2.content) {
        modifications.push({ original: msg1, modified: msg2 });
      }
    }
    
    return modifications;
  }

  private async calculateBranchSimilarity(messages1: Message[], messages2: Message[]): Promise<number> {
    if (messages1.length === 0 && messages2.length === 0) return 1.0;
    if (messages1.length === 0 || messages2.length === 0) return 0.0;

    // Simple similarity based on common messages
    const ids1 = new Set(messages1.map(m => m.id));
    const ids2 = new Set(messages2.map(m => m.id));
    const intersection = new Set([...ids1].filter(id => ids2.has(id)));
    
    return intersection.size / Math.max(ids1.size, ids2.size);
  }

  private async assessMergeability(branchId1: string, branchId2: string): Promise<{
    canMerge: boolean;
    reason?: string;
    complexity: 'simple' | 'moderate' | 'complex';
  }> {
    const comparison = await this.compareBranches(branchId1, branchId2);
    
    // Simple heuristics for mergeability
    const hasConflicts = comparison.differences.modifiedMessages.length > 0;
    const hasDifferentModels = !!comparison.differences.modelChanges;
    const messageDiff = Math.abs(
      comparison.branch1.messageCount - comparison.branch2.messageCount
    );

    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    let canMerge = true;
    let reason: string | undefined;

    if (hasConflicts) {
      complexity = 'complex';
    } else if (hasDifferentModels || messageDiff > 10) {
      complexity = 'moderate';
    }

    return { canMerge, reason, complexity };
  }

  private async findDivergencePoint(branchId1: string, branchId2: string): Promise<string | null> {
    const commonAncestor = await this.findCommonAncestor(branchId1, branchId2);
    return commonAncestor;
  }

  private async detectMergeConflicts(
    targetMessages: Message[],
    sourceMessages: Message[],
    commonAncestorId: string | null
  ): Promise<BranchConflict[]> {
    const conflicts: BranchConflict[] = [];
    
    // Find modified messages that conflict
    const modifiedMessages = this.findModifiedMessages(targetMessages, sourceMessages);
    
    for (const { original, modified } of modifiedMessages) {
      conflicts.push({
        type: 'content_conflict',
        messageId: original.id,
        targetContent: original.content,
        sourceContent: modified.content,
        conflictReason: 'Message content differs between branches',
        resolution: 'ai_synthesis'
      });
    }

    return conflicts;
  }

  private async resolveConflictsWithAI(
    conflicts: BranchConflict[],
    model: AIModel,
    instructions?: string
  ): Promise<{ messages: Message[]; resolutions: any[] }> {
    // This would use AI to resolve conflicts
    // For now, return a simple merge
    return {
      messages: [],
      resolutions: conflicts.map(conflict => ({
        conflictId: conflict.messageId,
        resolution: conflict.resolution,
        resolvedContent: conflict.targetContent // Simple resolution
      }))
    };
  }

  private async mergeWithoutConflicts(
    targetMessages: Message[],
    sourceMessages: Message[],
    strategy: BranchMergeConfig['strategy']
  ): Promise<Message[]> {
    switch (strategy) {
      case 'chronological':
        return [...targetMessages, ...sourceMessages].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
      case 'manual':
        return targetMessages; // Keep target unchanged
      default:
        return targetMessages;
    }
  }

  private generateMergeSummary(
    conflictsFound: number,
    conflictsResolved: number,
    messagesInResult: number,
    strategy: string
  ): string {
    return `Merge completed using ${strategy} strategy. ` +
           `Found ${conflictsFound} conflicts, resolved ${conflictsResolved}. ` +
           `Result contains ${messagesInResult} messages.`;
  }

  private async getChildBranchCount(branchId: string): Promise<number> {
    const children = await this.branchRepo.findByParentId(branchId);
    return children.length;
  }

  private calculateAverageResponseTime(messages: Message[]): number {
    const responseTimes = messages
      .filter(m => m.processingTime && m.processingTime > 0)
      .map(m => m.processingTime!);
    
    return responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      : 0;
  }

  private async calculateTopicDrift(messages: Message[]): Promise<number> {
    // Simple topic drift calculation based on message similarity
    if (messages.length < 2) return 0;
    
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    
    // In a real implementation, this would use embeddings to calculate semantic drift
    const similarity = firstMessage.content.length > 0 && lastMessage.content.length > 0 
      ? this.calculateTextSimilarity(firstMessage.content, lastMessage.content)
      : 1;
    
    return 1 - similarity;
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple word overlap similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    
    return intersection.size / Math.max(words1.size, words2.size);
  }

  private async calculateConversationDepth(branchId: string): Promise<number> {
    const messages = await this.messageRepo.getByBranchId(branchId);
    return Math.floor(messages.length / 2); // User-assistant pairs
  }

  private async calculateContextPreservation(branchId: string): Promise<number> {
    // In a real implementation, this would analyze how well context is preserved
    return 0.85; // Placeholder score
  }

  private getModelGroup(model: AIModel): number {
    const groups = { claude: 1, gpt4: 2, kimi: 3, grok: 4 };
    return groups[model] || 0;
  }

  private getModelColor(model: AIModel): string {
    const colors = {
      claude: '#3b82f6', // blue
      gpt4: '#10b981',   // green
      kimi: '#ef4444',   // red
      grok: '#8b5cf6'    // purple
    };
    return colors[model] || '#6b7280';
  }

  private calculateLinkStrength(parent: BranchTreeNode, child: BranchTreeNode): number {
    // Stronger links for more similar branches
    const messageDiff = Math.abs(parent.messageCount - child.messageCount);
    return Math.max(0.1, 1 - (messageDiff / 20));
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// Export singleton instance
export const branchingService = new BranchingService();