/**
 * Central export file for all TypeScript interfaces and types
 * SYNAPSE AI Platform - Core Data Models
 */

// Chat and messaging types
export type {
  Message,
  CreateMessageInput,
  UpdateMessageInput,
  MessageWithContext,
  MessageSearchResult,
  MessageChunk,
  MessageValidation,
  MessageRole,
  AIModel
} from './chat';

// Branch and conversation types
export type {
  Branch,
  CreateBranchInput,
  UpdateBranchInput,
  BranchWithHierarchy,
  BranchTreeNode,
  BranchComparison,
  BranchMergeConfig,
  BranchMergeResult,
  BranchConflict,
  BranchNavigationState,
  BranchStatistics,
  BranchValidation
} from './branch';

// Project and workspace types
export type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Document,
  CreateDocumentInput,
  UpdateDocumentInput,
  DocumentProcessingStatus,
  DocumentChunk,
  TeamMember,
  CreateTeamMemberInput,
  UpdateTeamMemberInput,
  ProjectWithContext,
  ProjectStatistics,
  ProjectActivity,
  ProjectSearchResult,
  ProjectTemplate,
  ProjectAnalytics,
  ProjectValidation,
  DocumentValidation,
  TeamRole,
  DocumentMimeType
} from './project';

// Knowledge graph and concept types
export type {
  Concept,
  CreateConceptInput,
  UpdateConceptInput,
  ConceptRelationship,
  CreateConceptRelationshipInput,
  ConceptWithRelationships,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  KnowledgeGraph,
  KnowledgeCluster,
  ConceptExtractionResult,
  ConceptSearchResult,
  KnowledgeGraphAnalytics,
  KnowledgeGraphLayout,
  ConceptValidation,
  KnowledgeSynthesisReport,
  ConceptRelationshipType
} from './knowledge';

// Re-export existing types for compatibility
export type * from './api';
export type * from './tidb';
export type * from './vector';
export type * from './ui';
export type * from './workflow';
export type * from './hackathon';

// Common utility types
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface SearchParams {
  query: string;
  filters?: Record<string, any>;
  embedding?: number[];
  vectorWeight?: number;
  textWeight?: number;
  limit?: number;
  threshold?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PerformanceMetric {
  operationType: string;
  executionTimeMs: number;
  resultCount: number;
  model?: string;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

// Error types
export interface AppError {
  type: string;
  message: string;
  details?: any;
  retryable: boolean;
  timestamp: Date;
}

// WebSocket message types
export interface WebSocketMessage<T = any> {
  type: string;
  payload: T;
  timestamp: Date;
  userId?: string;
  projectId?: string;
}

// Multi-step workflow types
export interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: any;
  output?: any;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
}

export interface WorkflowExecution {
  id: string;
  projectId?: string;
  conversationId?: string;
  branchId?: string;
  workflowType: 'ingestion' | 'search' | 'llm' | 'external_api' | 'synthesis';
  steps: WorkflowStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;
}

// External integration types
export interface ExternalIntegration {
  id: string;
  projectId: string;
  type: 'slack' | 'email' | 'webhook' | 'api';
  name: string;
  configuration: Record<string, any>;
  isActive: boolean;
  lastUsed?: Date;
  createdAt: Date;
}

// Cache types
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  expiresAt: Date;
  tags?: string[];
}

// Configuration types
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized: boolean;
  };
}

export interface AIModelConfig {
  name: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  enabled: boolean;
}

export interface AppConfig {
  database: DatabaseConfig;
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  s3: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  aiModels: Record<string, AIModelConfig>;
  features: {
    vectorSearch: boolean;
    knowledgeGraph: boolean;
    realTimeCollaboration: boolean;
    documentProcessing: boolean;
  };
}