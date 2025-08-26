/**
 * Collaboration Service - Team collaboration and real-time features
 * Handles team management, real-time updates, notifications, and activity tracking
 */

import { tidbClient } from '../tidb/client';
import { workspaceService } from './workspace';
import type {
  TeamMember,
  CreateTeamMemberInput,
  UpdateTeamMemberInput,
  WorkspaceActivity,
  TeamRole
} from '../../types';

export class CollaborationService {
  private connectedUsers = new Map<string, Set<string>>(); // projectId -> Set<userId>
  private activeNotifications = new Map<string, any[]>(); // userId -> notifications

  /**
   * Add team member to project
   */
  async addTeamMember(input: CreateTeamMemberInput): Promise<TeamMember> {
    try {
      const memberId = this.generateId();
      const now = new Date();

      // Default permissions based on role
      const defaultPermissions = this.getDefaultPermissions(input.role);
      const permissions = { ...defaultPermissions, ...input.permissions };

      const query = `
        INSERT INTO team_members (
          id, project_id, user_id, email, role, permissions, 
          joined_at, last_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // For demo purposes, use email as user_id
      // In production, this would resolve to actual user ID
      const userId = input.email.replace('@', '_').replace('.', '_');

      await tidbClient.executeQuery(query, [
        memberId,
        input.projectId,
        userId,
        input.email,
        input.role,
        JSON.stringify(permissions),
        now,
        now,
        now
      ]);

      const teamMember: TeamMember = {
        id: memberId,
        projectId: input.projectId,
        userId,
        email: input.email,
        role: input.role,
        permissions,
        joinedAt: now,
        lastActive: now
      };

      // Log activity
      await workspaceService.logActivity(
        input.projectId,
        userId,
        'member_added',
        {
          memberEmail: input.email,
          role: input.role,
          permissions
        }
      );

      // Send real-time notification to project members
      await this.notifyProjectMembers(input.projectId, {
        type: 'member_added',
        data: teamMember,
        timestamp: now
      });

      return teamMember;

    } catch (error) {
      console.error('Failed to add team member:', error);
      throw new Error('Failed to add team member');
    }
  }

  /**
   * Get team members for a project
   */
  async getTeamMembers(projectId: string): Promise<TeamMember[]> {
    try {
      const query = `
        SELECT * FROM team_members 
        WHERE project_id = ?
        ORDER BY joined_at ASC
      `;

      const result = await tidbClient.executeQuery(query, [projectId]);

      return result.rows.map(row => ({
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        email: row.email,
        role: row.role,
        permissions: JSON.parse(row.permissions),
        joinedAt: row.joined_at,
        lastActive: row.last_active
      }));

    } catch (error) {
      console.error('Failed to get team members:', error);
      throw new Error('Failed to get team members');
    }
  }

  /**
   * Update team member role and permissions
   */
  async updateTeamMember(
    memberId: string,
    updates: UpdateTeamMemberInput
  ): Promise<TeamMember> {
    try {
      // Get current member data
      const currentMember = await this.getTeamMemberById(memberId);
      if (!currentMember) {
        throw new Error('Team member not found');
      }

      const updatedPermissions = updates.permissions 
        ? { ...currentMember.permissions, ...updates.permissions }
        : currentMember.permissions;

      const query = `
        UPDATE team_members 
        SET role = COALESCE(?, role),
            permissions = ?,
            updated_at = NOW()
        WHERE id = ?
      `;

      await tidbClient.executeQuery(query, [
        updates.role || null,
        JSON.stringify(updatedPermissions),
        memberId
      ]);

      const updatedMember = {
        ...currentMember,
        role: updates.role || currentMember.role,
        permissions: updatedPermissions
      };

      // Log activity
      await workspaceService.logActivity(
        currentMember.projectId,
        currentMember.userId,
        'member_updated',
        {
          memberEmail: currentMember.email,
          oldRole: currentMember.role,
          newRole: updatedMember.role,
          permissionChanges: updates.permissions
        }
      );

      // Notify team about member update
      await this.notifyProjectMembers(currentMember.projectId, {
        type: 'member_updated',
        data: updatedMember,
        timestamp: new Date()
      });

      return updatedMember;

    } catch (error) {
      console.error('Failed to update team member:', error);
      throw new Error('Failed to update team member');
    }
  }

  /**
   * Remove team member from project
   */
  async removeTeamMember(memberId: string): Promise<void> {
    try {
      const member = await this.getTeamMemberById(memberId);
      if (!member) {
        throw new Error('Team member not found');
      }

      const query = `DELETE FROM team_members WHERE id = ?`;
      await tidbClient.executeQuery(query, [memberId]);

      // Log activity
      await workspaceService.logActivity(
        member.projectId,
        member.userId,
        'member_removed',
        {
          memberEmail: member.email,
          role: member.role
        }
      );

      // Notify team about member removal
      await this.notifyProjectMembers(member.projectId, {
        type: 'member_removed',
        data: member,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Failed to remove team member:', error);
      throw new Error('Failed to remove team member');
    }
  }

  /**
   * Check if user has permission for action
   */
  async checkPermission(
    userId: string,
    projectId: string,
    action: keyof TeamMember['permissions']
  ): Promise<boolean> {
    try {
      const query = `
        SELECT permissions FROM team_members 
        WHERE user_id = ? AND project_id = ?
      `;

      const result = await tidbClient.executeQuery(query, [userId, projectId]);
      
      if (result.rows.length === 0) {
        return false; // User is not a team member
      }

      const permissions = JSON.parse(result.rows[0].permissions);
      return permissions[action] === true;

    } catch (error) {
      console.error('Failed to check permission:', error);
      return false;
    }
  }

  /**
   * Register user as connected to project (for real-time features)
   */
  async connectUserToProject(userId: string, projectId: string): Promise<void> {
    if (!this.connectedUsers.has(projectId)) {
      this.connectedUsers.set(projectId, new Set());
    }
    
    this.connectedUsers.get(projectId)!.add(userId);
    
    // Update last active timestamp
    await this.updateLastActive(userId, projectId);
    
    // Notify other team members about user joining
    await this.notifyProjectMembers(projectId, {
      type: 'user_connected',
      data: { userId },
      timestamp: new Date()
    }, [userId]); // Exclude the connecting user from notification
  }

  /**
   * Unregister user from project
   */
  async disconnectUserFromProject(userId: string, projectId: string): Promise<void> {
    const projectUsers = this.connectedUsers.get(projectId);
    if (projectUsers) {
      projectUsers.delete(userId);
      if (projectUsers.size === 0) {
        this.connectedUsers.delete(projectId);
      }
    }

    // Update last active timestamp
    await this.updateLastActive(userId, projectId);

    // Notify other team members about user leaving
    await this.notifyProjectMembers(projectId, {
      type: 'user_disconnected',
      data: { userId },
      timestamp: new Date()
    }, [userId]);
  }

  /**
   * Get currently connected users for a project
   */
  getConnectedUsers(projectId: string): string[] {
    return Array.from(this.connectedUsers.get(projectId) || []);
  }

  /**
   * Track user activity
   */
  async trackActivity(
    userId: string,
    projectId: string,
    activity: {
      type: string;
      description: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      // Log the activity
      await workspaceService.logActivity(
        projectId,
        userId,
        activity.type,
        activity.metadata || {},
        activity.description
      );

      // Broadcast activity to connected team members
      await this.notifyProjectMembers(projectId, {
        type: 'activity',
        data: {
          userId,
          activity: activity.type,
          description: activity.description,
          metadata: activity.metadata
        },
        timestamp: new Date()
      });

      // Update user's last active timestamp
      await this.updateLastActive(userId, projectId);

    } catch (error) {
      console.error('Failed to track activity:', error);
    }
  }

  /**
   * Get recent team activity for a project
   */
  async getTeamActivity(
    projectId: string,
    limit: number = 50,
    userId?: string
  ): Promise<WorkspaceActivity[]> {
    try {
      let query = `
        SELECT wa.*, tm.email as user_email
        FROM workspace_activities wa
        LEFT JOIN team_members tm ON wa.user_id = tm.user_id AND wa.project_id = tm.project_id
        WHERE wa.project_id = ?
      `;

      const params: any[] = [projectId];

      if (userId) {
        query += ` AND wa.user_id = ?`;
        params.push(userId);
      }

      query += ` ORDER BY wa.created_at DESC LIMIT ?`;
      params.push(limit);

      const result = await tidbClient.executeQuery(query, params);

      return result.rows.map(row => ({
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        type: row.type,
        description: row.description,
        metadata: JSON.parse(row.metadata || '{}'),
        createdAt: row.created_at,
        category: this.categorizeActivity(row.type),
        priority: this.getActivityPriority(row.type),
        isRead: false, // TODO: Implement read status tracking
        relatedItems: this.extractRelatedItems(JSON.parse(row.metadata || '{}'))
      }));

    } catch (error) {
      console.error('Failed to get team activity:', error);
      return [];
    }
  }

  /**
   * Send notification to team members
   */
  async sendNotification(
    projectId: string,
    notification: {
      title: string;
      message: string;
      type: 'info' | 'success' | 'warning' | 'error';
      actionUrl?: string;
      metadata?: Record<string, any>;
    },
    excludeUsers: string[] = []
  ): Promise<void> {
    try {
      const teamMembers = await this.getTeamMembers(projectId);
      const targetUsers = teamMembers
        .filter(member => !excludeUsers.includes(member.userId))
        .map(member => member.userId);

      for (const userId of targetUsers) {
        await this.addUserNotification(userId, {
          ...notification,
          projectId,
          timestamp: new Date()
        });
      }

      // Broadcast via WebSocket
      await this.notifyProjectMembers(projectId, {
        type: 'notification',
        data: notification,
        timestamp: new Date()
      }, excludeUsers);

    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId: string, unreadOnly: boolean = false): Promise<any[]> {
    // In a real implementation, this would query a notifications table
    // For now, return from memory
    const userNotifications = this.activeNotifications.get(userId) || [];
    
    return unreadOnly 
      ? userNotifications.filter(n => !n.read)
      : userNotifications;
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    const userNotifications = this.activeNotifications.get(userId) || [];
    const notification = userNotifications.find(n => n.id === notificationId);
    
    if (notification) {
      notification.read = true;
    }
  }

  /**
   * Get team member by ID
   */
  private async getTeamMemberById(memberId: string): Promise<TeamMember | null> {
    try {
      const query = `SELECT * FROM team_members WHERE id = ?`;
      const result = await tidbClient.executeQuery(query, [memberId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        projectId: row.project_id,
        userId: row.user_id,
        email: row.email,
        role: row.role,
        permissions: JSON.parse(row.permissions),
        joinedAt: row.joined_at,
        lastActive: row.last_active
      };

    } catch (error) {
      console.error('Failed to get team member by ID:', error);
      return null;
    }
  }

  /**
   * Get default permissions for role
   */
  private getDefaultPermissions(role: TeamRole): TeamMember['permissions'] {
    switch (role) {
      case 'owner':
        return {
          canCreateBranches: true,
          canUploadDocuments: true,
          canInviteMembers: true,
          canModifyProject: true,
          canDeleteContent: true
        };
      case 'editor':
        return {
          canCreateBranches: true,
          canUploadDocuments: true,
          canInviteMembers: false,
          canModifyProject: false,
          canDeleteContent: false
        };
      case 'viewer':
        return {
          canCreateBranches: false,
          canUploadDocuments: false,
          canInviteMembers: false,
          canModifyProject: false,
          canDeleteContent: false
        };
      default:
        return {
          canCreateBranches: false,
          canUploadDocuments: false,
          canInviteMembers: false,
          canModifyProject: false,
          canDeleteContent: false
        };
    }
  }

  /**
   * Update user's last active timestamp
   */
  private async updateLastActive(userId: string, projectId: string): Promise<void> {
    try {
      const query = `
        UPDATE team_members 
        SET last_active = NOW() 
        WHERE user_id = ? AND project_id = ?
      `;
      
      await tidbClient.executeQuery(query, [userId, projectId]);
    } catch (error) {
      console.error('Failed to update last active:', error);
    }
  }

  /**
   * Notify project members via WebSocket
   */
  private async notifyProjectMembers(
    projectId: string,
    message: any,
    excludeUsers: string[] = []
  ): Promise<void> {
    const connectedUsers = this.getConnectedUsers(projectId)
      .filter(userId => !excludeUsers.includes(userId));

    // In a real implementation, this would use WebSocket connections
    console.log(`Broadcasting to project ${projectId}:`, {
      message,
      targetUsers: connectedUsers,
      excludeUsers
    });

    // This would integrate with WebSocket service:
    // for (const userId of connectedUsers) {
    //   webSocketService.sendToUser(userId, message);
    // }
  }

  /**
   * Add notification to user's queue
   */
  private async addUserNotification(userId: string, notification: any): Promise<void> {
    if (!this.activeNotifications.has(userId)) {
      this.activeNotifications.set(userId, []);
    }

    const userNotifications = this.activeNotifications.get(userId)!;
    
    userNotifications.unshift({
      id: this.generateId(),
      ...notification,
      read: false,
      createdAt: new Date()
    });

    // Keep only latest 100 notifications per user
    if (userNotifications.length > 100) {
      userNotifications.splice(100);
    }
  }

  /**
   * Categorize activity type
   */
  private categorizeActivity(type: string): WorkspaceActivity['category'] {
    if (type.includes('conversation') || type.includes('message') || type.includes('branch')) {
      return 'conversation';
    }
    if (type.includes('document') || type.includes('concept')) {
      return 'document';
    }
    if (type.includes('member') || type.includes('team')) {
      return 'team';
    }
    if (type.includes('system') || type.includes('workspace')) {
      return 'system';
    }
    return 'knowledge';
  }

  /**
   * Get activity priority
   */
  private getActivityPriority(type: string): WorkspaceActivity['priority'] {
    const highPriorityTypes = ['member_added', 'member_removed', 'workspace_created'];
    const mediumPriorityTypes = ['document_uploaded', 'branch_created'];
    
    if (highPriorityTypes.includes(type)) return 'high';
    if (mediumPriorityTypes.includes(type)) return 'medium';
    return 'low';
  }

  /**
   * Extract related items from activity metadata
   */
  private extractRelatedItems(metadata: Record<string, any>): WorkspaceActivity['relatedItems'] {
    const relatedItems: WorkspaceActivity['relatedItems'] = {};
    
    if (metadata.conversationId) relatedItems.conversationId = metadata.conversationId;
    if (metadata.documentId) relatedItems.documentId = metadata.documentId;
    if (metadata.conceptId) relatedItems.conceptId = metadata.conceptId;
    if (metadata.branchId) relatedItems.branchId = metadata.branchId;
    
    return Object.keys(relatedItems).length > 0 ? relatedItems : undefined;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// Export singleton instance
export const collaborationService = new CollaborationService();