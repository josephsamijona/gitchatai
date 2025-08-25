/**
 * Knowledge graph and concept-related TypeScript interfaces
 * Based on TiDB schema with concept embeddings and relationships
 */

export type ConceptRelationshipType = 'related' | 'parent' | 'child' | 'similar' | 'opposite' | 'causes' | 'enables';

/**
 * Core concept interface with vector embeddings
 */
export interface Concept {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  conceptEmbedding: number[];
  mentionCount: number;
  confidenceScore: number; // 0.0 to 1.0
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Concept creation input
 */
export interface CreateConceptInput {
  projectId: string;
  name: string;
  description?: string;
  confidenceScore?: number;
}

/**
 * Concept update input
 */
export interface UpdateConceptInput {
  name?: string;
  description?: string;
  confidenceScore?: number;
}

/**
 * Concept relationship interface
 */
export interface ConceptRelationship {
  id: string;
  sourceConceptId: string;
  targetConceptId: string;
  relationshipType: ConceptRelationshipType;
  strength: number; // 0.0 to 1.0
  createdAt: Date;
}

/**
 * Concept relationship creation input
 */
export interface CreateConceptRelationshipInput {
  sourceConceptId: string;
  targetConceptId: string;
  relationshipType: ConceptRelationshipType;
  strength?: number;
}

/**
 * Concept with relationships for graph visualization
 */
export interface ConceptWithRelationships extends Concept {
  relationships: {
    outgoing: (ConceptRelationship & { targetConcept: Concept })[];
    incoming: (ConceptRelationship & { sourceConcept: Concept })[];
  };
  relatedConcepts: Concept[];
  totalRelationships: number;
}

/**
 * Knowledge graph node for 3D visualization
 */
export interface KnowledgeGraphNode {
  id: string;
  name: string;
  description?: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  size: number; // Based on mention count
  color: string; // Based on concept category or confidence
  metadata: {
    mentionCount: number;
    confidenceScore: number;
    category?: string;
    lastUpdated: Date;
  };
}

/**
 * Knowledge graph edge for relationships
 */
export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: ConceptRelationshipType;
  strength: number;
  color: string;
  animated: boolean;
  metadata: {
    createdAt: Date;
    bidirectional: boolean;
  };
}

/**
 * Complete knowledge graph structure
 */
export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
    averageConnections: number;
    clusters: KnowledgeCluster[];
    lastUpdated: Date;
  };
}

/**
 * Knowledge cluster for graph organization
 */
export interface KnowledgeCluster {
  id: string;
  name: string;
  concepts: string[]; // Concept IDs
  centroid: {
    x: number;
    y: number;
    z: number;
  };
  color: string;
  size: number;
  coherenceScore: number; // How tightly related the concepts are
}

/**
 * Concept extraction result from AI analysis
 */
export interface ConceptExtractionResult {
  concepts: {
    name: string;
    description: string;
    confidenceScore: number;
    mentions: {
      messageId?: string;
      documentId?: string;
      context: string;
      position: number;
    }[];
  }[];
  relationships: {
    sourceConcept: string;
    targetConcept: string;
    relationshipType: ConceptRelationshipType;
    strength: number;
    evidence: string[];
  }[];
  summary: {
    totalConcepts: number;
    totalRelationships: number;
    averageConfidence: number;
    keyThemes: string[];
  };
}

/**
 * Concept search result with similarity
 */
export interface ConceptSearchResult {
  concept: Concept;
  similarity: number;
  matchType: 'name' | 'description' | 'semantic';
  relatedConcepts: Concept[];
  usageContext: {
    recentMentions: {
      messageId?: string;
      documentId?: string;
      snippet: string;
      timestamp: Date;
    }[];
    popularRelationships: ConceptRelationship[];
  };
}

/**
 * Knowledge graph analytics
 */
export interface KnowledgeGraphAnalytics {
  overview: {
    totalConcepts: number;
    totalRelationships: number;
    averageConnections: number;
    graphDensity: number;
  };
  growth: {
    conceptsAdded: {
      date: string;
      count: number;
    }[];
    relationshipsAdded: {
      date: string;
      count: number;
    }[];
  };
  topConcepts: {
    mostMentioned: (Concept & { mentionCount: number })[];
    mostConnected: (Concept & { connectionCount: number })[];
    highestConfidence: (Concept & { confidenceScore: number })[];
  };
  clusters: {
    id: string;
    name: string;
    conceptCount: number;
    coherenceScore: number;
    topConcepts: string[];
  }[];
  insights: {
    emergingConcepts: Concept[];
    weakConnections: ConceptRelationship[];
    potentialMerges: {
      concept1: Concept;
      concept2: Concept;
      similarity: number;
    }[];
  };
}

/**
 * Knowledge graph layout configuration
 */
export interface KnowledgeGraphLayout {
  algorithm: 'force_directed' | 'hierarchical' | 'circular' | 'grid';
  parameters: {
    nodeRepulsion?: number;
    linkStrength?: number;
    centerForce?: number;
    collisionRadius?: number;
    iterations?: number;
  };
  clustering: {
    enabled: boolean;
    algorithm?: 'modularity' | 'louvain' | 'leiden';
    resolution?: number;
  };
  filtering: {
    minMentionCount?: number;
    minConfidenceScore?: number;
    relationshipTypes?: ConceptRelationshipType[];
    timeRange?: {
      start: Date;
      end: Date;
    };
  };
}

/**
 * Concept validation schema
 */
export interface ConceptValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: {
    similarConcepts: Concept[];
    potentialRelationships: {
      targetConcept: Concept;
      suggestedType: ConceptRelationshipType;
      confidence: number;
    }[];
  };
}

/**
 * Knowledge synthesis report
 */
export interface KnowledgeSynthesisReport {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  keyInsights: string[];
  conceptsAnalyzed: string[];
  relationshipsExplored: ConceptRelationship[];
  contradictions: {
    description: string;
    conflictingConcepts: string[];
    evidence: string[];
  }[];
  recommendations: {
    action: string;
    rationale: string;
    priority: 'high' | 'medium' | 'low';
    concepts: string[];
  }[];
  generatedAt: Date;
  confidence: number;
}