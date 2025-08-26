'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Search, Mic, MicOff, Paperclip, Zap, Brain } from 'lucide-react';
import { AIModel } from '@/types';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { ModelSelector } from '../ModelSelection/ModelSelector';
import { slideIn } from '@/animations/transitions/slideIn';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

interface ChatInputProps {
  onSendMessage: (content: string, model?: AIModel) => Promise<void>;
  onContextSearch: (query: string) => void;
  disabled?: boolean;
  currentModel: AIModel;
  placeholder?: string;
  showModelHint?: boolean;
  showVectorSearchHint?: boolean;
  className?: string;
}

export function ChatInput({
  onSendMessage,
  onContextSearch,
  disabled = false,
  currentModel,
  placeholder = 'Type your message...',
  showModelHint = false,
  showVectorSearchHint = false,
  className = ''
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModel | undefined>();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
      
      if (newHeight > 40 && !isExpanded) {
        setIsExpanded(true);
      } else if (newHeight <= 40 && isExpanded) {
        setIsExpanded(false);
      }
    }
  }, [isExpanded]);

  useEffect(() => {
    adjustHeight();
  }, [content, adjustHeight]);

  // Handle sending message
  async function handleSend() {
    if (!content.trim() || disabled) return;

    const messageContent = content.trim();
    const modelToUse = selectedModel || currentModel;

    // Clear input immediately for better UX
    setContent('');
    setSelectedModel(undefined);
    setAttachments([]);
    adjustHeight();

    try {
      await onSendMessage(messageContent, modelToUse);
    } catch (error) {
      // Restore content on error
      setContent(messageContent);
      setSelectedModel(modelToUse !== currentModel ? modelToUse : undefined);
    }
  }

  // Handle keyboard shortcuts
  useKeyboardShortcuts({
    'cmd+enter': handleSend,
    'cmd+k': () => {
      if (content.trim()) {
        onContextSearch(content.trim());
      }
    },
    'cmd+shift+m': () => setShowModelSelector(true),
    'escape': () => {
      setShowModelSelector(false);
      textareaRef.current?.blur();
    }
  });

  // Handle key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Tab' && content.trim()) {
      e.preventDefault();
      onContextSearch(content.trim());
    }
  }, [content, disabled, handleSend, onContextSearch]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  }, []);

  // Handle file attachment
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    
    const newFiles = Array.from(files).filter(file => {
      // Basic file validation
      const maxSize = 10 * 1024 * 1024; // 10MB
      const allowedTypes = ['text/', 'application/pdf', 'image/', 'application/json'];
      
      return file.size <= maxSize && 
             allowedTypes.some(type => file.type.startsWith(type));
    });

    setAttachments(prev => [...prev, ...newFiles].slice(0, 5)); // Max 5 files
  }, []);

  // Handle voice recording (placeholder)
  const handleVoiceRecording = useCallback(() => {
    if (!isRecording) {
      setIsRecording(true);
      // TODO: Implement voice recording
      setTimeout(() => {
        setIsRecording(false);
        // Simulated transcription
        setContent(prev => prev + ' [Voice message transcribed]');
      }, 2000);
    } else {
      setIsRecording(false);
    }
  }, [isRecording]);

  // Remove attachment
  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = content.trim().length > 0 && !disabled;
  const effectiveModel = selectedModel || currentModel;

  return (
    <div className={`relative bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Model selector overlay */}
      <AnimatePresence>
        {showModelSelector && (
          <motion.div
            className="absolute bottom-full left-0 right-0 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-t-lg shadow-lg"
            variants={slideIn}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Choose model for this message
              </span>
              <button
                onClick={() => setShowModelSelector(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                ×
              </button>
            </div>
            <ModelSelector
              currentModel={effectiveModel}
              onModelChange={(model) => {
                setSelectedModel(model !== currentModel ? model : undefined);
                setShowModelSelector(false);
                textareaRef.current?.focus();
              }}
              showPerformanceHint={true}
              compact={true}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachments */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            className="flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600"
            variants={slideIn}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center space-x-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1 text-sm"
              >
                <Paperclip className="w-3 h-3 text-gray-500" />
                <span className="truncate max-w-32">{file.name}</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input area */}
      <div className="flex items-end space-x-3 p-4">
        {/* File attachment button */}
        <Tooltip content="Attach files (PDF, images, text)">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
        </Tooltip>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={`
              w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 
              bg-white dark:bg-gray-700 px-4 py-3 pr-12
              text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400
              focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200
            `}
            style={{ minHeight: '44px' }}
          />

          {/* Model indicator in input */}
          {selectedModel && selectedModel !== currentModel && (
            <motion.div
              className="absolute top-2 right-10 px-2 py-1 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs rounded-md"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {selectedModel}
            </motion.div>
          )}

          {/* Context search hint */}
          {showVectorSearchHint && content.trim().length > 0 && (
            <motion.div
              className="absolute -top-8 left-0 text-xs text-blue-600 dark:text-blue-400"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Press Tab to search for context
            </motion.div>
          )}
        </div>

        {/* Voice recording button */}
        <Tooltip content={isRecording ? "Stop recording" : "Start voice message"}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleVoiceRecording}
            disabled={disabled}
            className={`text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ${
              isRecording ? 'text-red-500 animate-pulse' : ''
            }`}
          >
            {isRecording ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>
        </Tooltip>

        {/* Model selection button */}
        <Tooltip content="Choose AI model for this message (çM)">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelector(!showModelSelector)}
            disabled={disabled}
            className={`text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ${
              selectedModel ? 'text-blue-500' : ''
            }`}
          >
            <Brain className="w-4 h-4" />
          </Button>
        </Tooltip>

        {/* Context search button */}
        <Tooltip content="Search for context (Tab or K)">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => content.trim() && onContextSearch(content.trim())}
            disabled={disabled || !content.trim()}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <Search className="w-4 h-4" />
          </Button>
        </Tooltip>

        {/* Send button */}
        <Tooltip content="Send message (Enter)">
          <Button
            onClick={handleSend}
            disabled={!canSend}
            size="sm"
            className={`
              transition-all duration-200 min-w-10 h-10
              ${canSend 
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl' 
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            <Send className="w-4 h-4" />
          </Button>
        </Tooltip>
      </div>

      {/* Hints */}
      {showModelHint && (
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center space-x-4">
              <span>Current: {currentModel}</span>
              {selectedModel && (
                <span className="text-blue-600 dark:text-blue-400">
                  Next message: {selectedModel}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <span>Enter to send</span>
              <span>Tab for context</span>
              <span>çM for model</span>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.pdf,.jpg,.jpeg,.png,.gif,.json,.md"
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />
    </div>
  );
}