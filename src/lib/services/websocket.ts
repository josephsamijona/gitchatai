/**
 * WebSocket Service - Real-time communication infrastructure
 * Handles WebSocket connections, message broadcasting, and connection management
 */

import { WebSocketMessage } from '../../types';
import { collaborationService } from './collaboration';

export interface WebSocketConnection {
  id: string;
  userId: string;
  projectId: string;
  socket: WebSocket | any; // Allow for different WebSocket implementations
  connectedAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

export interface ConnectionManager {
  connections: Map<string, WebSocketConnection>;
  projectConnections: Map<string, Set<string>>; // projectId -> connectionIds
  userConnections: Map<string, Set<string>>; // userId -> connectionIds
}

export class WebSocketService {
  private connectionManager: ConnectionManager = {
    connections: new Map(),
    projectConnections: new Map(),
    userConnections: new Map()
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeService();
  }

  /**
   * Initialize WebSocket service
   */
  private initializeService(): void {
    // Start heartbeat monitoring
    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, 30000); // 30 seconds

    // Start connection cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000); // 1 minute

    console.log('WebSocket service initialized');
  }

  /**
   * Add new WebSocket connection
   */
  async addConnection(
    connectionId: string,
    userId: string,
    projectId: string,
    socket: any
  ): Promise<void> {
    try {
      const connection: WebSocketConnection = {
        id: connectionId,
        userId,
        projectId,
        socket,
        connectedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      // Store connection
      this.connectionManager.connections.set(connectionId, connection);

      // Update project connections
      if (!this.connectionManager.projectConnections.has(projectId)) {
        this.connectionManager.projectConnections.set(projectId, new Set());
      }
      this.connectionManager.projectConnections.get(projectId)!.add(connectionId);

      // Update user connections
      if (!this.connectionManager.userConnections.has(userId)) {
        this.connectionManager.userConnections.set(userId, new Set());
      }
      this.connectionManager.userConnections.get(userId)!.add(connectionId);

      // Register user as connected to project
      await collaborationService.connectUserToProject(userId, projectId);

      // Send welcome message
      await this.sendToConnection(connectionId, {
        type: 'connection_established',
        payload: {
          connectionId,
          userId,
          projectId,
          serverTime: new Date(),
          features: {
            branchSync: true,
            documentNotifications: true,
            knowledgeGraphUpdates: true,
            conflictDetection: true,
            presenceTracking: true
          }
        },
        timestamp: new Date(),
        userId,
        projectId
      });

      // Broadcast user connected event
      await this.broadcastToProject(projectId, {
        type: 'user_presence_updated',
        payload: {
          userId,
          status: 'connected',
          connectedAt: new Date()
        },
        timestamp: new Date(),
        userId,
        projectId
      }, [connectionId]); // Exclude the new connection

      console.log(`WebSocket connection added: ${connectionId} (User: ${userId}, Project: ${projectId})`);

    } catch (error) {
      console.error('Failed to add WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Remove WebSocket connection
   */
  async removeConnection(connectionId: string): Promise<void> {
    try {
      const connection = this.connectionManager.connections.get(connectionId);
      if (!connection) {
        return;
      }

      const { userId, projectId } = connection;

      // Remove from connection maps
      this.connectionManager.connections.delete(connectionId);

      // Update project connections
      const projectConnections = this.connectionManager.projectConnections.get(projectId);
      if (projectConnections) {
        projectConnections.delete(connectionId);
        if (projectConnections.size === 0) {
          this.connectionManager.projectConnections.delete(projectId);
        }
      }

      // Update user connections
      const userConnections = this.connectionManager.userConnections.get(userId);
      if (userConnections) {
        userConnections.delete(connectionId);
        if (userConnections.size === 0) {
          this.connectionManager.userConnections.delete(userId);
          
          // User has no more connections - disconnect from project
          await collaborationService.disconnectUserFromProject(userId, projectId);

          // Broadcast user disconnected event
          await this.broadcastToProject(projectId, {
            type: 'user_presence_updated',
            payload: {
              userId,
              status: 'disconnected',
              disconnectedAt: new Date()
            },
            timestamp: new Date(),
            userId,
            projectId
          });
        }
      }

      console.log(`WebSocket connection removed: ${connectionId}`);

    } catch (error) {
      console.error('Failed to remove WebSocket connection:', error);
    }
  }

  /**
   * Send message to specific connection
   */
  async sendToConnection(
    connectionId: string,
    message: WebSocketMessage
  ): Promise<boolean> {
    try {
      const connection = this.connectionManager.connections.get(connectionId);
      if (!connection || !connection.isActive) {
        return false;
      }

      // Update last activity
      connection.lastActivity = new Date();

      // Send message via socket
      if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(JSON.stringify(message));
        return true;
      } else {
        // Connection is not ready, mark as inactive
        connection.isActive = false;
        return false;
      }

    } catch (error) {
      console.error(`Failed to send message to connection ${connectionId}:`, error);
      return false;
    }
  }

  /**
   * Send message to specific user (all their connections)
   */
  async sendToUser(userId: string, message: WebSocketMessage): Promise<number> {
    const userConnections = this.connectionManager.userConnections.get(userId);
    if (!userConnections) {
      return 0;
    }

    let successCount = 0;
    for (const connectionId of userConnections) {
      const success = await this.sendToConnection(connectionId, message);
      if (success) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * Broadcast message to all connections in a project
   */
  async broadcastToProject(
    projectId: string,
    message: WebSocketMessage,
    excludeConnections: string[] = []
  ): Promise<number> {
    const projectConnections = this.connectionManager.projectConnections.get(projectId);
    if (!projectConnections) {
      return 0;
    }

    let successCount = 0;
    for (const connectionId of projectConnections) {
      if (!excludeConnections.includes(connectionId)) {
        const success = await this.sendToConnection(connectionId, message);
        if (success) {
          successCount++;
        }
      }
    }

    return successCount;
  }

  /**
   * Get connected users for a project
   */
  getProjectUsers(projectId: string): string[] {
    const projectConnections = this.connectionManager.projectConnections.get(projectId);
    if (!projectConnections) {
      return [];
    }

    const userIds = new Set<string>();
    for (const connectionId of projectConnections) {
      const connection = this.connectionManager.connections.get(connectionId);
      if (connection && connection.isActive) {
        userIds.add(connection.userId);
      }
    }

    return Array.from(userIds);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    activeConnections: number;
    projectCount: number;
    userCount: number;
    connectionsPerProject: Record<string, number>;
  } {
    const stats = {
      totalConnections: this.connectionManager.connections.size,
      activeConnections: 0,
      projectCount: this.connectionManager.projectConnections.size,
      userCount: this.connectionManager.userConnections.size,
      connectionsPerProject: {} as Record<string, number>
    };

    // Count active connections
    for (const connection of this.connectionManager.connections.values()) {
      if (connection.isActive) {
        stats.activeConnections++;
      }
    }

    // Count connections per project
    for (const [projectId, connections] of this.connectionManager.projectConnections.entries()) {
      stats.connectionsPerProject[projectId] = connections.size;
    }

    return stats;
  }

  /**
   * Perform heartbeat check on all connections
   */
  private async performHeartbeat(): Promise<void> {
    const pingMessage: WebSocketMessage = {
      type: 'ping',
      payload: { timestamp: new Date() },
      timestamp: new Date()
    };

    let pingCount = 0;
    for (const [connectionId, connection] of this.connectionManager.connections.entries()) {
      if (connection.isActive) {
        const success = await this.sendToConnection(connectionId, pingMessage);
        if (success) {
          pingCount++;
        } else {
          // Connection failed, mark as inactive
          connection.isActive = false;
        }
      }
    }

    console.log(`Heartbeat sent to ${pingCount} connections`);
  }

  /**
   * Clean up inactive connections
   */
  private async cleanupInactiveConnections(): Promise<void> {
    const now = new Date();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
    const connectionsToRemove: string[] = [];

    for (const [connectionId, connection] of this.connectionManager.connections.entries()) {
      if (!connection.isActive || 
          (now.getTime() - connection.lastActivity.getTime()) > inactiveThreshold) {
        connectionsToRemove.push(connectionId);
      }
    }

    for (const connectionId of connectionsToRemove) {
      await this.removeConnection(connectionId);
    }

    if (connectionsToRemove.length > 0) {
      console.log(`Cleaned up ${connectionsToRemove.length} inactive connections`);
    }
  }

  /**
   * Shutdown WebSocket service
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all connections
    for (const connection of this.connectionManager.connections.values()) {
      if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.close();
      }
    }

    // Clear connection manager
    this.connectionManager.connections.clear();
    this.connectionManager.projectConnections.clear();
    this.connectionManager.userConnections.clear();

    console.log('WebSocket service shut down');
  }

  /**
   * Generate unique connection ID
   */
  generateConnectionId(): string {
    return `ws_${Math.random().toString(36).substring(2)}_${Date.now().toString(36)}`;
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();