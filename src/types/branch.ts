/**
 * Branch-related TypeScript interfaces for Git-style conversation branching
 * Based on TiDB schema with context embeddings for model switching
 */

import type { AIModel, Message } from './chat';

/**
 * Core branch interface with context embeddings
 */
export interface Branch {
  id: string;
  conversationId: string;
  parentBranchId?: string;
  name: string;
  model: AIModel;
  contextSummary?: string;
  contextEmbedding: number[];
  branchPoint?: string; // Message ID where branch was created
  customInstructions?: string; // Custom AI instructions for this branch
  createdAt: Date;
  updatedAt?: Date;
  messages?: Message[];
}

/**
 * Branch creation input
 */
export interface CreateBranchInput {
  conversationId: string;
  parentBranchId?: string;
  name: string;
  model: AIModel;
  contextSummary?: string;
  fromMessageId?: string; // Branch from specific message
  branchPoint?: string; // Message ID where branch was created
  customInstructions?: string; // Custom AI instructions for this branch
}

/**
 * Branch update input
 */
export interface UpdateBranchInput {
  name?: string;
  model?: AIModel;
  contextSummary?: string;
}

/**
 * Branch with full hierarchy information
 */
export interface BranchWithHierarchy extends Branch {
  parentBranch?: Branch;
  childBranches: Branch[];
  depth: number;
  path: string[]; // Array of branch IDs from root to current
  messageCount: number;
  lastActivity: Date;
}

/**
 * Branch tree node for visualization
 */
export interface BranchTreeNode {
  id: string;
  name: string;
  model: AIModel;
  parentId?: string;
  children: BranchTreeNode[];
  position: {
    x: number;
    y: number;
  };
  metadata: {
    messageCount: number;
    lastActivity: Date;
    isActive: boolean;
    depth: number;
  };
}

/**
 * Branch comparison result
 */
export interface BranchComparison {
  branchA: Branch;
  branchB: Branch;
  similarities: {
    contentSimilarity: number;
    conceptOverlap: string[];
    sharedMessages: number;
  };
  differences: {
    uniqueToA: string[];
    uniqueToB: string[];
    modelDifferences: {
      modelA: AIModel;
      modelB: AIModel;
      responseStyleDifferences: string[];
    };
  };
}

/**
 * Branch merge configuration
 */
export interface BranchMergeConfig {
  sourceBranches: string[];
  targetBranchId?: string; // If not provided, creates new branch
  mergeStrategy: 'ai_synthesis' | 'chronological' | 'manual';
  conflictResolution: 'prefer_newer' | 'prefer_longer' | 'manual_review';
  preserveOriginals: boolean;
}

/**
 * Branch merge result
 */
export interface BranchMergeResult {
  mergedBranch: Branch;
  conflicts: BranchConflict[];
  synthesisReport: {
    keyInsights: string[];
    contradictions: string[];
    recommendations: string[];
  };
  originalBranches: Branch[];
}

/**
 * Branch conflict for merge resolution
 */
export interface BranchConflict {
  id: string;
  type: 'content_contradiction' | 'model_disagreement' | 'temporal_overlap';
  description: string;
  affectedMessages: string[];
  resolutionOptions: {
    option: string;
    description: string;
    impact: string;
  }[];
  autoResolvable: boolean;
}

/**
 * Branch navigation state
 */
export interface BranchNavigationState {
  currentBranchId: string;
  visitedBranches: string[];
  bookmarkedBranches: string[];
  recentBranches: {
    branchId: string;
    visitedAt: Date;
  }[];
}

/**
 * Branch statistics for analytics
 */
export interface BranchStatistics {
  totalBranches: number;
  averageDepth: number;
  maxDepth: number;
  modelDistribution: Record<AIModel, number>;
  branchingPatterns: {
    mostBranchedMessages: {
      messageId: string;
      branchCount: number;
    }[];
    averageBranchesPerMessage: number;
  };
  activityMetrics: {
    branchesCreatedToday: number;
    branchesCreatedThisWeek: number;
    mostActiveBranch: {
      branchId: string;
      messageCount: number;
    };
  };
}

/**
 * Branch validation schema
 */
export interface BranchValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}