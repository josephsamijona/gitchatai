/**
 * WebSocket Polling API - Fallback for real-time updates via HTTP polling
 * Provides real-time updates through HTTP requests when WebSocket is not available
 */

import { NextRequest } from 'next/server';
import { collaborationService } from '../../../../lib/services/collaboration';
import { realtimeCollaborationService } from '../../../../lib/services/realtime-collaboration';
import { tidbClient } from '../../../../lib/tidb/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const userId = searchParams.get('userId');
    const lastUpdateTime = searchParams.get('lastUpdate');
    const types = searchParams.get('types')?.split(',');

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
      'canCreateBranches'
    );

    if (!hasAccess) {
      return new Response(
        JSON.stringify({ error: 'Access denied to project' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get updates since last poll
    const since = lastUpdateTime ? new Date(lastUpdateTime) : new Date(Date.now() - 5 * 60 * 1000); // Default 5 minutes
    const updates = await getRealtimeUpdates(projectId, since, types);

    // Get current project status
    const connectedUsers = await getConnectedUsers(projectId);
    const activeConflicts = realtimeCollaborationService.getActiveConflicts(projectId);
    const teamActivity = await collaborationService.getTeamActivity(projectId, 10);

    return new Response(
      JSON.stringify({
        success: true,
        polling: true,
        serverTime: new Date(),
        lastUpdate: new Date(),
        updates,
        projectStatus: {
          connectedUsers,
          activeConflicts: activeConflicts.map(conflict => ({
            id: conflict.id,
            type: conflict.type,
            entityId: conflict.entityId,
            severity: conflict.severity,
            userCount: conflict.conflictingUsers.length,
            createdAt: conflict.createdAt
          })),
          recentActivity: teamActivity.slice(0, 5)
        },
        instructions: {
          nextPoll: new Date(Date.now() + 10000), // Poll every 10 seconds
          pollInterval: 10000,
          endpoint: `/api/websocket/poll?projectId=${projectId}&userId=${userId}&lastUpdate=${new Date().toISOString()}`
        }
      }),
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );

  } catch (error) {
    console.error('Polling error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to poll for updates' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, userId, action, data } = body;

    if (!projectId || !userId || !action) {
      return new Response(
        JSON.stringify({ error: 'projectId, userId, and action are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Handle different actions
    let result;
    switch (action) {
      case 'join':
        await collaborationService.connectUserToProject(userId, projectId);
        result = { message: 'User joined project successfully' };
        break;
        
      case 'leave':
        await collaborationService.disconnectUserFromProject(userId, projectId);
        result = { message: 'User left project successfully' };
        break;
        
      case 'activity':
        await collaborationService.trackActivity(userId, projectId, {
          type: data.type || 'user_activity',
          description: data.description || 'User activity',
          metadata: data.metadata || {}
        });
        result = { message: 'Activity tracked successfully' };
        break;
        
      case 'resolve_conflict':
        if (data.conflictId && data.resolution) {
          await realtimeCollaborationService.resolveConflict(data.conflictId, {
            strategy: data.resolution.strategy,
            selectedData: data.resolution.selectedData,
            userId
          });
          result = { message: 'Conflict resolved successfully' };
        } else {
          throw new Error('conflictId and resolution are required for resolve_conflict action');
        }
        break;
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        result,
        timestamp: new Date()
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Polling action error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to execute action' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Get real-time updates from database
 */
async function getRealtimeUpdates(
  projectId: string,
  since: Date,
  types?: string[]
): Promise<any[]> {
  try {
    let query = `
      SELECT * FROM realtime_updates 
      WHERE project_id = ? AND created_at > ?
    `;
    
    const params: any[] = [projectId, since];

    if (types && types.length > 0) {
      query += ` AND type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }

    query += ` ORDER BY created_at DESC LIMIT 50`;

    const result = await tidbClient.executeQuery(query, params);

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      entityId: row.entity_id,
      entityType: row.entity_type,
      data: JSON.parse(row.data),
      userId: row.user_id,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at
    }));

  } catch (error) {
    console.error('Failed to get realtime updates:', error);
    return [];
  }
}

/**
 * Get connected users for project (simulated)
 */
async function getConnectedUsers(projectId: string): Promise<string[]> {
  try {
    // In a real implementation, this would query active connections
    // For now, return recently active team members
    const query = `
      SELECT DISTINCT user_id 
      FROM team_members 
      WHERE project_id = ? AND last_active > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
    `;

    const result = await tidbClient.executeQuery(query, [projectId]);
    return result.rows.map(row => row.user_id);

  } catch (error) {
    console.error('Failed to get connected users:', error);
    return [];
  }
}