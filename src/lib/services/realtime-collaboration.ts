/**
 * Real-time Collaboration Service - Handles real-time features for collaboration
 * Manages branch synchronization, document notifications, knowledge graph updates, and conflict detection
 */

import { webSocketService } from './websocket';
import { branchingService } from './branching';
import { knowledgeGraphService } from './knowledge-graph';
import { documentProcessingService } from './document-processing';
import { collaborationService } from './collaboration';
import { tidbClient } from '../tidb/client';
import type { WebSocketMessage, Branch, Document, Concept } from '../../types';

export interface RealtimeUpdate {
  type: 'branch_created' | 'branch_updated' | 'branch_deleted' | 'branch_merged' |
        'document_uploaded' | 'document_processed' | 'document_updated' |
        'concept_created' | 'concept_updated' | 'graph_updated' |
        'conflict_detected' | 'conflict_resolved' |
        'user_activity' | 'presence_update';
  entityId: string;
  entityType: 'branch' | 'document' | 'concept' | 'user';
  data: any;
  userId: string;
  projectId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ConflictInfo {
  id: string;
  type: 'branch_edit' | 'document_edit' | 'concept_edit';
  entityId: string;
  conflictingUsers: string[];
  conflictData: {
    original: any;
    changes: Array<{
      userId: string;
      timestamp: Date;
      data: any;
    }>;
  };
  severity: 'low' | 'medium' | 'high';
  autoResolvable: boolean;
  projectId: string;
  createdAt: Date;
}

export class RealtimeCollaborationService {
  private activeConflicts = new Map<string, ConflictInfo>();
  private updateQueue = new Map<string, RealtimeUpdate[]>(); // projectId -> updates
  private processingLocks = new Set<string>(); // entityIds being processed

  /**
   * Broadcast message to all project members
   */
  async broadcastMessage(
    projectId: string, 
    message: WebSocketMessage,
    excludeUsers: string[] = []
  ): Promise<void> {
    try {
      // Get connected users for the project
      const connectedUsers = webSocketService.getProjectUsers(projectId);
      const targetUsers = connectedUsers.filter(userId => !excludeUsers.includes(userId));

      if (targetUsers.length === 0) {
        return;
      }

      // Broadcast to all connected users
      for (const userId of targetUsers) {
        await webSocketService.sendToUser(userId, message);
      }

      // Track activity for collaboration service
      await collaborationService.trackActivity(
        message.userId || 'system',
        projectId,
        {
          type: 'realtime_broadcast',
          description: `Broadcasted ${message.type} to ${targetUsers.length} users`,
          metadata: {
            messageType: message.type,
            recipientCount: targetUsers.length,
            excludedUsers: excludeUsers
          }
        }
      );

    } catch (error) {
      console.error('Failed to broadcast message:', error);
    }
  }

  /**
   * Handle branch tree synchronization
   */
  async syncBranchTree(projectId: string, conversationId: string): Promise<void> {
    try {
      // Get updated branch tree data
      const branches = await branchingService.getBranchTree(conversationId);
      const branchStats = await branchingService.getBranchStatistics(conversationId);

      // Broadcast branch tree update
      await this.broadcastMessage(projectId, {
        type: 'branch_tree_updated',
        payload: {
          conversationId,
          branches,
          statistics: branchStats,
          lastUpdated: new Date()
        },
        timestamp: new Date(),
        projectId
      });

      console.log(`Branch tree synchronized for conversation ${conversationId}`);

    } catch (error) {
      console.error('Failed to sync branch tree:', error);
    }
  }

  /**
   * Handle real-time branch creation
   */
  async onBranchCreated(
    projectId: string,
    branch: Branch,
    userId: string
  ): Promise<void> {
    try {
      // Create realtime update
      const update: RealtimeUpdate = {
        type: 'branch_created',
        entityId: branch.id,
        entityType: 'branch',
        data: branch,
        userId,
        projectId,
        timestamp: new Date(),
        metadata: {
          conversationId: branch.conversationId,
          parentBranchId: branch.parentBranchId,
          model: branch.model
        }
      };

      // Broadcast branch creation
      await this.broadcastMessage(projectId, {
        type: 'branch_created',
        payload: {
          branch,
          creator: userId,
          conversation: branch.conversationId
        },
        timestamp: new Date(),
        userId,
        projectId
      }, [userId]); // Exclude creator

      // Sync entire branch tree
      await this.syncBranchTree(projectId, branch.conversationId);

      // Queue update for processing
      await this.queueUpdate(projectId, update);

    } catch (error) {
      console.error('Failed to handle branch creation:', error);
    }
  }

  /**
   * Handle real-time branch merging
   */
  async onBranchMerged(
    projectId: string,
    mergeResult: any,
    userId: string
  ): Promise<void> {
    try {
      const update: RealtimeUpdate = {
        type: 'branch_merged',
        entityId: mergeResult.newBranchId,
        entityType: 'branch',
        data: mergeResult,
        userId,
        projectId,
        timestamp: new Date(),
        metadata: {
          sourceBranches: mergeResult.sourceBranchIds,
          strategy: mergeResult.strategy,
          conflicts: mergeResult.conflicts
        }
      };

      // Broadcast merge completion
      await this.broadcastMessage(projectId, {
        type: 'branch_merged',
        payload: {
          mergeResult,
          merger: userId,
          timestamp: new Date()
        },
        timestamp: new Date(),
        userId,
        projectId
      });

      // Sync branch tree after merge
      await this.syncBranchTree(projectId, mergeResult.conversationId);

      // Remove any conflicts that were resolved
      if (mergeResult.resolvedConflicts) {
        for (const conflictId of mergeResult.resolvedConflicts) {
          this.activeConflicts.delete(conflictId);
        }
      }

      await this.queueUpdate(projectId, update);

    } catch (error) {
      console.error('Failed to handle branch merge:', error);
    }
  }

  /**
   * Handle document processing notifications
   */
  async onDocumentProcessed(
    projectId: string,
    document: Document,
    status: 'uploaded' | 'processing' | 'completed' | 'failed',
    progress?: number
  ): Promise<void> {
    try {
      const update: RealtimeUpdate = {
        type: 'document_processed',
        entityId: document.id,
        entityType: 'document',
        data: {
          document,
          status,
          progress: progress || 0
        },
        userId: document.uploadedBy || 'system',
        projectId,
        timestamp: new Date(),
        metadata: {
          filename: document.filename,
          size: document.metadata?.size,
          type: document.metadata?.type
        }
      };

      // Broadcast document processing update
      await this.broadcastMessage(projectId, {
        type: 'document_processing_update',
        payload: {
          documentId: document.id,
          filename: document.filename,
          status,
          progress: progress || 0,
          timestamp: new Date()
        },
        timestamp: new Date(),
        projectId
      });

      // If document processing completed, trigger knowledge graph update
      if (status === 'completed') {
        await this.onKnowledgeGraphUpdated(projectId, document.id, 'document');
      }

      await this.queueUpdate(projectId, update);

    } catch (error) {
      console.error('Failed to handle document processing:', error);
    }
  }

  /**
   * Handle knowledge graph updates
   */
  async onKnowledgeGraphUpdated(
    projectId: string,
    entityId: string,
    entityType: 'document' | 'conversation' | 'concept'
  ): Promise<void> {
    try {
      // Get updated graph data
      const graphData = await knowledgeGraphService.getProjectGraph(projectId);
      const graphAnalytics = await knowledgeGraphService.getGraphAnalytics(projectId);

      const update: RealtimeUpdate = {
        type: 'graph_updated',
        entityId,
        entityType: 'concept',
        data: {
          conceptCount: graphData.concepts.length,
          relationshipCount: graphData.relationships.length,
          analytics: graphAnalytics,
          updatedAt: new Date()
        },
        userId: 'system',
        projectId,
        timestamp: new Date(),
        metadata: {
          triggerEntity: entityId,
          triggerType: entityType
        }
      };

      // Broadcast knowledge graph update
      await this.broadcastMessage(projectId, {
        type: 'knowledge_graph_updated',
        payload: {
          graphData,
          analytics: graphAnalytics,
          triggerEntity: {
            id: entityId,
            type: entityType
          },
          timestamp: new Date()
        },
        timestamp: new Date(),
        projectId
      });

      await this.queueUpdate(projectId, update);

    } catch (error) {
      console.error('Failed to handle knowledge graph update:', error);
    }
  }

  /**
   * Detect conflicts for concurrent edits
   */
  async detectConflict(
    projectId: string,
    entityType: 'branch' | 'document' | 'concept',
    entityId: string,
    userId: string,
    changeData: any
  ): Promise<ConflictInfo | null> {
    try {
      // Check if entity is currently being edited by another user
      const lockKey = `${entityType}_${entityId}`;
      
      if (this.processingLocks.has(lockKey)) {
        // Get existing conflict or create new one
        let conflict = Array.from(this.activeConflicts.values())
          .find(c => c.entityId === entityId && c.type === `${entityType}_edit`);

        if (!conflict) {
          conflict = {
            id: this.generateConflictId(),
            type: `${entityType}_edit` as ConflictInfo['type'],
            entityId,
            conflictingUsers: [userId],
            conflictData: {
              original: await this.getEntityCurrentState(entityType, entityId),
              changes: [{
                userId,
                timestamp: new Date(),
                data: changeData
              }]
            },
            severity: this.calculateConflictSeverity(entityType, changeData),
            autoResolvable: this.canAutoResolve(entityType, changeData),
            projectId,
            createdAt: new Date()
          };

          this.activeConflicts.set(conflict.id, conflict);
        } else {
          // Add user to existing conflict
          if (!conflict.conflictingUsers.includes(userId)) {
            conflict.conflictingUsers.push(userId);
            conflict.conflictData.changes.push({
              userId,
              timestamp: new Date(),
              data: changeData
            });
          }
        }

        // Broadcast conflict detected
        await this.broadcastMessage(projectId, {
          type: 'conflict_detected',
          payload: {
            conflict,
            message: `Conflict detected: Multiple users editing ${entityType} ${entityId}`
          },
          timestamp: new Date(),
          projectId
        });

        return conflict;
      }

      // Lock entity for processing
      this.processingLocks.add(lockKey);
      
      // Auto-release lock after 30 seconds
      setTimeout(() => {
        this.processingLocks.delete(lockKey);
      }, 30000);

      return null;

    } catch (error) {
      console.error('Failed to detect conflict:', error);
      return null;
    }
  }

  /**
   * Resolve conflict automatically or manually
   */
  async resolveConflict(
    conflictId: string,
    resolution: {
      strategy: 'auto' | 'manual' | 'merge' | 'override';
      selectedData?: any;
      userId?: string;
    }
  ): Promise<void> {
    try {
      const conflict = this.activeConflicts.get(conflictId);
      if (!conflict) {
        throw new Error('Conflict not found');
      }

      let resolvedData: any;

      switch (resolution.strategy) {
        case 'auto':
          resolvedData = await this.performAutoResolution(conflict);
          break;
        case 'manual':
          resolvedData = resolution.selectedData;
          break;
        case 'merge':
          resolvedData = await this.performMergeResolution(conflict);
          break;
        case 'override':
          resolvedData = resolution.selectedData;
          break;
        default:
          throw new Error('Invalid resolution strategy');
      }

      // Apply resolved data
      await this.applyResolution(conflict, resolvedData);

      // Remove conflict
      this.activeConflicts.delete(conflictId);

      // Release processing lock
      const lockKey = `${conflict.entityType}_${conflict.entityId}`;
      this.processingLocks.delete(lockKey);

      // Broadcast conflict resolution
      await this.broadcastMessage(conflict.projectId, {
        type: 'conflict_resolved',
        payload: {
          conflictId,
          strategy: resolution.strategy,
          resolvedBy: resolution.userId || 'system',
          resolvedData,
          timestamp: new Date()
        },
        timestamp: new Date(),
        projectId: conflict.projectId
      });

      console.log(`Conflict ${conflictId} resolved using ${resolution.strategy} strategy`);

    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  }

  /**
   * Get active conflicts for a project
   */
  getActiveConflicts(projectId: string): ConflictInfo[] {
    return Array.from(this.activeConflicts.values())
      .filter(conflict => conflict.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Queue realtime update for processing
   */
  private async queueUpdate(projectId: string, update: RealtimeUpdate): Promise<void> {
    if (!this.updateQueue.has(projectId)) {
      this.updateQueue.set(projectId, []);
    }

    const queue = this.updateQueue.get(projectId)!;
    queue.push(update);

    // Keep only latest 100 updates per project
    if (queue.length > 100) {
      queue.splice(0, queue.length - 100);
    }

    // Store update in database for persistence
    await this.persistUpdate(update);
  }

  /**
   * Persist update to database
   */
  private async persistUpdate(update: RealtimeUpdate): Promise<void> {
    try {
      const query = `
        INSERT INTO realtime_updates (
          id, project_id, type, entity_id, entity_type, 
          data, user_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await tidbClient.executeQuery(query, [
        this.generateUpdateId(),
        update.projectId,
        update.type,
        update.entityId,
        update.entityType,
        JSON.stringify(update.data),
        update.userId,
        JSON.stringify(update.metadata || {}),
        update.timestamp
      ]);

    } catch (error) {
      console.error('Failed to persist realtime update:', error);
    }
  }

  /**
   * Get entity current state
   */
  private async getEntityCurrentState(
    entityType: string,
    entityId: string
  ): Promise<any> {
    try {
      switch (entityType) {
        case 'branch':
          return await branchingService.getBranchById(entityId);
        case 'document':
          return await documentProcessingService.getDocumentById(entityId);
        case 'concept':
          // Implementation would depend on concept service
          return { id: entityId, type: 'concept' };
        default:
          return null;
      }
    } catch (error) {
      console.error('Failed to get entity current state:', error);
      return null;
    }
  }

  /**
   * Calculate conflict severity
   */
  private calculateConflictSeverity(
    entityType: string,
    changeData: any
  ): ConflictInfo['severity'] {
    // Simple severity calculation
    if (entityType === 'branch' && changeData.mergeOperation) {
      return 'high';
    }
    if (entityType === 'document' && changeData.contentChange) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Check if conflict can be auto-resolved
   */
  private canAutoResolve(entityType: string, changeData: any): boolean {
    // Simple auto-resolution rules
    return entityType === 'concept' || 
           (entityType === 'document' && !changeData.contentChange);
  }

  /**
   * Perform automatic conflict resolution
   */
  private async performAutoResolution(conflict: ConflictInfo): Promise<any> {
    // Implement auto-resolution logic based on conflict type
    // For now, use latest change
    const latestChange = conflict.conflictData.changes
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    
    return latestChange.data;
  }

  /**
   * Perform merge resolution
   */
  private async performMergeResolution(conflict: ConflictInfo): Promise<any> {
    // Implement merge logic
    // For now, merge all changes
    const mergedData = { ...conflict.conflictData.original };
    
    for (const change of conflict.conflictData.changes) {
      Object.assign(mergedData, change.data);
    }

    return mergedData;
  }

  /**
   * Apply resolution to entity
   */
  private async applyResolution(conflict: ConflictInfo, resolvedData: any): Promise<void> {
    try {
      switch (conflict.type) {
        case 'branch_edit':
          // Apply branch update
          await branchingService.updateBranchContext(conflict.entityId, resolvedData);
          break;
        case 'document_edit':
          // Apply document update - would need implementation
          console.log('Document update applied:', conflict.entityId, resolvedData);
          break;
        case 'concept_edit':
          // Apply concept update - would need implementation
          console.log('Concept update applied:', conflict.entityId, resolvedData);
          break;
      }
    } catch (error) {
      console.error('Failed to apply conflict resolution:', error);
    }
  }

  /**
   * Generate conflict ID
   */
  private generateConflictId(): string {
    return `conflict_${Math.random().toString(36).substring(2)}_${Date.now().toString(36)}`;
  }

  /**
   * Generate update ID
   */
  private generateUpdateId(): string {
    return `update_${Math.random().toString(36).substring(2)}_${Date.now().toString(36)}`;
  }
}

// Export singleton instance
export const realtimeCollaborationService = new RealtimeCollaborationService();