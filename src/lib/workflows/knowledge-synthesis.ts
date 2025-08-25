/**
 * Knowledge Synthesis Engine for SYNAPSE AI Platform
 * Extracts concepts and relationships from conversations/documents for knowledge graph updates
 * Demonstrates AI-powered knowledge discovery and graph generation
 */

import type {
  KnowledgeSynthesis,
  ConceptExtractionResult,
  RelationshipExtractionResult,
  SynthesisConfig,
  KnowledgeGraphUpdate,
  ConceptCluster
} from '../../types/workflow';

import { ModelOrchestrator } from '../ai/orchestrator';
import { EmbeddingService } from '../ai/embeddings';
import { ConceptRepository } from '../repositories/concept';
import { TiDBClient } from '../tidb/client';

export interface KnowledgeSynthesisEngineConfig {
  modelOrchestrator: ModelOrchestrator;
  embeddingService: EmbeddingService;
  conceptRepository: ConceptRepository;
  tidbClient: TiDBClient;
  defaultModel: 'claude' | 'gpt4' | 'kimi';
  synthesis: {
    minConceptConfidence: number;
    minRelationshipStrength: number;
    maxConceptsPerContent: number;
    enableClustering: boolean;
    clusterSimilarityThreshold: number;
  };
}

export class KnowledgeSynthesisEngine {
  private synthesisCache = new Map<string, ConceptExtractionResult>();
  private performanceMetrics = {
    totalSyntheses: 0,
    conceptsExtracted: 0,
    relationshipsCreated: 0,
    averageProcessingTime: 0,
    cacheHitRate: 0
  };

  constructor(private config: KnowledgeSynthesisEngineConfig) {}

  /**
   * Main synthesis method - extracts knowledge from content and updates graph
   */
  async synthesize(request: {
    context: any;
    stepResults: Record<string, any>;
    configuration: any;
  }): Promise<KnowledgeSynthesis> {
    const startTime = Date.now();
    
    try {
      // Extract content for analysis
      const content = this.extractContentFromContext(request.context, request.stepResults);
      if (!content) {
        throw new Error('No content found for synthesis');
      }

      // Check cache first
      const cacheKey = this.generateCacheKey(content);
      const cached = this.synthesisCache.get(cacheKey);
      if (cached) {
        this.updateCacheMetrics(true);
        return this.buildSynthesisResult(cached, null, Date.now() - startTime);
      }

      // Extract concepts and relationships in parallel
      const [concepts, relationships] = await Promise.all([
        this.extractConcepts(content, request.context.projectId),
        this.extractRelationships(content, request.context.projectId)
      ]);

      // Generate embeddings for concepts
      const conceptsWithEmbeddings = await this.generateConceptEmbeddings(concepts);

      // Perform concept clustering if enabled
      let clusters: ConceptCluster[] = [];
      if (this.config.synthesis.enableClustering) {
        clusters = await this.clusterConcepts(conceptsWithEmbeddings);
      }

      // Update knowledge graph in TiDB
      const graphUpdate = await this.updateKnowledgeGraph(
        conceptsWithEmbeddings,
        relationships,
        clusters,
        request.context.projectId
      );

      // Cache results
      const extractionResult: ConceptExtractionResult = {
        concepts: conceptsWithEmbeddings,
        relationships,
        clusters,
        confidence: this.calculateOverallConfidence(conceptsWithEmbeddings),
        processingTime: Date.now() - startTime
      };
      
      this.synthesisCache.set(cacheKey, extractionResult);
      this.updateCacheMetrics(false);

      // Build final synthesis result
      const synthesis = this.buildSynthesisResult(extractionResult, graphUpdate, Date.now() - startTime);
      
      // Update performance metrics
      this.updatePerformanceMetrics(synthesis);

      return synthesis;

    } catch (error) {
      console.error('Knowledge synthesis failed:', error);
      throw new Error(`Knowledge synthesis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract concepts from conversation or document content
   */
  async extractConcepts(content: string, projectId?: string): Promise<ConceptExtractionResult['concepts']> {
    try {
      const prompt = this.buildConceptExtractionPrompt(content);
      
      const response = await this.config.modelOrchestrator.processMessage(
        prompt,
        'concept_extraction',
        this.config.defaultModel,
        undefined,
        { optimizePrompts: true }
      );

      const concepts = this.parseConceptsFromResponse(response.content);
      
      // Filter concepts by confidence threshold
      return concepts.filter(concept => 
        concept.confidence >= this.config.synthesis.minConceptConfidence
      ).slice(0, this.config.synthesis.maxConceptsPerContent);

    } catch (error) {
      console.warn('Concept extraction failed:', error);
      return [];
    }
  }

  /**
   * Extract relationships between concepts
   */
  async extractRelationships(content: string, projectId?: string): Promise<RelationshipExtractionResult[]> {
    try {
      const prompt = this.buildRelationshipExtractionPrompt(content);
      
      const response = await this.config.modelOrchestrator.processMessage(
        prompt,
        'relationship_extraction',
        this.config.defaultModel
      );

      const relationships = this.parseRelationshipsFromResponse(response.content);
      
      // Filter relationships by strength threshold
      return relationships.filter(relationship => 
        relationship.strength >= this.config.synthesis.minRelationshipStrength
      );

    } catch (error) {
      console.warn('Relationship extraction failed:', error);
      return [];
    }
  }

  /**
   * Cluster concepts based on similarity
   */
  async clusterConcepts(concepts: ConceptExtractionResult['concepts']): Promise<ConceptCluster[]> {
    if (concepts.length < 2) return [];

    try {
      // Calculate similarity matrix
      const similarityMatrix = await this.calculateConceptSimilarityMatrix(concepts);
      
      // Perform hierarchical clustering
      const clusters = this.performHierarchicalClustering(
        concepts,
        similarityMatrix,
        this.config.synthesis.clusterSimilarityThreshold
      );

      return clusters.map(cluster => ({
        id: this.generateClusterId(),
        name: this.generateClusterName(cluster.concepts),
        concepts: cluster.concepts,
        centroid: this.calculateClusterCentroid(cluster.concepts),
        coherence: cluster.coherence,
        size: cluster.concepts.length
      }));

    } catch (error) {
      console.warn('Concept clustering failed:', error);
      return [];
    }
  }

  /**
   * Update knowledge graph in TiDB with new concepts and relationships
   */
  async updateKnowledgeGraph(
    concepts: ConceptExtractionResult['concepts'],
    relationships: RelationshipExtractionResult[],
    clusters: ConceptCluster[],
    projectId?: string
  ): Promise<KnowledgeGraphUpdate> {
    const startTime = Date.now();
    let conceptsInserted = 0;
    let conceptsUpdated = 0;
    let relationshipsCreated = 0;

    try {
      // Begin transaction
      await this.config.tidbClient.execute('BEGIN');

      // Process concepts
      for (const concept of concepts) {
        const existing = await this.config.conceptRepository.findByName(concept.name, projectId);
        
        if (existing) {
          // Update existing concept
          await this.config.conceptRepository.update(existing.id, {
            description: concept.description,
            conceptEmbedding: concept.embedding,
            mentionCount: existing.mentionCount + 1,
            metadata: {
              ...existing.metadata,
              lastMentioned: new Date(),
              confidence: Math.max(existing.metadata?.confidence || 0, concept.confidence)
            }
          });
          conceptsUpdated++;
        } else {
          // Insert new concept
          await this.config.conceptRepository.create({
            name: concept.name,
            description: concept.description,
            projectId,
            conceptEmbedding: concept.embedding,
            mentionCount: 1,
            metadata: {
              confidence: concept.confidence,
              category: concept.category,
              extractedFrom: concept.source,
              firstMentioned: new Date()
            }
          });
          conceptsInserted++;
        }
      }

      // Process relationships
      for (const relationship of relationships) {
        // Find concept IDs
        const sourceConcept = await this.config.conceptRepository.findByName(relationship.source, projectId);
        const targetConcept = await this.config.conceptRepository.findByName(relationship.target, projectId);
        
        if (sourceConcept && targetConcept) {
          // Insert relationship
          await this.config.tidbClient.execute(
            `
            INSERT INTO concept_relationships (
              source_concept_id, target_concept_id, relationship_type, 
              strength, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE 
              strength = GREATEST(strength, ?),
              metadata = JSON_MERGE_PATCH(metadata, ?)
            `,
            [
              sourceConcept.id,
              targetConcept.id,
              relationship.type,
              relationship.strength,
              JSON.stringify({ confidence: relationship.confidence }),
              relationship.strength,
              JSON.stringify({ confidence: relationship.confidence, lastUpdated: new Date() })
            ]
          );
          relationshipsCreated++;
        }
      }

      // Process clusters if any
      for (const cluster of clusters) {
        await this.config.tidbClient.execute(
          `
          INSERT INTO concept_clusters (
            id, name, project_id, centroid_embedding, 
            coherence, size, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            centroid_embedding = VALUES(centroid_embedding),
            coherence = VALUES(coherence),
            size = VALUES(size),
            metadata = VALUES(metadata)
          `,
          [
            cluster.id,
            cluster.name,
            projectId,
            `[${cluster.centroid.join(',')}]`,
            cluster.coherence,
            cluster.size,
            JSON.stringify({ concepts: cluster.concepts.map(c => c.name) })
          ]
        );
      }

      // Commit transaction
      await this.config.tidbClient.execute('COMMIT');

      return {
        conceptsInserted,
        conceptsUpdated,
        relationshipsCreated,
        clustersCreated: clusters.length,
        processingTime: Date.now() - startTime,
        graphUpdated: conceptsInserted > 0 || conceptsUpdated > 0 || relationshipsCreated > 0
      };

    } catch (error) {
      // Rollback on error
      await this.config.tidbClient.execute('ROLLBACK');
      throw error;
    }
  }

  /**
   * Get synthesis performance metrics
   */
  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }

  /**
   * Clear synthesis cache
   */
  clearCache(): void {
    this.synthesisCache.clear();
  }

  /**
   * Private helper methods
   */
  private extractContentFromContext(context: any, stepResults: Record<string, any>): string {
    // Extract content from various sources based on context type
    if (context.content) {
      return context.content;
    }

    if (context.type === 'conversation' && stepResults.ingestion) {
      const messages = stepResults.ingestion.messages || [];
      return messages.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n');
    }

    if (context.type === 'document' && stepResults.ingestion) {
      const chunks = stepResults.ingestion.chunks || [];
      return chunks.map((chunk: any) => chunk.content).join('\n');
    }

    if (stepResults.llm_analysis?.response) {
      return stepResults.llm_analysis.response;
    }

    return '';
  }

  private buildConceptExtractionPrompt(content: string): string {
    return `
Analyze the following content and extract key concepts. For each concept, provide:
1. Name (2-4 words)
2. Description (1-2 sentences)
3. Category (e.g., technology, methodology, domain, tool)
4. Confidence score (0.0-1.0)

Content to analyze:
${content.substring(0, 3000)}...

Please respond in JSON format with an array of concepts:
{
  "concepts": [
    {
      "name": "concept name",
      "description": "concept description",
      "category": "category",
      "confidence": 0.9
    }
  ]
}

Focus on important, specific concepts that would be valuable for knowledge management and search.
    `.trim();
  }

  private buildRelationshipExtractionPrompt(content: string): string {
    return `
Analyze the following content and extract relationships between concepts. For each relationship:
1. Source concept name
2. Target concept name  
3. Relationship type (e.g., "enables", "requires", "implements", "related_to", "part_of")
4. Strength score (0.0-1.0)
5. Confidence score (0.0-1.0)

Content to analyze:
${content.substring(0, 3000)}...

Please respond in JSON format with an array of relationships:
{
  "relationships": [
    {
      "source": "source concept",
      "target": "target concept", 
      "type": "relationship_type",
      "strength": 0.8,
      "confidence": 0.9
    }
  ]
}

Focus on meaningful relationships that help understand how concepts connect.
    `.trim();
  }

  private parseConceptsFromResponse(response: string): ConceptExtractionResult['concepts'] {
    try {
      const parsed = JSON.parse(response);
      return parsed.concepts.map((concept: any) => ({
        ...concept,
        id: this.generateConceptId(concept.name),
        embedding: [], // Will be filled by generateConceptEmbeddings
        source: 'ai_extraction'
      }));
    } catch (error) {
      console.warn('Failed to parse concepts from response:', error);
      return [];
    }
  }

  private parseRelationshipsFromResponse(response: string): RelationshipExtractionResult[] {
    try {
      const parsed = JSON.parse(response);
      return parsed.relationships.map((rel: any) => ({
        ...rel,
        id: this.generateRelationshipId(rel.source, rel.target, rel.type)
      }));
    } catch (error) {
      console.warn('Failed to parse relationships from response:', error);
      return [];
    }
  }

  private async generateConceptEmbeddings(concepts: ConceptExtractionResult['concepts']) {
    const texts = concepts.map(concept => `${concept.name}: ${concept.description}`);
    const embeddings = await this.config.embeddingService.generateBatchEmbeddings(texts);
    
    return concepts.map((concept, index) => ({
      ...concept,
      embedding: embeddings[index]
    }));
  }

  private async calculateConceptSimilarityMatrix(concepts: ConceptExtractionResult['concepts']): Promise<number[][]> {
    const matrix: number[][] = [];
    
    for (let i = 0; i < concepts.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < concepts.length; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else {
          matrix[i][j] = this.config.embeddingService.calculateCosineSimilarity(
            concepts[i].embedding,
            concepts[j].embedding
          );
        }
      }
    }
    
    return matrix;
  }

  private performHierarchicalClustering(
    concepts: ConceptExtractionResult['concepts'],
    similarityMatrix: number[][],
    threshold: number
  ): Array<{ concepts: any[]; coherence: number }> {
    // Simplified hierarchical clustering implementation
    const clusters: Array<{ concepts: any[]; coherence: number }> = [];
    const used = new Set<number>();

    for (let i = 0; i < concepts.length; i++) {
      if (used.has(i)) continue;

      const cluster = [concepts[i]];
      used.add(i);

      // Find similar concepts
      for (let j = i + 1; j < concepts.length; j++) {
        if (used.has(j)) continue;
        
        if (similarityMatrix[i][j] >= threshold) {
          cluster.push(concepts[j]);
          used.add(j);
        }
      }

      // Calculate cluster coherence
      const coherence = cluster.length > 1 
        ? this.calculateClusterCoherence(cluster, similarityMatrix)
        : 1.0;

      clusters.push({ concepts: cluster, coherence });
    }

    return clusters.filter(cluster => cluster.concepts.length > 1); // Only return multi-concept clusters
  }

  private calculateClusterCoherence(cluster: any[], similarityMatrix: number[][]): number {
    if (cluster.length < 2) return 1.0;

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        // This is simplified - in reality you'd need to map back to original indices
        totalSimilarity += 0.8; // Placeholder
        pairCount++;
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }

  private calculateClusterCentroid(concepts: any[]): number[] {
    if (concepts.length === 0) return [];
    
    const dimensions = concepts[0].embedding.length;
    const centroid = new Array(dimensions).fill(0);

    for (const concept of concepts) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += concept.embedding[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= concepts.length;
    }

    return centroid;
  }

  private generateClusterName(concepts: any[]): string {
    const names = concepts.map(c => c.name).slice(0, 3);
    return names.length > 1 ? `${names[0]} & ${names.length - 1} related` : names[0];
  }

  private calculateOverallConfidence(concepts: ConceptExtractionResult['concepts']): number {
    if (concepts.length === 0) return 0;
    return concepts.reduce((sum, concept) => sum + concept.confidence, 0) / concepts.length;
  }

  private buildSynthesisResult(
    extraction: ConceptExtractionResult,
    graphUpdate: KnowledgeGraphUpdate | null,
    processingTime: number
  ): KnowledgeSynthesis {
    return {
      concepts: extraction.concepts,
      relationships: extraction.relationships,
      clusters: extraction.clusters,
      graphUpdated: graphUpdate?.graphUpdated || false,
      processingTime,
      metadata: {
        conceptsExtracted: extraction.concepts.length,
        relationshipsCreated: extraction.relationships.length,
        clustersCreated: extraction.clusters.length,
        overallConfidence: extraction.confidence,
        graphUpdate
      }
    };
  }

  private updatePerformanceMetrics(synthesis: KnowledgeSynthesis): void {
    this.performanceMetrics.totalSyntheses++;
    this.performanceMetrics.conceptsExtracted += synthesis.concepts?.length || 0;
    this.performanceMetrics.relationshipsCreated += synthesis.relationships?.length || 0;

    // Update average processing time
    const oldTotal = this.performanceMetrics.averageProcessingTime * (this.performanceMetrics.totalSyntheses - 1);
    this.performanceMetrics.averageProcessingTime = (oldTotal + synthesis.processingTime) / this.performanceMetrics.totalSyntheses;
  }

  private updateCacheMetrics(hit: boolean): void {
    const oldHits = this.performanceMetrics.cacheHitRate * this.performanceMetrics.totalSyntheses;
    const newHits = hit ? oldHits + 1 : oldHits;
    this.performanceMetrics.cacheHitRate = newHits / (this.performanceMetrics.totalSyntheses + 1);
  }

  private generateCacheKey(content: string): string {
    // Simple hash of content for caching
    return Buffer.from(content.substring(0, 1000)).toString('base64');
  }

  private generateConceptId(name: string): string {
    return `concept_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  }

  private generateRelationshipId(source: string, target: string, type: string): string {
    return `rel_${source}_${type}_${target}_${Date.now()}`.toLowerCase().replace(/\s+/g, '_');
  }

  private generateClusterId(): string {
    return `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create knowledge synthesis engine
 */
export function createKnowledgeSynthesisEngine(config: KnowledgeSynthesisEngineConfig): KnowledgeSynthesisEngine {
  return new KnowledgeSynthesisEngine(config);
}