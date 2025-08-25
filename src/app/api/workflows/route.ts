/**
 * Workflow Management API Routes
 * Handles multi-step workflow execution, monitoring, and management
 */

import { NextRequest, NextResponse } from 'next/server';
import { WorkflowOrchestrator } from '../../../lib/workflows/orchestrator';
import { VectorSearchService } from '../../../lib/workflows/vector-search';
import { ExternalAPIService, createDemoExternalAPIConfig } from '../../../lib/workflows/external-apis';
import { KnowledgeSynthesisEngine } from '../../../lib/workflows/knowledge-synthesis';
import { createModelOrchestrator } from '../../../lib/ai/orchestrator';
import { EmbeddingService } from '../../../lib/ai/embeddings';
import { TiDBClient } from '../../../lib/tidb/client';
import { ConceptRepository } from '../../../lib/repositories/concept';
import { MessageRepository } from '../../../lib/repositories/message';
import { DocumentRepository } from '../../../lib/repositories/document';
import type { WorkflowDefinition, WorkflowContext } from '../../../types/workflow';

// Initialize services (in production, these would be dependency injected)
const tidbClient = new TiDBClient({
  host: process.env.TIDB_HOST || 'localhost',
  port: parseInt(process.env.TIDB_PORT || '4000'),
  user: process.env.TIDB_USER || 'root',
  password: process.env.TIDB_PASSWORD || '',
  database: process.env.TIDB_DATABASE || 'synapse',
  ssl: process.env.TIDB_SSL === 'true'
});

const embeddingService = new EmbeddingService(
  {
    name: 'openai' as any,
    apiKey: process.env.OPENAI_API_KEY || '',
    enabled: true
  }
);

const vectorSearchService = new VectorSearchService({
  tidbClient,
  embeddingService,
  performanceTracking: true,
  caching: {
    enabled: true,
    ttl: 300
  },
  defaultWeights: {
    vector: 0.7,
    fulltext: 0.3
  }
});

const externalAPIService = new ExternalAPIService(createDemoExternalAPIConfig());

const conceptRepository = new ConceptRepository(tidbClient);
const messageRepository = new MessageRepository(tidbClient);
const documentRepository = new DocumentRepository(tidbClient);

const knowledgeSynthesisEngine = new KnowledgeSynthesisEngine({
  modelOrchestrator: {} as any, // Will be initialized when needed
  embeddingService,
  conceptRepository,
  tidbClient,
  defaultModel: 'claude',
  synthesis: {
    minConceptConfidence: 0.7,
    minRelationshipStrength: 0.6,
    maxConceptsPerContent: 20,
    enableClustering: true,
    clusterSimilarityThreshold: 0.75
  }
});

const workflowOrchestrator = new WorkflowOrchestrator({
  tidbClient,
  modelOrchestrator: {} as any, // Will be initialized when needed
  embeddingService,
  vectorSearchService,
  externalAPIService,
  knowledgeSynthesisEngine,
  repositories: {
    concept: conceptRepository,
    message: messageRepository,
    document: documentRepository
  },
  realTimeUpdates: true
});

/**
 * GET /api/workflows - Get available workflow definitions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    
    // Pre-defined workflow definitions for hackathon demo
    const workflows: WorkflowDefinition[] = [
      workflowOrchestrator.createDocumentIngestionWorkflow(
        'demo-project',
        'Sample document content for demonstration'
      ),
      workflowOrchestrator.createConversationAnalysisWorkflow(
        'demo-conversation',
        'demo-branch'
      ),
      workflowOrchestrator.createResearchWorkflow(
        'AI and machine learning applications',
        'demo-project'
      )
    ];

    const filteredWorkflows = category
      ? workflows.filter(w => w.metadata.category === category)
      : workflows;

    return NextResponse.json({
      success: true,
      workflows: filteredWorkflows,
      metadata: {
        total: filteredWorkflows.length,
        categories: [...new Set(workflows.map(w => w.metadata.category))]
      }
    });

  } catch (error) {
    console.error('Failed to get workflows:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get workflows'
    }, { status: 500 });
  }
}

/**
 * POST /api/workflows - Execute a workflow
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowId, context }: { workflowId: string; context: WorkflowContext } = body;

    if (!workflowId || !context) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: workflowId, context'
      }, { status: 400 });
    }

    // Get workflow definition
    let workflowDefinition: WorkflowDefinition;
    
    switch (workflowId) {
      case 'document-ingestion':
        if (!context.content) {
          return NextResponse.json({
            success: false,
            error: 'Document content is required for document ingestion workflow'
          }, { status: 400 });
        }
        workflowDefinition = workflowOrchestrator.createDocumentIngestionWorkflow(
          context.projectId || 'default',
          context.content
        );
        break;

      case 'conversation-analysis':
        if (!context.conversationId || !context.branchId) {
          return NextResponse.json({
            success: false,
            error: 'conversationId and branchId are required for conversation analysis workflow'
          }, { status: 400 });
        }
        workflowDefinition = workflowOrchestrator.createConversationAnalysisWorkflow(
          context.conversationId,
          context.branchId
        );
        break;

      case 'research-workflow':
        if (!context.query) {
          return NextResponse.json({
            success: false,
            error: 'Query is required for research workflow'
          }, { status: 400 });
        }
        workflowDefinition = workflowOrchestrator.createResearchWorkflow(
          context.query,
          context.projectId || 'default'
        );
        break;

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown workflow ID: ${workflowId}`
        }, { status: 400 });
    }

    // Execute workflow
    const result = await workflowOrchestrator.executeWorkflow(workflowDefinition, context);

    return NextResponse.json({
      success: true,
      execution: result,
      workflow: workflowDefinition,
      metadata: {
        executionId: result.executionId,
        processingTime: result.processingTimeMs,
        status: result.status
      }
    });

  } catch (error) {
    console.error('Workflow execution failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflow execution failed'
    }, { status: 500 });
  }
}