'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Clock, MessageSquare, FileText, Brain, Zap, ArrowRight } from 'lucide-react';
import { SearchResult, VectorSearchResult } from '@/types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { slideIn } from '@/animations/transitions/slideIn';
import { stagger } from '@/animations/transitions/stagger';
import { formatDistanceToNow } from 'date-fns';

interface VectorSearchOverlayProps {
  query: string;
  results: VectorSearchResult[];
  isLoading: boolean;
  onClose: () => void;
  onResultSelect: (result: VectorSearchResult) => void;
  className?: string;
}

export function VectorSearchOverlay({
  query,
  results,
  isLoading,
  onClose,
  onResultSelect,
  className = ''
}: VectorSearchOverlayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(results.length - 1, prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            onResultSelect(results[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, onClose, onResultSelect]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Get icon for result type
  const getResultIcon = (type: string) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="w-4 h-4" />;
      case 'document':
        return <FileText className="w-4 h-4" />;
      case 'concept':
        return <Brain className="w-4 h-4" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  // Get similarity color
  const getSimilarityColor = (similarity: number) => {
    if (similarity >= 0.8) return 'text-green-600 bg-green-50 border-green-200';
    if (similarity >= 0.6) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  // Highlight query terms in text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const queryTerms = query.trim().toLowerCase().split(/\s+/);
    let highlightedText = text;
    
    queryTerms.forEach(term => {
      const regex = new RegExp(`(${term})`, 'gi');
      highlightedText = highlightedText.replace(
        regex, 
        '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>'
      );
    });
    
    return highlightedText;
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        className={`
          absolute inset-0 bg-black/20 backdrop-blur-sm z-50 
          flex items-center justify-center p-4 ${className}
        `}
        variants={slideIn}
        initial="initial"
        animate="animate"
        exit="exit"
        onClick={(e) => {
          if (e.target === overlayRef.current) {
            onClose();
          }
        }}
      >
        <motion.div
          className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          variants={slideIn}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Vector Search Results
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Semantic similarity for: <span className="font-medium">"{query}"</span>
                </p>
              </div>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <LoadingSpinner size="lg" message="Searching vectors..." />
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-gray-500">
                <Search className="w-12 h-12 mb-4 text-gray-300" />
                <p className="text-lg font-medium mb-2">No similar content found</p>
                <p className="text-sm text-center">
                  Try different keywords or create new content related to your query.
                </p>
              </div>
            ) : (
              <motion.div
                className="divide-y divide-gray-100 dark:divide-gray-700"
                variants={stagger}
                initial="initial"
                animate="animate"
              >
                {results.map((result, index) => (
                  <motion.div
                    key={result.id}
                    className={`
                      p-4 cursor-pointer transition-all duration-200
                      ${index === selectedIndex 
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }
                    `}
                    variants={slideIn}
                    onClick={() => onResultSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-start space-x-3">
                      {/* Type icon */}
                      <div className={`
                        p-2 rounded-lg flex-shrink-0
                        ${result.type === 'message' ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-600' :
                          result.type === 'document' ? 'bg-green-100 dark:bg-green-900/50 text-green-600' :
                          result.type === 'concept' ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-600' :
                          'bg-gray-100 dark:bg-gray-700 text-gray-600'
                        }
                      `}>
                        {getResultIcon(result.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant="outline"
                              className="text-xs capitalize"
                            >
                              {result.type}
                            </Badge>
                            
                            {/* Similarity score */}
                            <div className={`
                              px-2 py-1 rounded text-xs font-medium border
                              ${getSimilarityColor(result.similarity)}
                            `}>
                              {Math.round(result.similarity * 100)}% match
                            </div>

                            {/* Model if message */}
                            {result.type === 'message' && result.metadata?.model && (
                              <Badge variant="secondary" className="text-xs">
                                {result.metadata.model}
                              </Badge>
                            )}
                          </div>

                          {/* Timestamp */}
                          <div className="flex items-center text-xs text-gray-400">
                            <Clock className="w-3 h-3 mr-1" />
                            {formatDistanceToNow(new Date(result.createdAt), { addSuffix: true })}
                          </div>
                        </div>

                        {/* Title/Context */}
                        {result.title && (
                          <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-1 truncate">
                            {result.title}
                          </h4>
                        )}

                        {/* Content preview with highlighting */}
                        <div
                          className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2"
                          dangerouslySetInnerHTML={{
                            __html: highlightText(result.content, query)
                          }}
                        />

                        {/* Context information */}
                        {result.context && (
                          <div className="mt-2 text-xs text-gray-500">
                            Context: {result.context}
                          </div>
                        )}
                      </div>

                      {/* Selection indicator */}
                      {index === selectedIndex && (
                        <div className="flex items-center text-blue-500">
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Footer */}
          {results.length > 0 && (
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-4 text-sm text-gray-500">
                <span>{results.length} results found</span>
                <span>"</span>
                <span>Search time: &lt;200ms</span>
              </div>
              
              <div className="flex items-center space-x-2 text-xs text-gray-400">
                <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">‘“</kbd>
                <span>Navigate</span>
                <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">Enter</kbd>
                <span>Select</span>
                <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">Esc</kbd>
                <span>Close</span>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}