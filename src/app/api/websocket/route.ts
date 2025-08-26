/**
 * WebSocket API Route - Real-time collaboration server
 * Handles WebSocket connections for real-time updates across team members
 */

import { NextRequest } from 'next/server';
import { WebSocketService } from '../../../lib/services/websocket';
import { collaborationService } from '../../../lib/services/collaboration';
import { realtimeCollaborationService } from '../../../lib/services/realtime-collaboration';

const webSocketService = new WebSocketService();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const userId = searchParams.get('userId');

    if (!projectId || !userId) {
      return new Response(
        JSON.stringify({ error: 'projectId and userId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to project
    const hasAccess = await collaborationService.checkPermission(
      userId,
      projectId,
      'canCreateBranches' // Basic permission check
    );

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: 'Access denied to project' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Return WebSocket connection info
    return new Response(
      JSON.stringify({
        message: 'WebSocket connection available',
        endpoint: `/api/websocket/connect?projectId=${projectId}&userId=${userId}`,
        protocols: ['synapse-v1'],
        features: {
          branchSync: true,
          documentNotifications: true,
          knowledgeGraphUpdates: true,
          conflictDetection: true,
          presenceTracking: true
        }
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('WebSocket API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, projectId, userId, payload } = body;

    if (!type || !projectId || !userId) {
      return new Response(
        JSON.stringify({ error: 'type, projectId, and userId are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Handle WebSocket message broadcasting
    await realtimeCollaborationService.broadcastMessage(projectId, {
      type,
      payload,
      timestamp: new Date(),
      userId,
      projectId
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Message broadcasted successfully'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('WebSocket broadcast error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to broadcast message' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}