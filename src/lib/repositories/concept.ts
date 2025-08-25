/**
 * Concept repository for knowledge graph management
 * Handles concepts, relationships, and graph analytics
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateConceptInput, validateCreateConceptRelationshipInput } from '../utils/validation';
import type { 
  Concept, 
  CreateConceptInput, 
  UpdateConceptInput,
  ConceptRelationship,
  CreateConceptRelationshipInput,
  ConceptWithRelationships,
  KnowledgeGraph,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  KnowledgeCluster,
  ConceptSearchResult,
  ValidationResult,
  VectorSearchResult,
  ConceptRelationshipType
} from '../../types';

export class ConceptRepository extends BaseRepository<Concept, CreateConceptInput, UpdateConceptInput> {
  protected tableName = 'concepts';

  protected validateCreate = validateCreateConceptInput;
  protected validateUpdate = (data: unknown): ValidationResult => {
    // Allow updates to description and confidence score
    return { isValid: true, errors: [], warnings: [] };
  };

  protected mapRowToEntity = (row: any): Concept => {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      conceptEmbedding: this.parseEmbedding(row.concept_embedding),
      mentionCount: row.mention_count || 0,
      confidenceScore: parseFloat(row.confidence_score || '0'),
      createdAt: this.parseDate(row.created_at)
    };
  };

  protected getCreateFields(input: CreateConceptInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      project_id: input.projectId,
      name: input.name,
      description: input.description || null,
      concept_embedding: this.serializeEmbedding([]), // Will be updated with actual embedding
      mention_count: 0,
      confidence_score: input.confidenceScore || 0.5,
      created_at: now
    };
  };

  protected getUpdateFields(input: UpdateConceptInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    if (input.description !== undefined) fields.description = input.description;
    if (input.confidenceScore !== undefined) fields.confidence_score = input.confidenceScore;
    
    return fields;
  };

  /**
   * Update concept embedding
   */
  async updateConceptEmbedding(id: string, embedding: number[]): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET concept_embedding = ? WHERE id = ?`;
    await this.executeQuery(sql, [this.serializeEmbedding(embedding), id]);
  }

  /**
   * Find concepts by project
   */
  async findByProject(projectId: string): Promise<Concept[]> {
    return await this.findBy('project_id', projectId);
  }

  /**
   * Search concepts by similarity
   */
  async searchBySimilarity(
    embedding: number[],
    projectId?: string,
    limit = 20,
    threshold = 0.3
  ): Promise<VectorSearchResult[]> {
    const filters = projectId ? { project_id: projectId } : {};
    
    return await tidbClient.vectorSearch(
      embedding,
      this.tableName,
      'concept_embedding',
      'name',
      filters,
      limit,
      threshold
    );
  }

  /**
   * Find or create concept by name
   */
  async findOrCreate(input: CreateConceptInput): Promise<Concept> {
    try {
      // Try to find existing concept with same name in project
      const existingSql = `SELECT * FROM ${this.tableName} WHERE project_id = ? AND LOWER(name) = LOWER(?)`;
      const existingResult = await this.executeQuery(existingSql, [input.projectId, input.name]);
      
      if (existingResult.rows.length > 0) {
        const concept = this.mapRowToEntity(existingResult.rows[0]);
        
        // Update mention count
        await this.incrementMentionCount(concept.id);
        
        return concept;
      }

      // Create new concept
      return await this.create(input);
    } catch (error) {
      throw new Error(`Failed to find or create concept: ${error}`);
    }
  }

  /**
   * Increment mention count for a concept
   */
  async incrementMentionCount(id: string): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET mention_count = mention_count + 1 WHERE id = ?`;
    await this.executeQuery(sql, [id]);
  }

  /**
   * Get concept with all relationships
   */
  async findWithRelationships(id: string): Promise<ConceptWithRelationships> {
    try {
      const concept = await this.findById(id);
      
      // Get outgoing relationships (where this concept is source)
      const outgoingSql = `
        SELECT 
          cr.*,
          c.id as target_id,
          c.name as target_name,
          c.description as target_description
        FROM concept_relationships cr
        JOIN concepts c ON cr.target_concept_id = c.id
        WHERE cr.source_concept_id = ?
        ORDER BY cr.strength DESC
      `;
      
      const outgoingResult = await this.executeQuery(outgoingSql, [id]);
      const outgoingRelationships = outgoingResult.rows.map(row => ({
        id: row.id,
        sourceConceptId: row.source_concept_id,
        targetConceptId: row.target_concept_id,
        relationshipType: row.relationship_type as ConceptRelationshipType,
        strength: parseFloat(row.strength),
        createdAt: this.parseDate(row.created_at),
        targetConcept: {
          id: row.target_id,
          name: row.target_name,
          description: row.target_description
        }
      }));

      // Get incoming relationships (where this concept is target)
      const incomingSql = `
        SELECT 
          cr.*,
          c.id as source_id,
          c.name as source_name,
          c.description as source_description
        FROM concept_relationships cr
        JOIN concepts c ON cr.source_concept_id = c.id
        WHERE cr.target_concept_id = ?
        ORDER BY cr.strength DESC
      `;
      
      const incomingResult = await this.executeQuery(incomingSql, [id]);
      const incomingRelationships = incomingResult.rows.map(row => ({
        id: row.id,
        sourceConceptId: row.source_concept_id,
        targetConceptId: row.target_concept_id,
        relationshipType: row.relationship_type as ConceptRelationshipType,
        strength: parseFloat(row.strength),
        createdAt: this.parseDate(row.created_at),
        sourceConcept: {
          id: row.source_id,
          name: row.source_name,
          description: row.source_description
        }
      }));

      return {
        ...concept,
        outgoingRelationships,
        incomingRelationships
      };
    } catch (error) {
      throw new Error(`Failed to find concept with relationships: ${error}`);
    }
  }

  /**
   * Create relationship between concepts
   */
  async createRelationship(input: CreateConceptRelationshipInput): Promise<ConceptRelationship> {
    try {
      // Validate input
      const validation = validateCreateConceptRelationshipInput(input);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Check if relationship already exists
      const existingSQL = `
        SELECT * FROM concept_relationships 
        WHERE source_concept_id = ? AND target_concept_id = ? AND relationship_type = ?
      `;
      const existingResult = await this.executeQuery(existingSQL, [
        input.sourceConceptId, 
        input.targetConceptId, 
        input.relationshipType
      ]);

      if (existingResult.rows.length > 0) {
        // Update existing relationship strength
        const id = existingResult.rows[0].id;
        const newStrength = Math.max(existingResult.rows[0].strength, input.strength || 0.5);
        
        const updateSQL = `UPDATE concept_relationships SET strength = ? WHERE id = ?`;
        await this.executeQuery(updateSQL, [newStrength, id]);
        
        return {
          id,
          sourceConceptId: input.sourceConceptId,
          targetConceptId: input.targetConceptId,
          relationshipType: input.relationshipType,
          strength: newStrength,
          createdAt: this.parseDate(existingResult.rows[0].created_at)
        };
      }

      // Create new relationship
      const id = crypto.randomUUID();
      const now = new Date();
      
      const insertSQL = `
        INSERT INTO concept_relationships (
          id, source_concept_id, target_concept_id, relationship_type, strength, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      await this.executeQuery(insertSQL, [
        id,
        input.sourceConceptId,
        input.targetConceptId,
        input.relationshipType,
        input.strength || 0.5,
        now
      ]);

      return {
        id,
        sourceConceptId: input.sourceConceptId,
        targetConceptId: input.targetConceptId,
        relationshipType: input.relationshipType,
        strength: input.strength || 0.5,
        createdAt: now
      };
    } catch (error) {
      throw new Error(`Failed to create concept relationship: ${error}`);
    }
  }

  /**
   * Get knowledge graph for project
   */
  async getKnowledgeGraph(projectId: string): Promise<KnowledgeGraph> {
    try {
      // Get all concepts for the project
      const conceptsSQL = `SELECT * FROM ${this.tableName} WHERE project_id = ? ORDER BY mention_count DESC`;
      const conceptsResult = await this.executeQuery(conceptsSQL, [projectId]);
      const concepts = conceptsResult.rows.map(row => this.mapRowToEntity(row));

      // Get all relationships between these concepts
      const relationshipsSQL = `
        SELECT cr.* 
        FROM concept_relationships cr
        JOIN concepts c1 ON cr.source_concept_id = c1.id
        JOIN concepts c2 ON cr.target_concept_id = c2.id
        WHERE c1.project_id = ? AND c2.project_id = ?
        ORDER BY cr.strength DESC
      `;
      
      const relationshipsResult = await this.executeQuery(relationshipsSQL, [projectId, projectId]);
      const relationships = relationshipsResult.rows.map(row => ({
        id: row.id,
        sourceConceptId: row.source_concept_id,
        targetConceptId: row.target_concept_id,
        relationshipType: row.relationship_type as ConceptRelationshipType,
        strength: parseFloat(row.strength),
        createdAt: this.parseDate(row.created_at)
      }));

      // Convert to graph nodes and edges
      const nodes: KnowledgeGraphNode[] = concepts.map(concept => ({
        id: concept.id,
        name: concept.name,
        description: concept.description,
        mentionCount: concept.mentionCount,
        confidenceScore: concept.confidenceScore,
        size: Math.log(concept.mentionCount + 1) * 10, // Logarithmic scaling for visualization
        color: this.getConceptColor(concept.mentionCount),
        position: { x: 0, y: 0, z: 0 } // Will be calculated by layout algorithm
      }));

      const edges: KnowledgeGraphEdge[] = relationships.map(rel => ({
        id: rel.id,
        source: rel.sourceConceptId,
        target: rel.targetConceptId,
        relationshipType: rel.relationshipType,
        strength: rel.strength,
        color: this.getRelationshipColor(rel.relationshipType),
        width: rel.strength * 5 // Scale line width by strength
      }));

      return {
        projectId,
        nodes,
        edges,
        clusters: await this.calculateClusters(concepts, relationships),
        statistics: {
          totalConcepts: concepts.length,
          totalRelationships: relationships.length,
          averageConnections: relationships.length > 0 ? (relationships.length * 2) / concepts.length : 0,
          strongRelationships: relationships.filter(r => r.strength > 0.7).length,
          conceptsByMentions: concepts.reduce((acc, c) => {
            const bracket = Math.floor(c.mentionCount / 5) * 5;
            acc[`${bracket}-${bracket + 4}`] = (acc[`${bracket}-${bracket + 4}`] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        }
      };
    } catch (error) {
      throw new Error(`Failed to get knowledge graph: ${error}`);
    }
  }

  /**
   * Calculate concept clusters for knowledge graph visualization
   */
  private async calculateClusters(
    concepts: Concept[], 
    relationships: ConceptRelationship[]
  ): Promise<KnowledgeCluster[]> {
    try {
      // Simple clustering based on relationship strength and types
      const clusters: KnowledgeCluster[] = [];
      const clustered = new Set<string>();
      let clusterId = 0;

      for (const concept of concepts) {
        if (clustered.has(concept.id)) continue;

        const cluster: KnowledgeCluster = {
          id: `cluster-${clusterId++}`,
          name: `Cluster around "${concept.name}"`,
          conceptIds: [concept.id],
          centerConcept: concept.id,
          avgConfidenceScore: concept.confidenceScore,
          color: this.getClusterColor(clusterId)
        };

        clustered.add(concept.id);

        // Find strongly related concepts
        const strongRelationships = relationships.filter(r => 
          (r.sourceConceptId === concept.id || r.targetConceptId === concept.id) && 
          r.strength > 0.6
        );

        for (const rel of strongRelationships) {
          const relatedId = rel.sourceConceptId === concept.id 
            ? rel.targetConceptId 
            : rel.sourceConceptId;
            
          if (!clustered.has(relatedId)) {
            cluster.conceptIds.push(relatedId);
            clustered.add(relatedId);
            
            const relatedConcept = concepts.find(c => c.id === relatedId);
            if (relatedConcept) {
              cluster.avgConfidenceScore = 
                (cluster.avgConfidenceScore * (cluster.conceptIds.length - 1) + relatedConcept.confidenceScore) 
                / cluster.conceptIds.length;
            }
          }
        }

        if (cluster.conceptIds.length > 1) {
          clusters.push(cluster);
        }
      }

      return clusters;
    } catch (error) {
      console.error('Failed to calculate clusters:', error);
      return [];
    }
  }

  /**
   * Get concept color based on mention count
   */
  private getConceptColor(mentionCount: number): string {
    if (mentionCount > 20) return '#e74c3c'; // Red for highly mentioned
    if (mentionCount > 10) return '#f39c12'; // Orange for moderately mentioned
    if (mentionCount > 5) return '#f1c40f';  // Yellow for somewhat mentioned
    return '#3498db'; // Blue for rarely mentioned
  }

  /**
   * Get relationship color based on type
   */
  private getRelationshipColor(type: ConceptRelationshipType): string {
    const colors = {
      'related': '#95a5a6',    // Gray
      'parent': '#2ecc71',     // Green
      'child': '#27ae60',      // Dark green
      'similar': '#3498db',    // Blue
      'opposite': '#e74c3c',   // Red
      'causes': '#9b59b6',     // Purple
      'enables': '#1abc9c'     // Teal
    };
    return colors[type] || '#95a5a6';
  }

  /**
   * Get cluster color
   */
  private getClusterColor(clusterId: number): string {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', 
      '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'
    ];
    return colors[clusterId % colors.length];
  }

  /**
   * Find concepts that should be merged (high similarity)
   */
  async findSimilarConcepts(
    projectId: string,
    threshold = 0.9
  ): Promise<Array<{ concept1: Concept; concept2: Concept; similarity: number }>> {
    try {
      const concepts = await this.findByProject(projectId);
      const similarities: Array<{ concept1: Concept; concept2: Concept; similarity: number }> = [];

      // Compare each concept with every other concept
      for (let i = 0; i < concepts.length; i++) {
        for (let j = i + 1; j < concepts.length; j++) {
          const concept1 = concepts[i];
          const concept2 = concepts[j];

          // Calculate vector similarity
          const similarity = await this.calculateSimilarity(
            concept1.conceptEmbedding, 
            concept2.conceptEmbedding
          );

          if (similarity > threshold) {
            similarities.push({
              concept1,
              concept2,
              similarity
            });
          }
        }
      }

      return similarities.sort((a, b) => b.similarity - a.similarity);
    } catch (error) {
      throw new Error(`Failed to find similar concepts: ${error}`);
    }
  }

  /**
   * Calculate similarity between two embedding vectors
   */
  private async calculateSimilarity(embedding1: number[], embedding2: number[]): Promise<number> {
    try {
      const sql = `SELECT 1 - VEC_COSINE_DISTANCE(?, ?) as similarity`;
      const result = await this.executeQuery(sql, [
        JSON.stringify(embedding1),
        JSON.stringify(embedding2)
      ]);
      
      return parseFloat(result.rows[0].similarity);
    } catch (error) {
      return 0; // Return 0 if calculation fails
    }
  }

  /**
   * Get concept analytics for project
   */
  async getConceptAnalytics(projectId: string): Promise<{
    totalConcepts: number;
    averageMentions: number;
    topConcepts: Array<{ name: string; mentions: number; confidence: number }>;
    relationshipTypes: Record<ConceptRelationshipType, number>;
    conceptGrowthByDay: Array<{ date: string; count: number }>;
    confidenceDistribution: Record<string, number>;
  }> {
    try {
      const concepts = await this.findByProject(projectId);

      // Basic statistics
      const totalConcepts = concepts.length;
      const averageMentions = concepts.reduce((sum, c) => sum + c.mentionCount, 0) / totalConcepts;

      // Top concepts by mentions
      const topConcepts = concepts
        .sort((a, b) => b.mentionCount - a.mentionCount)
        .slice(0, 10)
        .map(c => ({
          name: c.name,
          mentions: c.mentionCount,
          confidence: c.confidenceScore
        }));

      // Relationship type distribution
      const relationshipsSQL = `
        SELECT cr.relationship_type, COUNT(*) as count
        FROM concept_relationships cr
        JOIN concepts c1 ON cr.source_concept_id = c1.id
        WHERE c1.project_id = ?
        GROUP BY cr.relationship_type
      `;
      
      const relationshipsResult = await this.executeQuery(relationshipsSQL, [projectId]);
      const relationshipTypes = relationshipsResult.rows.reduce((acc, row) => {
        acc[row.relationship_type as ConceptRelationshipType] = row.count;
        return acc;
      }, {} as Record<ConceptRelationshipType, number>);

      // Concept growth by day
      const growthSQL = `
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM ${this.tableName}
        WHERE project_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;
      
      const growthResult = await this.executeQuery(growthSQL, [projectId]);
      const conceptGrowthByDay = growthResult.rows.map(row => ({
        date: row.date,
        count: row.count
      }));

      // Confidence score distribution
      const confidenceDistribution = concepts.reduce((acc, c) => {
        const bucket = Math.floor(c.confidenceScore * 10) / 10;
        const key = `${bucket.toFixed(1)}-${(bucket + 0.1).toFixed(1)}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalConcepts,
        averageMentions,
        topConcepts,
        relationshipTypes,
        conceptGrowthByDay,
        confidenceDistribution
      };
    } catch (error) {
      throw new Error(`Failed to get concept analytics: ${error}`);
    }
  }

  /**
   * Delete concept and all its relationships
   */
  async deleteWithRelationships(id: string): Promise<void> {
    try {
      // Delete relationships first
      await this.executeQuery('DELETE FROM concept_relationships WHERE source_concept_id = ? OR target_concept_id = ?', [id, id]);
      
      // Delete concept
      await this.delete(id);
    } catch (error) {
      throw new Error(`Failed to delete concept with relationships: ${error}`);
    }
  }
}