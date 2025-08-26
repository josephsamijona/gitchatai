/**
 * WebSocket Broadcast API - Handles message broadcasting for real-time collaboration
 * Used to send real-time updates to all connected users in a project
 */

import { NextRequest } from 'next/server';
import { realtimeCollaborationService } from '../../../../lib/services/realtime-collaboration';
import { collaborationService } from '../../../../lib/services/collaboration';
import { webSocketService } from '../../../../lib/services/websocket';
import type { WebSocketMessage } from '../../../../types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, projectId, userId, payload, excludeUsers = [] } = body;

    if (!type || !projectId || !userId) {
      return new Response(
        JSON.stringify({ error: 'type, projectId, and userId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to project
    const hasAccess = await collaborationService.checkPermission(
      userId,
      projectId,
      'canCreateBranches'
    );

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: 'Access denied to project' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create WebSocket message
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: new Date(),
      userId,
      projectId
    };

    // Broadcast message to project members
    await realtimeCollaborationService.broadcastMessage(
      projectId,
      message,
      excludeUsers
    );

    // Get connection stats for response
    const connectionStats = webSocketService.getConnectionStats();
    const connectedUsers = webSocketService.getProjectUsers(projectId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Message broadcasted successfully',
        broadcastInfo: {
          type,
          projectId,
          recipientCount: connectedUsers.length,
          excludedCount: excludeUsers.length,
          timestamp: new Date()
        },
        connectionStats: {
          totalConnections: connectionStats.totalConnections,
          projectConnections: connectionStats.connectionsPerProject[projectId] || 0
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Broadcast error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to broadcast message' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: 'projectId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get current broadcast status and connected users
    const connectedUsers = webSocketService.getProjectUsers(projectId);
    const connectionStats = webSocketService.getConnectionStats();
    const activeConflicts = realtimeCollaborationService.getActiveConflicts(projectId);

    return new Response(
      JSON.stringify({
        projectId,
        connectedUsers,
        connectionCount: connectedUsers.length,
        activeConflicts: activeConflicts.length,
        broadcastCapability: {
          available: true,
          supportedTypes: [
            'branch_created',
            'branch_updated',
            'branch_merged',
            'document_processing_update',
            'knowledge_graph_updated',
            'conflict_detected',
            'conflict_resolved',
            'user_presence_updated',
            'activity_update'
          ]
        },
        connectionStats: {
          totalConnections: connectionStats.totalConnections,
          activeConnections: connectionStats.activeConnections,
          projectConnections: connectionStats.connectionsPerProject[projectId] || 0
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Broadcast status error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get broadcast status' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}