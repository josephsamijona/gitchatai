'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { VectorSearchOverlay } from './VectorSearchOverlay';
import { MultiStepWorkflow } from './MultiStepWorkflow';
import { TypingIndicator } from './TypingIndicator';
import { ModelSelector } from '../ModelSelection/ModelSelector';
import { useChat } from '@/hooks/useChat';
import { useTiDBVectorSearch } from '@/hooks/useTiDBVectorSearch';
import { usePerformanceMetrics } from '@/hooks/usePerformanceMetrics';
import { useWebSocket } from '@/hooks/useWebSocket';
import { AIModel, Message, Branch } from '@/types';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { TiDBConnectionError } from '@/components/shared/TiDBConnectionError';
import { pageVariants } from '@/animations/variants/page';

interface ChatContainerProps {
  conversationId: string;
  currentBranch: string;
  projectId?: string;
  className?: string;
}

export function ChatContainer({
  conversationId,
  currentBranch,
  projectId,
  className = ''
}: ChatContainerProps) {
  // Core chat state
  const {
    messages,
    isLoading,
    isStreaming,
    streamingMessage,
    currentModel,
    setCurrentModel,
    sendMessage,
    createBranch,
    error: chatError,
    retryConnection
  } = useChat({
    conversationId,
    branchId: currentBranch,
    projectId
  });

  // Vector search for context
  const {
    searchResults,
    isSearching,
    searchSimilar,
    clearSearch,
    searchPerformance
  } = useTiDBVectorSearch({
    projectId,
    conversationId
  });

  // Performance monitoring
  const {
    metrics,
    trackOperation,
    trackUserAction
  } = usePerformanceMetrics();

  // Real-time collaboration
  const {
    isConnected: wsConnected,
    sendMessage: sendWSMessage,
    lastMessage: wsMessage
  } = useWebSocket(`/api/ws/chat/${conversationId}/${currentBranch}`);

  // UI state
  const [showVectorOverlay, setShowVectorOverlay] = useState(false);
  const [showWorkflowOverlay, setShowWorkflowOverlay] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const [contextQuery, setContextQuery] = useState('');

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (messages.length > 0 || streamingMessage) {
      scrollToBottom();
    }
  }, [messages, streamingMessage, scrollToBottom]);

  // Handle real-time WebSocket messages
  useEffect(() => {
    if (wsMessage) {
      try {
        const data = JSON.parse(wsMessage);
        if (data.type === 'message' && data.branchId === currentBranch) {
          // Message handled by useChat hook
        } else if (data.type === 'branch_created') {
          // Handle branch creation notifications
          trackUserAction('branch_notification_received', {
            branchId: data.branchId,
            parentBranch: currentBranch
          });
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [wsMessage, currentBranch, trackUserAction]);

  // Handle message sending with performance tracking
  const handleSendMessage = useCallback(async (content: string, selectedModel?: AIModel) => {
    const startTime = Date.now();
    
    try {
      // Track user action
      trackUserAction('message_sent', {
        model: selectedModel || currentModel,
        branchId: currentBranch,
        conversationId,
        contentLength: content.length
      });

      // Send message through chat hook
      await sendMessage(content, selectedModel);

      // Track successful send
      trackOperation('message_send_success', Date.now() - startTime, {
        model: selectedModel || currentModel,
        branchId: currentBranch
      });

    } catch (error) {
      trackOperation('message_send_error', Date.now() - startTime, {
        error: error instanceof Error ? error.message : 'Unknown error',
        model: selectedModel || currentModel
      });
      throw error;
    }
  }, [sendMessage, currentModel, currentBranch, conversationId, trackUserAction, trackOperation]);

  // Handle branch creation from message
  const handleCreateBranch = useCallback(async (messageId: string, newModel?: AIModel) => {
    const startTime = Date.now();
    
    try {
      trackUserAction('branch_creation_initiated', {
        sourceMessageId: messageId,
        currentBranch,
        newModel: newModel || currentModel
      });

      const newBranch = await createBranch(messageId, newModel);
      
      // Broadcast branch creation to other users
      if (wsConnected) {
        sendWSMessage(JSON.stringify({
          type: 'branch_created',
          branchId: newBranch.id,
          parentBranch: currentBranch,
          sourceMessageId: messageId,
          model: newModel || currentModel,
          timestamp: Date.now()
        }));
      }

      trackOperation('branch_creation_success', Date.now() - startTime, {
        branchId: newBranch.id,
        sourceMessageId: messageId
      });

      return newBranch;
    } catch (error) {
      trackOperation('branch_creation_error', Date.now() - startTime, {
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceMessageId: messageId
      });
      throw error;
    }
  }, [createBranch, currentModel, currentBranch, wsConnected, sendWSMessage, trackUserAction, trackOperation]);

  // Handle context search
  const handleContextSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      clearSearch();
      setShowVectorOverlay(false);
      return;
    }

    setContextQuery(query);
    setShowVectorOverlay(true);
    
    trackUserAction('context_search', {
      query: query.trim(),
      branchId: currentBranch,
      conversationId
    });

    await searchSimilar(query);
  }, [searchSimilar, clearSearch, currentBranch, conversationId, trackUserAction]);

  // Handle model selection
  const handleModelChange = useCallback((model: AIModel) => {
    setCurrentModel(model);
    trackUserAction('model_changed', {
      oldModel: currentModel,
      newModel: model,
      branchId: currentBranch
    });
  }, [setCurrentModel, currentModel, currentBranch, trackUserAction]);

  // Show connection error if TiDB or WebSocket issues
  if (chatError?.includes('TiDB') || chatError?.includes('database')) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <TiDBConnectionError
          error={chatError}
          onRetry={retryConnection}
          showPerformanceMetrics={true}
        />
      </div>
    );
  }

  return (
    <motion.div
      ref={containerRef}
      className={`flex flex-col h-full bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 ${className}`}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header with model selector and performance metrics */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
        <div className="flex items-center space-x-4">
          <ModelSelector
            currentModel={currentModel}
            onModelChange={handleModelChange}
            disabled={isStreaming}
            showPerformanceHint={true}
          />
          
          {/* WebSocket connection status */}
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500">
              {wsConnected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>
        </div>

        {/* Performance metrics display */}
        {metrics && (
          <div className="flex items-center space-x-4 text-xs text-gray-500">
            <span>Vector Search: {searchPerformance?.duration || 0}ms</span>
            <span>Model Response: {metrics.lastResponseTime || 0}ms</span>
            <button
              onClick={() => setShowWorkflowOverlay(true)}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              View Workflow
            </button>
          </div>
        )}
      </div>

      {/* Messages area with vector search overlay */}
      <div className="flex-1 relative overflow-hidden">
        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
          selectedMessage={selectedMessage}
          onMessageSelect={setSelectedMessage}
          onCreateBranch={handleCreateBranch}
          onContextSearch={handleContextSearch}
          currentModel={currentModel}
          branchId={currentBranch}
          projectId={projectId}
        />

        {/* Typing indicator */}
        <AnimatePresence>
          {isStreaming && (
            <TypingIndicator
              model={currentModel}
              isVisible={isStreaming}
            />
          )}
        </AnimatePresence>

        {/* Messages end marker for auto-scroll */}
        <div ref={messagesEndRef} />

        {/* Vector search overlay */}
        <AnimatePresence>
          {showVectorOverlay && (
            <VectorSearchOverlay
              query={contextQuery}
              results={searchResults}
              isLoading={isSearching}
              onClose={() => {
                setShowVectorOverlay(false);
                clearSearch();
              }}
              onResultSelect={(result) => {
                // Handle context selection
                trackUserAction('context_selected', {
                  resultId: result.id,
                  similarity: result.similarity,
                  query: contextQuery
                });
              }}
            />
          )}
        </AnimatePresence>

        {/* Multi-step workflow overlay */}
        <AnimatePresence>
          {showWorkflowOverlay && (
            <MultiStepWorkflow
              conversationId={conversationId}
              branchId={currentBranch}
              onClose={() => setShowWorkflowOverlay(false)}
              showRealTimeMetrics={true}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Chat input */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
        <ChatInput
          onSendMessage={handleSendMessage}
          onContextSearch={handleContextSearch}
          disabled={isLoading || isStreaming}
          currentModel={currentModel}
          placeholder={
            isStreaming 
              ? `${currentModel} is thinking...` 
              : `Message ${currentModel}${projectId ? ' in this workspace' : ''}`
          }
          showModelHint={true}
          showVectorSearchHint={searchResults.length > 0}
        />
      </div>

      {/* Loading spinner overlay */}
      <AnimatePresence>
        {isLoading && !isStreaming && (
          <motion.div
            className="absolute inset-0 bg-black/10 flex items-center justify-center backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <LoadingSpinner size="lg" message="Connecting to AI..." />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}