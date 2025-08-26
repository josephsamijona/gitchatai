/**
 * useWebSocket Hook - React hook for WebSocket real-time collaboration
 * Provides real-time updates for branches, documents, knowledge graphs, and conflicts
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { WebSocketMessage, Branch, Document, Concept, ConflictInfo } from '../types';

export interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastMessage: WebSocketMessage | null;
  connectionId: string | null;
  reconnectAttempts: number;
}

export interface WebSocketHookReturn {
  // Connection state
  state: WebSocketState;
  
  // Connection methods
  connect: (projectId: string, userId: string) => void;
  disconnect: () => void;
  
  // Message sending
  sendMessage: (type: string, payload: any) => void;
  
  // Real-time data
  connectedUsers: string[];
  recentUpdates: any[];
  activeConflicts: ConflictInfo[];
  
  // Event handlers (can be set by components)
  onBranchCreated?: (branch: Branch) => void;
  onBranchUpdated?: (branch: Branch) => void;
  onBranchMerged?: (mergeResult: any) => void;
  onDocumentProcessed?: (document: Document, status: string, progress?: number) => void;
  onKnowledgeGraphUpdated?: (graphData: any) => void;
  onConflictDetected?: (conflict: ConflictInfo) => void;
  onConflictResolved?: (conflictId: string) => void;
  onUserPresenceChanged?: (userId: string, status: 'connected' | 'disconnected') => void;
}

export const useWebSocket = (
  projectId?: string,
  userId?: string,
  autoConnect: boolean = true
): WebSocketHookReturn => {
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastMessage: null,
    connectionId: null,
    reconnectAttempts: 0
  });

  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [activeConflicts, setActiveConflicts] = useState<ConflictInfo[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const eventHandlersRef = useRef<Partial<WebSocketHookReturn>>({});

  // Message handlers
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      setState(prev => ({
        ...prev,
        lastMessage: message,
        error: null
      }));

      // Handle different message types
      switch (message.type) {
        case 'connection_established':
          setState(prev => ({
            ...prev,
            connectionId: message.payload.connectionId,
            isConnected: true,
            isConnecting: false,
            reconnectAttempts: 0,
            error: null
          }));
          console.log('WebSocket connection established:', message.payload);
          break;

        case 'user_presence_updated':
          const { userId: presenceUserId, status } = message.payload;
          if (status === 'connected') {
            setConnectedUsers(prev => [...new Set([...prev, presenceUserId])]);
          } else {
            setConnectedUsers(prev => prev.filter(id => id !== presenceUserId));
          }
          eventHandlersRef.current.onUserPresenceChanged?.(presenceUserId, status);
          break;

        case 'branch_created':
          const newBranch = message.payload.branch;
          eventHandlersRef.current.onBranchCreated?.(newBranch);
          addRecentUpdate('Branch created', newBranch, message.timestamp);
          break;

        case 'branch_tree_updated':
          // Handle branch tree synchronization
          console.log('Branch tree updated:', message.payload);
          break;

        case 'branch_merged':
          const mergeResult = message.payload.mergeResult;
          eventHandlersRef.current.onBranchMerged?.(mergeResult);
          addRecentUpdate('Branches merged', mergeResult, message.timestamp);
          break;

        case 'document_processing_update':
          const { documentId, filename, status: docStatus, progress } = message.payload;
          const documentData = { id: documentId, filename } as Document;
          eventHandlersRef.current.onDocumentProcessed?.(documentData, docStatus, progress);
          addRecentUpdate(`Document ${docStatus}`, { filename, progress }, message.timestamp);
          break;

        case 'knowledge_graph_updated':
          const graphData = message.payload.graphData;
          eventHandlersRef.current.onKnowledgeGraphUpdated?.(graphData);
          addRecentUpdate('Knowledge graph updated', graphData.analytics, message.timestamp);
          break;

        case 'conflict_detected':
          const conflict = message.payload.conflict;
          setActiveConflicts(prev => [...prev, conflict]);
          eventHandlersRef.current.onConflictDetected?.(conflict);
          addRecentUpdate('Conflict detected', conflict, message.timestamp);
          break;

        case 'conflict_resolved':
          const resolvedConflictId = message.payload.conflictId;
          setActiveConflicts(prev => prev.filter(c => c.id !== resolvedConflictId));
          eventHandlersRef.current.onConflictResolved?.(resolvedConflictId);
          addRecentUpdate('Conflict resolved', { conflictId: resolvedConflictId }, message.timestamp);
          break;

        case 'ping':
          // Send pong response
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'pong',
              payload: { timestamp: new Date() },
              timestamp: new Date()
            }));
          }
          break;

        case 'pong':
          // Handle pong response (keep connection alive)
          break;

        default:
          console.log('Unhandled WebSocket message:', message);
      }

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      setState(prev => ({
        ...prev,
        error: 'Invalid message received'
      }));
    }
  }, []);

  // Add recent update helper
  const addRecentUpdate = useCallback((title: string, data: any, timestamp: Date) => {
    setRecentUpdates(prev => {
      const update = { id: Date.now().toString(), title, data, timestamp };
      const newUpdates = [update, ...prev];
      return newUpdates.slice(0, 50); // Keep latest 50 updates
    });
  }, []);

  // Connection handlers
  const handleOpen = useCallback(() => {
    setState(prev => ({
      ...prev,
      isConnected: true,
      isConnecting: false,
      reconnectAttempts: 0,
      error: null
    }));

    // Start ping interval
    pingIntervalRef.current = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'ping',
          payload: { timestamp: new Date() },
          timestamp: new Date()
        }));
      }
    }, 30000); // Ping every 30 seconds

    console.log('WebSocket connection opened');
  }, []);

  const handleClose = useCallback(() => {
    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false
    }));

    // Clear ping interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    console.log('WebSocket connection closed');

    // Auto-reconnect if it was an unexpected close
    if (projectId && userId && state.reconnectAttempts < 5) {
      const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
      reconnectTimeoutRef.current = setTimeout(() => {
        setState(prev => ({
          ...prev,
          reconnectAttempts: prev.reconnectAttempts + 1
        }));
        connect(projectId, userId);
      }, delay);
    }
  }, [projectId, userId, state.reconnectAttempts]);

  const handleError = useCallback((event: Event) => {
    console.error('WebSocket error:', event);
    setState(prev => ({
      ...prev,
      error: 'Connection error occurred',
      isConnecting: false
    }));
  }, []);

  // Connect to WebSocket
  const connect = useCallback((projectId: string, userId: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    setState(prev => ({
      ...prev,
      isConnecting: true,
      error: null
    }));

    try {
      // Create WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/websocket/connect?projectId=${projectId}&userId=${userId}`;
      
      const socket = new WebSocket(wsUrl, ['synapse-v1']);
      
      socket.addEventListener('open', handleOpen);
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('close', handleClose);
      socket.addEventListener('error', handleError);

      socketRef.current = socket;

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: 'Failed to create connection'
      }));
    }
  }, [handleOpen, handleMessage, handleClose, handleError]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.removeEventListener('open', handleOpen);
      socketRef.current.removeEventListener('message', handleMessage);
      socketRef.current.removeEventListener('close', handleClose);
      socketRef.current.removeEventListener('error', handleError);
      
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      
      socketRef.current = null;
    }

    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      connectionId: null,
      reconnectAttempts: 0
    }));

    setConnectedUsers([]);
  }, [handleOpen, handleMessage, handleClose, handleError]);

  // Send message
  const sendMessage = useCallback((type: string, payload: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN && projectId && userId) {
      const message: WebSocketMessage = {
        type,
        payload,
        timestamp: new Date(),
        userId,
        projectId
      };

      socketRef.current.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket not connected');
    }
  }, [projectId, userId]);

  // Auto-connect on mount if projectId and userId are provided
  useEffect(() => {
    if (autoConnect && projectId && userId && !state.isConnected && !state.isConnecting) {
      connect(projectId, userId);
    }

    return () => {
      disconnect();
    };
  }, [projectId, userId, autoConnect]);

  // Update event handlers ref
  const setEventHandlers = useCallback((handlers: Partial<WebSocketHookReturn>) => {
    eventHandlersRef.current = { ...eventHandlersRef.current, ...handlers };
  }, []);

  return {
    state,
    connect,
    disconnect,
    sendMessage,
    connectedUsers,
    recentUpdates,
    activeConflicts,
    
    // Allow components to set event handlers
    setEventHandlers
  } as WebSocketHookReturn & { setEventHandlers: (handlers: Partial<WebSocketHookReturn>) => void };
};