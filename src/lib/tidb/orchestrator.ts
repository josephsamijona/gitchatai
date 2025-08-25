import { tidbClient, TiDBError, TiDBErrorType } from './client';
import VectorSearchService from './vector-search';
import DatabaseQueries from './queries';

/**
 * TiDB Operations Orchestrator
 * Coordinates complex multi-step operations across TiDB services
 */

export interface WorkflowContext {
  projectId?: string;
  conversationId?: string;
  branchId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowStep {
  name: string;
  type: 'ingestion' | 'search' | 'llm' | 'external_api' | 'synthesis';
  input: any;
  output?: any;
  executionTimeMs?: number;
  success?: boolean;
  error?: string;
}

/**
 * Multi-Step Workflow Orchestrator
 */
export class TiDBOrchestrator {
  /**
   * Execute complete document ingestion workflow
   */
  static async executeDocumentIngestion(
    projectId: string,
    filename: string,
    content: string,
    embedding: number[],
    metadata: Record<string, any> = {}
  ): Promise<{
    documentId: string;
    concepts: string[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      return await tidbClient.transaction(async (connection) => {
        // Store document
        const documentId = await DatabaseQueries.createDocument(
          projectId,
          filename,
          content,
          embedding,
          metadata
        );

        // Extract concepts (simplified)
        const concepts = await this.extractConceptsFromContent(content, projectId);

        return {
          documentId,
          concepts,
          executionTime: Date.now() - startTime
        };
      });
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Document ingestion workflow failed', error);
    }
  }

  /**
   * Execute hybrid search workflow
   */
  static async executeSearchWorkflow(
    query: string,
    embedding: number[],
    context: WorkflowContext,
    options: {
      includeMessages?: boolean;
      includeDocuments?: boolean;
      includeConcepts?: boolean;
      limit?: number;
    } = {}
  ): Promise<{
    results: any[];
    searchTime: number;
    resultCount: number;
  }> {
    const startTime = Date.now();
    const { includeMessages = true, includeDocuments = true, includeConcepts = true, limit = 20 } = options;
    
    try {
      const searchPromises: Promise<any[]>[] = [];

      if (includeMessages) {
        searchPromises.push(
          VectorSearchService.hybridSearchMessages(query, embedding, {
            projectId: context.projectId,
            conversationId: context.conversationId,
            branchId: context.branchId
          }, { limit: Math.ceil(limit / 3) })
        );
      }

      if (includeDocuments) {
        searchPromises.push(
          VectorSearchService.hybridSearchDocuments(query, embedding, {
            projectId: context.projectId
          }, { limit: Math.ceil(limit / 3) })
        );
      }

      if (includeConcepts) {
        searchPromises.push(
          VectorSearchService.hybridSearchConcepts(query, embedding, {
            projectId: context.projectId
          }, { limit: Math.ceil(limit / 3) })
        );
      }

      const searchResults = await Promise.all(searchPromises);
      const allResults = searchResults
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return {
        results: allResults,
        searchTime: Date.now() - startTime,
        resultCount: allResults.length
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.VECTOR_SEARCH_ERROR, 'Search workflow failed', error);
    }
  }

  /**
   * Execute knowledge synthesis workflow
   */
  static async executeKnowledgeSynthesis(
    content: string,
    embedding: number[],
    context: WorkflowContext
  ): Promise<{
    extractedConcepts: string[];
    updatedRelationships: number;
    synthesisTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      return await tidbClient.transaction(async (connection) => {
        const concepts = await this.extractConceptsFromContent(content, context.projectId!);
        
        const relatedConcepts = await VectorSearchService.searchConcepts(
          embedding,
          { projectId: context.projectId },
          10,
          0.4
        );

        let relationshipCount = 0;
        for (const concept of concepts) {
          for (const related of relatedConcepts) {
            if (concept !== related.id) {
              await DatabaseQueries.createConceptRelationship(
                concept,
                related.id,
                'related',
                related.score * 0.8
              );
              relationshipCount++;
            }
          }
        }

        return {
          extractedConcepts: concepts,
          updatedRelationships: relationshipCount,
          synthesisTime: Date.now() - startTime
        };
      });
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Knowledge synthesis workflow failed', error);
    }
  }

  /**
   * Extract concepts from content (simplified)
   */
  private static async extractConceptsFromContent(
    content: string,
    projectId: string
  ): Promise<string[]> {
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    const conceptCandidates = [...new Set(words)].slice(0, 10);
    const conceptIds: string[] = [];

    for (const candidate of conceptCandidates) {
      try {
        const embedding = Array.from({ length: 1536 }, () => Math.random() - 0.5);
        
        const conceptId = await DatabaseQueries.createConcept(
          projectId,
          candidate,
          embedding,
          `Concept extracted from content: ${candidate}`,
          1,
          0.6
        );
        
        conceptIds.push(conceptId);
      } catch (error) {
        console.warn(`Failed to create concept ${candidate}:`, error);
      }
    }

    return conceptIds;
  }
}

export default TiDBOrchestrator;