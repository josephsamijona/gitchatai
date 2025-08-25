/**
 * Project-related TypeScript interfaces for workspace management
 * Based on TiDB schema with document pipeline and team collaboration
 */

import type { Branch } from './branch';
import type { Message } from './chat';
import type { Concept } from './knowledge';

export type TeamRole = 'owner' | 'editor' | 'viewer';
export type DocumentMimeType = 'application/pdf' | 'text/plain' | 'text/markdown' | 'application/msword' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Core project interface
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  customInstructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project creation input
 */
export interface CreateProjectInput {
  name: string;
  description?: string;
  customInstructions?: string;
}

/**
 * Project update input
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  customInstructions?: string;
}

/**
 * Document interface with vector embeddings
 */
export interface Document {
  id: string;
  projectId: string;
  filename: string;
  content: string;
  contentEmbedding: number[];
  metadata: Record<string, any>;
  s3Key?: string;
  fileSize: number;
  mimeType: DocumentMimeType;
  processedAt: Date;
}

/**
 * Document creation input
 */
export interface CreateDocumentInput {
  projectId: string;
  filename: string;
  content: string;
  metadata?: Record<string, any>;
  s3Key?: string;
  fileSize: number;
  mimeType: DocumentMimeType;
}

/**
 * Document update input
 */
export interface UpdateDocumentInput {
  filename?: string;
  content?: string;
  metadata?: Record<string, any>;
}

/**
 * Document processing status
 */
export interface DocumentProcessingStatus {
  documentId: string;
  status: 'uploading' | 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'completed' | 'failed';
  progress: number; // 0-100
  currentStep: string;
  error?: string;
  estimatedTimeRemaining?: number; // seconds
}

/**
 * Document chunk for processing pipeline
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  contentEmbedding: number[];
  chunkIndex: number;
  startPosition: number;
  endPosition: number;
  metadata: {
    pageNumber?: number;
    section?: string;
    headings?: string[];
  };
}

/**
 * Team member interface
 */
export interface TeamMember {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  role: TeamRole;
  permissions: {
    canCreateBranches: boolean;
    canUploadDocuments: boolean;
    canInviteMembers: boolean;
    canModifyProject: boolean;
    canDeleteContent: boolean;
  };
  joinedAt: Date;
  lastActive: Date;
}

/**
 * Team member creation input
 */
export interface CreateTeamMemberInput {
  projectId: string;
  email: string;
  role: TeamRole;
  permissions?: Partial<TeamMember['permissions']>;
}

/**
 * Team member update input
 */
export interface UpdateTeamMemberInput {
  role?: TeamRole;
  permissions?: Partial<TeamMember['permissions']>;
}

/**
 * Project with full context
 */
export interface ProjectWithContext extends Project {
  documents: Document[];
  concepts: Concept[];
  teamMembers: TeamMember[];
  statistics: ProjectStatistics;
  recentActivity: ProjectActivity[];
}

/**
 * Project statistics
 */
export interface ProjectStatistics {
  totalDocuments: number;
  totalConversations: number;
  totalBranches: number;
  totalMessages: number;
  totalConcepts: number;
  storageUsed: number; // bytes
  teamMemberCount: number;
  activityMetrics: {
    messagesThisWeek: number;
    branchesThisWeek: number;
    documentsThisWeek: number;
    activeUsers: number;
  };
  performanceMetrics: {
    averageSearchTime: number;
    averageResponseTime: number;
    searchAccuracy: number;
  };
}

/**
 * Project activity for timeline
 */
export interface ProjectActivity {
  id: string;
  projectId: string;
  userId: string;
  type: 'document_uploaded' | 'branch_created' | 'message_sent' | 'concept_discovered' | 'member_added' | 'project_updated';
  description: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

/**
 * Project search result
 */
export interface ProjectSearchResult {
  project: Project;
  relevanceScore: number;
  matchedFields: string[];
  highlightedContent: string;
}

/**
 * Project template for quick setup
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: 'research' | 'education' | 'business' | 'healthcare' | 'legal' | 'creative';
  customInstructions: string;
  suggestedDocuments: string[];
  initialConcepts: string[];
  teamRoleTemplates: {
    role: TeamRole;
    permissions: TeamMember['permissions'];
    description: string;
  }[];
}

/**
 * Project analytics dashboard data
 */
export interface ProjectAnalytics {
  overview: {
    totalProjects: number;
    activeProjects: number;
    totalStorage: number;
    totalUsers: number;
  };
  usage: {
    searchQueries: {
      date: string;
      count: number;
      averageTime: number;
    }[];
    documentUploads: {
      date: string;
      count: number;
      totalSize: number;
    }[];
    conversationActivity: {
      date: string;
      messages: number;
      branches: number;
    }[];
  };
  performance: {
    searchPerformance: {
      averageTime: number;
      p95Time: number;
      successRate: number;
    };
    embeddingGeneration: {
      averageTime: number;
      throughput: number;
    };
    knowledgeExtraction: {
      conceptsPerDocument: number;
      accuracy: number;
    };
  };
}

/**
 * Project validation schema
 */
export interface ProjectValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Document validation schema
 */
export interface DocumentValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  supportedFormats: DocumentMimeType[];
  maxFileSize: number;
}