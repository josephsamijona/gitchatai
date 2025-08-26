'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Message } from '@/components/chat/Message/Message';
import { UserMessage } from '@/components/chat/Message/UserMessage';
import { AssistantMessage } from '@/components/chat/Message/AssistantMessage';
import { MessageActions } from '@/components/chat/Message/MessageActions';
import { MessageBranch } from '@/components/chat/Message/MessageBranch';
import { EmptyState } from '@/components/shared/EmptyState';
import { AIModel, Message as MessageType, Branch } from '@/types';
import { messageVariants, staggeredMessageVariants } from '@/animations/variants/message';
import { useMessageAnimation } from '@/animations/hooks/useMessageAnimation';
import { useBranchAnimation } from '@/animations/hooks/useBranchAnimation';
import { useScrollAnimation } from '@/animations/hooks/useScrollAnimation';
import { formatDistanceToNow } from 'date-fns';

interface MessageListProps {
  messages: MessageType[];
  streamingMessage?: Partial<MessageType> | null;
  selectedMessage?: string | null;
  onMessageSelect: (messageId: string | null) => void;
  onCreateBranch: (messageId: string, model?: AIModel) => Promise<Branch>;
  onContextSearch: (query: string) => void;
  currentModel: AIModel;
  branchId: string;
  projectId?: string;
  className?: string;
}

export function MessageList({
  messages,
  streamingMessage,
  selectedMessage,
  onMessageSelect,
  onCreateBranch,
  onContextSearch,
  currentModel,
  branchId,
  projectId,
  className = ''
}: MessageListProps) {
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [branchingMessage, setBranchingMessage] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  
  const listRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Animation hooks
  const { getMessageAnimation, triggerMessageAnimation } = useMessageAnimation();
  const { getBranchAnimation, triggerBranchAnimation } = useBranchAnimation();
  const { scrollToMessage, scrollToBottom } = useScrollAnimation(listRef);

  // Handle message expansion
  const handleToggleExpanded = useCallback((messageId: string) => {
    setExpandedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }, []);

  // Handle branch creation with animation
  const handleCreateBranch = useCallback(async (messageId: string, model?: AIModel) => {
    setBranchingMessage(messageId);
    triggerBranchAnimation(messageId);
    
    try {
      const newBranch = await onCreateBranch(messageId, model);
      
      // Animate successful branch creation
      setTimeout(() => {
        setBranchingMessage(null);
        triggerMessageAnimation(messageId, 'branch-created');
      }, 500);
      
      return newBranch;
    } catch (error) {
      setBranchingMessage(null);
      throw error;
    }
  }, [onCreateBranch, triggerBranchAnimation, triggerMessageAnimation]);

  // Handle message selection
  const handleMessageClick = useCallback((messageId: string) => {
    if (selectedMessage === messageId) {
      onMessageSelect(null);
    } else {
      onMessageSelect(messageId);
      scrollToMessage(messageId);
    }
  }, [selectedMessage, onMessageSelect, scrollToMessage]);

  // Handle context search from message
  const handleContextSearch = useCallback((content: string) => {
    // Extract key terms for context search
    const searchQuery = content.length > 100 
      ? content.substring(0, 100) + '...' 
      : content;
    onContextSearch(searchQuery);
  }, [onContextSearch]);

  // Get message component based on role
  const renderMessage = useCallback((message: MessageType, index: number) => {
    const isSelected = selectedMessage === message.id;
    const isExpanded = expandedMessages.has(message.id);
    const isHovered = hoveredMessage === message.id;
    const isBranching = branchingMessage === message.id;
    const isLast = index === messages.length - 1;
    
    const messageProps = {
      message,
      isSelected,
      isExpanded,
      isHovered,
      isBranching,
      isLast,
      onToggleExpanded: () => handleToggleExpanded(message.id),
      onCreateBranch: (model?: AIModel) => handleCreateBranch(message.id, model),
      onContextSearch: () => handleContextSearch(message.content),
      onSelect: () => handleMessageClick(message.id),
      currentModel,
      branchId,
      projectId
    };

    // Register message ref for scrolling
    const setMessageRef = (el: HTMLDivElement | null) => {
      if (el) {
        messageRefs.current.set(message.id, el);
      }
    };

    return (
      <motion.div
        key={message.id}
        ref={setMessageRef}
        className="message-container"
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        layout
        onHoverStart={() => setHoveredMessage(message.id)}
        onHoverEnd={() => setHoveredMessage(null)}
        {...getMessageAnimation(message.id)}
      >
        {message.role === 'user' ? (
          <UserMessage {...messageProps} />
        ) : (
          <AssistantMessage {...messageProps} />
        )}
        
        {/* Branch indicator for messages that can be branched */}
        {isHovered && !isBranching && (
          <MessageBranch
            messageId={message.id}
            onCreateBranch={handleCreateBranch}
            availableModels={['claude', 'gpt4', 'kimi', 'grok']}
            currentModel={currentModel}
            {...getBranchAnimation(message.id)}
          />
        )}
        
        {/* Message actions */}
        {isSelected && (
          <MessageActions
            message={message}
            onCreateBranch={(model) => handleCreateBranch(message.id, model)}
            onContextSearch={() => handleContextSearch(message.content)}
            onCopy={() => navigator.clipboard.writeText(message.content)}
            onShare={() => {
              // Handle message sharing
              const shareUrl = `${window.location.origin}/chat/${message.conversationId}/branch/${branchId}?message=${message.id}`;
              navigator.clipboard.writeText(shareUrl);
            }}
          />
        )}
      </motion.div>
    );
  }, [
    selectedMessage,
    expandedMessages,
    hoveredMessage,
    branchingMessage,
    currentModel,
    branchId,
    projectId,
    handleToggleExpanded,
    handleCreateBranch,
    handleContextSearch,
    handleMessageClick,
    getMessageAnimation,
    getBranchAnimation
  ]);

  // Render streaming message
  const renderStreamingMessage = useCallback(() => {
    if (!streamingMessage) return null;

    return (
      <motion.div
        key="streaming-message"
        className="message-container streaming"
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <AssistantMessage
          message={streamingMessage as MessageType}
          isSelected={false}
          isExpanded={false}
          isHovered={false}
          isBranching={false}
          isLast={true}
          isStreaming={true}
          onToggleExpanded={() => {}}
          onCreateBranch={() => Promise.resolve({} as Branch)}
          onContextSearch={() => {}}
          onSelect={() => {}}
          currentModel={currentModel}
          branchId={branchId}
          projectId={projectId}
        />
      </motion.div>
    );
  }, [streamingMessage, currentModel, branchId, projectId]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && !selectedMessage) {
        scrollToBottom();
      }
    }
  }, [messages, selectedMessage, scrollToBottom]);

  // Empty state
  if (messages.length === 0 && !streamingMessage) {
    return (
      <div className={`flex-1 flex items-center justify-center p-8 ${className}`}>
        <EmptyState
          title="Start a conversation"
          description={`Begin chatting with ${currentModel}${projectId ? ' in this workspace' : ''}. You can switch models, create branches, and search for context at any time.`}
          icon="=¬"
          action={{
            label: "See example prompts",
            onClick: () => {
              onContextSearch("example conversation starters");
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto ${className}`}>
      <div ref={listRef} className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Conversation metadata */}
        <div className="text-center text-sm text-gray-500 py-4 border-b border-gray-200 dark:border-gray-700">
          <p>
            Conversation in <span className="font-medium">{branchId}</span>
            {projectId && <span> " Workspace: {projectId}</span>}
          </p>
          <p>Using {currentModel} " {messages.length} messages</p>
        </div>

        {/* Messages */}
        <AnimatePresence mode="popLayout">
          <motion.div
            className="space-y-6"
            variants={staggeredMessageVariants}
            initial="initial"
            animate="animate"
          >
            {messages.map((message, index) => renderMessage(message, index))}
            
            {/* Streaming message */}
            {renderStreamingMessage()}
          </motion.div>
        </AnimatePresence>

        {/* Conversation stats */}
        {messages.length > 0 && (
          <div className="text-center text-xs text-gray-400 py-4 border-t border-gray-100 dark:border-gray-800">
            <p>
              Last updated {formatDistanceToNow(new Date(messages[messages.length - 1]?.createdAt || Date.now()), { addSuffix: true })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}