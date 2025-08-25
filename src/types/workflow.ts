/**
 * Workflow types for SYNAPSE AI Platform multi-step orchestration system
 * Defines interfaces for workflow execution, progress tracking, and integration
 */

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  metadata: {
    category: string;
    estimatedDuration: number;
    tidbOperations: string[];
    demoFeatures: string[];
  };
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'ingestion' | 'embedding' | 'storage' | 'search' | 'llm' | 'external' | 'synthesis';
  description: string;
  configuration: Record<string, any>;
  critical: boolean;
}

export interface WorkflowContext {
  type: 'document' | 'conversation' | 'research';
  projectId?: string;
  conversationId?: string;
  branchId?: string;
  content?: string;
  query?: string;
  filename?: string;
  stepResults?: Record<string, any>;
  conversationContext?: any;
  metadata?: Record<string, any>;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  context: WorkflowContext;
  currentStep: number;
  results: Record<string, any>;
  progress: WorkflowProgress;
  error?: Error;
  processingTimeMs?: number;
  metadata: {
    tidbMetrics: Record<string, any>;
    performanceMetrics: Record<string, any>;
    stepTimings: Record<string, number>;
  };
}

export interface WorkflowResult {
  executionId: string;
  workflowId: string;
  status: 'success' | 'error';
  results: Record<string, any>;
  error?: string;
  processingTimeMs: number;
  metadata: Record<string, any>;
}

export interface WorkflowProgress {
  executionId: string;
  currentStep: number;
  totalSteps: number;
  stepResults: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  startTime: Date;
  processingTimeMs: number;
  metadata: Record<string, any>;
}

// Vector Search Types
export interface VectorSearchRequest {
  query: string;
  maxResults?: number;
  similarityThreshold?: number;
  contentType?: 'messages' | 'documents' | 'concepts' | 'all';
  projectId?: string;
  filters?: SearchFilters;
  hybridConfig?: HybridSearchConfig;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  contentType: string;
  score: number;
  metadata: Record<string, any>;
}

export interface HybridSearchConfig {
  vectorWeight: number;
  fulltextWeight: number;
  normalizeScores: boolean;
  minCombinedScore: number;
}

export interface SearchFilters {
  contentTypes?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  minScore?: number;
}

export interface SearchAnalytics {
  totalSearches: number;
  averageLatency: number;
  cacheHitRate: number;
  vectorSearches: number;
  fulltextSearches: number;
  hybridSearches: number;
  tidbPerformanceMetrics: TiDBPerformanceMetrics;
}

export interface TiDBPerformanceMetrics {
  averageQueryTime: number;
  vectorOperations: number;
  fulltextOperations: number;
  indexHits: number;
}

// External Integration Types
export interface ExternalIntegration {
  type: 'slack' | 'email' | 'webhook';
  enabled: boolean;
  configuration: SlackConfig | EmailConfig | WebhookConfig;
}

export interface SlackConfig {
  enabled: boolean;
  botToken: string;
  defaultChannel: string;
  botName?: string;
}

export interface EmailConfig {
  enabled: boolean;
  provider: 'sendgrid' | 'smtp' | 'resend';
  apiKey: string;
  fromAddress: string;
  defaultRecipients: string[];
}

export interface WebhookConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
}

export interface IntegrationResult {
  type: 'slack' | 'email' | 'webhook';
  success: boolean;
  response?: any;
  error?: string;
  latency: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface IntegrationTemplate {
  name: string;
  description: string;
}

export interface IntegrationMetrics {
  totalIntegrations: number;
  successfulIntegrations: number;
  failedIntegrations: number;
  averageLatency: number;
  integrationsByType: {
    slack: { total: number; successful: number; failed: number };
    email: { total: number; successful: number; failed: number };
    webhook: { total: number; successful: number; failed: number };
  };
}

// Knowledge Synthesis Types
export interface KnowledgeSynthesis {
  concepts?: ConceptExtractionResult['concepts'];
  relationships?: RelationshipExtractionResult[];
  clusters?: ConceptCluster[];
  graphUpdated: boolean;
  processingTime: number;
  metadata: {
    conceptsExtracted: number;
    relationshipsCreated: number;
    clustersCreated: number;
    overallConfidence: number;
    graphUpdate?: KnowledgeGraphUpdate;
  };
}

export interface ConceptExtractionResult {
  concepts: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    confidence: number;
    embedding: number[];
    source: string;
  }>;
  relationships: RelationshipExtractionResult[];
  clusters: ConceptCluster[];
  confidence: number;
  processingTime: number;
}

export interface RelationshipExtractionResult {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  confidence: number;
}

export interface ConceptCluster {
  id: string;
  name: string;
  concepts: any[];
  centroid: number[];
  coherence: number;
  size: number;
}

export interface SynthesisConfig {
  minConceptConfidence: number;
  minRelationshipStrength: number;
  maxConceptsPerContent: number;
  enableClustering: boolean;
  clusterSimilarityThreshold: number;
}

export interface KnowledgeGraphUpdate {
  conceptsInserted: number;
  conceptsUpdated: number;
  relationshipsCreated: number;
  clustersCreated: number;
  processingTime: number;
  graphUpdated: boolean;
}