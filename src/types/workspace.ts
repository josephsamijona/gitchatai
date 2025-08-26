/**
 * Workspace-related TypeScript interfaces
 * Enhanced project management with chat history and context isolation
 */

import type { Project, Document, TeamMember, ProjectActivity } from './project';
import type { Concept } from './knowledge';
import type { Conversation } from './chat';

/**
 * Workspace context with isolated settings
 */
export interface WorkspaceContext {
  projectId: string;
  ownerId: string;
  settings: WorkspaceSettings;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workspace settings configuration
 */
export interface WorkspaceSettings {
  aiModelPreferences: {
    defaultModel: 'claude' | 'gpt4' | 'kimi' | 'grok';
    allowModelSwitching: boolean;
    preferredModels: string[];
    customPrompts?: Record<string, string>;
  };
  searchSettings: {
    enableVectorSearch: boolean;
    enableFullTextSearch: boolean;
    hybridSearchWeight: number; // 0-1, weight for vector vs text search
    maxSearchResults: number;
    searchHistory: boolean;
  };
  collaborationSettings: {
    enableRealTimeUpdates: boolean;
    enableActivityNotifications: boolean;
    shareKnowledgeGraphs: boolean;
    allowGuestAccess: boolean;
    activityRetention: number; // days
  };
  documentProcessingSettings: {
    autoExtractConcepts: boolean;
    chunkSize: number;
    chunkOverlap: number;
    enableOCR: boolean;
    supportedFormats: string[];
  };
  privacySettings: {
    encryptDocuments: boolean;
    retentionPeriod: number; // days
    anonymizeExports: boolean;
    dataResidency?: string; // region preference
  };
}

/**
 * Chat history interface for workspace
 */
export interface ChatHistory {
  conversations: WorkspaceConversation[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  searchQuery?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

/**
 * Workspace conversation with branches and messages
 */
export interface WorkspaceConversation {
  id: string;
  title: string;
  createdAt: Date;
  branches: WorkspaceBranch[];
  messageCount?: number;
  lastActivity?: Date;
  tags?: string[];
  archived?: boolean;
}

/**
 * Workspace branch with messages
 */
export interface WorkspaceBranch {
  id: string;
  name: string;
  model: string;
  messages: WorkspaceMessage[];
  parentBranchId?: string;
  createdAt: Date;
  messageCount?: number;
}

/**
 * Workspace message interface
 */
export interface WorkspaceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  tokenCount?: number;
  processingTime?: number;
  metadata?: Record<string, any>;
  attachments?: MessageAttachment[];
  references?: MessageReference[];
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  id: string;
  type: 'document' | 'image' | 'link' | 'concept';
  name: string;
  url?: string;
  metadata?: Record<string, any>;
}

/**
 * Message reference to documents or concepts
 */
export interface MessageReference {
  id: string;
  type: 'document' | 'concept' | 'conversation';
  title: string;
  relevanceScore: number;
  snippet?: string;
}

/**
 * Workspace activity extended from ProjectActivity
 */
export interface WorkspaceActivity extends ProjectActivity {
  category: 'conversation' | 'document' | 'team' | 'system' | 'knowledge';
  priority: 'low' | 'medium' | 'high';
  isRead: boolean;
  relatedItems?: {
    conversationId?: string;
    documentId?: string;
    conceptId?: string;
    branchId?: string;
  };
}

/**
 * Workspace analytics data
 */
export interface WorkspaceAnalytics {
  overview: {
    activeConversations: number;
    totalMessages: number;
    documentsProcessed: number;
    conceptsDiscovered: number;
    teamMembers: number;
    storageUsed: number;
  };
  usage: {
    dailyActivity: {
      date: string;
      messages: number;
      documents: number;
      searchQueries: number;
    }[];
    modelUsage: {
      model: string;
      messageCount: number;
      averageResponseTime: number;
      successRate: number;
    }[];
    searchPatterns: {
      query: string;
      frequency: number;
      avgResults: number;
      avgRelevance: number;
    }[];
  };
  performance: {
    averageResponseTime: number;
    searchPerformance: number;
    documentProcessingTime: number;
    knowledgeExtractionAccuracy: number;
  };
  collaboration: {
    teamActivity: {
      userId: string;
      name: string;
      messagesCount: number;
      documentsUploaded: number;
      lastActive: Date;
    }[];
    sharedConcepts: number;
    collaborativeEdits: number;
  };
}

/**
 * Project template for workspace creation
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: 'research' | 'education' | 'business' | 'healthcare' | 'legal' | 'creative' | 'personal';
  icon: string;
  customInstructions: string;
  defaultSettings: Partial<WorkspaceSettings>;
  suggestedDocuments: {
    name: string;
    description: string;
    required: boolean;
    category: string;
  }[];
  initialConcepts: {
    name: string;
    description: string;
    category: string;
  }[];
  teamRoleTemplates: {
    role: TeamMember['role'];
    permissions: TeamMember['permissions'];
    description: string;
    isDefault: boolean;
  }[];
  workflowSteps: {
    step: string;
    title: string;
    description: string;
    optional: boolean;
    estimatedTime: string;
  }[];
}

/**
 * Workspace creation wizard state
 */
export interface WorkspaceWizardState {
  currentStep: number;
  totalSteps: number;
  data: {
    basicInfo: {
      name: string;
      description: string;
      category: ProjectTemplate['category'];
      isPublic: boolean;
    };
    template: {
      selectedTemplate?: ProjectTemplate;
      customInstructions: string;
      aiModelPreference: string;
    };
    documents: {
      uploadedFiles: File[];
      processingStatus: Record<string, 'pending' | 'processing' | 'completed' | 'error'>;
    };
    team: {
      members: {
        email: string;
        role: TeamMember['role'];
        permissions: TeamMember['permissions'];
      }[];
      inviteEmails: string[];
    };
    settings: Partial<WorkspaceSettings>;
  };
  validation: {
    [stepKey: string]: {
      isValid: boolean;
      errors: string[];
    };
  };
  isComplete: boolean;
}

/**
 * Workspace search filters
 */
export interface WorkspaceSearchFilters {
  dateRange?: {
    start: Date;
    end: Date;
  };
  contentTypes: ('messages' | 'documents' | 'concepts')[];
  aiModels: string[];
  conversationIds: string[];
  tags: string[];
  authors: string[];
  minRelevance: number;
  sortBy: 'relevance' | 'date' | 'popularity';
  sortOrder: 'asc' | 'desc';
}

/**
 * Workspace search result
 */
export interface WorkspaceSearchResult {
  id: string;
  type: 'message' | 'document' | 'concept';
  title: string;
  content: string;
  relevanceScore: number;
  highlightedContent: string;
  metadata: {
    conversationTitle?: string;
    branchName?: string;
    aiModel?: string;
    createdAt: Date;
    author?: string;
    tags?: string[];
  };
  relatedItems: {
    id: string;
    type: string;
    title: string;
    relevanceScore: number;
  }[];
}

/**
 * Workspace export options
 */
export interface WorkspaceExportOptions {
  format: 'json' | 'markdown' | 'pdf' | 'csv';
  includeConversations: boolean;
  includeDocuments: boolean;
  includeConcepts: boolean;
  includeAnalytics: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  anonymize: boolean;
  compression: 'none' | 'zip' | 'tar.gz';
}

/**
 * Workspace backup configuration
 */
export interface WorkspaceBackup {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  createdAt: Date;
  size: number; // bytes
  format: WorkspaceExportOptions['format'];
  s3Key: string;
  metadata: {
    conversationsCount: number;
    documentsCount: number;
    conceptsCount: number;
    messagesCount: number;
  };
  isAutoBackup: boolean;
  expiresAt?: Date;
}

/**
 * Workspace health status
 */
export interface WorkspaceHealth {
  overall: 'healthy' | 'warning' | 'critical';
  checks: {
    database: {
      status: 'healthy' | 'warning' | 'error';
      responseTime: number;
      lastChecked: Date;
      message?: string;
    };
    vectorSearch: {
      status: 'healthy' | 'warning' | 'error';
      averageLatency: number;
      successRate: number;
      lastChecked: Date;
    };
    aiModels: {
      model: string;
      status: 'healthy' | 'warning' | 'error';
      averageResponseTime: number;
      successRate: number;
      lastChecked: Date;
    }[];
    storage: {
      status: 'healthy' | 'warning' | 'error';
      usedSpace: number;
      totalSpace: number;
      growthRate: number; // MB per day
    };
    knowledgeGraph: {
      status: 'healthy' | 'warning' | 'error';
      conceptsCount: number;
      relationshipsCount: number;
      avgExtractionTime: number;
    };
  };
  recommendations: {
    type: 'performance' | 'storage' | 'ai' | 'collaboration';
    priority: 'low' | 'medium' | 'high';
    title: string;
    description: string;
    actionUrl?: string;
  }[];
}