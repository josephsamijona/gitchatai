/**
 * Concept Analytics & Intelligence Service
 * SYNAPSE AI Platform - Task 7 Implementation Support
 * 
 * Advanced analytics for knowledge graph concepts and relationships
 * Implements: Concept discovery → Trend analysis → Insight generation → Recommendation system
 */

import { tidbClient } from '../tidb/client';
import { modelOrchestrator } from '../ai/orchestrator';
import { conceptRepository } from '../repositories/concept';
import type {
  Concept,
  ConceptRelationship,
  ConceptTrend,
  ConceptInsight,
  ConceptRecommendation,
  ConceptAnalyticsRequest,
  ConceptAnalyticsResult,
  TopicEvolution,
  ConceptInfluence,
  KnowledgeGap
} from '../../types/knowledge';

/**
 * Concept Analytics Service
 * Provides intelligent analysis of knowledge graph concepts and their evolution
 */
export class ConceptAnalyticsService {
  
  /**
   * Analyze concept trends and evolution over time
   * Tracks how concepts emerge, grow, and connect in the knowledge graph
   */
  async analyzeConceptTrends(projectId: string, timeRange?: { start: Date; end: Date }): Promise<ConceptTrend[]> {
    const query = `
      SELECT 
        c.id,
        c.name,
        c.category,
        c.mention_count,
        c.created_at,
        c.updated_at,
        COUNT(DISTINCT r.id) as relationship_count,
        AVG(r.strength) as avg_relationship_strength
      FROM concepts c
      LEFT JOIN concept_relationships r ON (c.id = r.source_concept OR c.id = r.target_concept)
      WHERE c.project_id = ?
        ${timeRange ? 'AND c.created_at BETWEEN ? AND ?' : ''}
      GROUP BY c.id, c.name, c.category, c.mention_count, c.created_at, c.updated_at
      ORDER BY c.mention_count DESC, relationship_count DESC
    `;

    const params = [projectId];
    if (timeRange) {
      params.push(timeRange.start.toISOString(), timeRange.end.toISOString());
    }

    try {
      const results = await tidbClient.query(query, params);
      
      return results.map((row: any) => ({
        conceptId: row.id,
        name: row.name,
        category: row.category,
        trendType: this.calculateTrendType(row),
        mentionCount: row.mention_count,
        relationshipCount: row.relationship_count,
        averageStrength: row.avg_relationship_strength || 0,
        growthRate: this.calculateGrowthRate(row),
        momentum: this.calculateMomentum(row),
        createdAt: new Date(row.created_at),
        lastUpdated: new Date(row.updated_at)
      }));
    } catch (error) {
      console.error('Failed to analyze concept trends:', error);
      return [];
    }
  }

  /**
   * Generate intelligent insights about concept relationships and knowledge patterns
   * Uses AI to identify meaningful patterns in the knowledge graph
   */
  async generateConceptInsights(projectId: string): Promise<ConceptInsight[]> {
    const concepts = await conceptRepository.getConceptsByProject(projectId, { limit: 100 });
    const relationships = await this.getProjectRelationships(projectId);
    
    const insights: ConceptInsight[] = [];

    // Identify central concepts (high connectivity)
    const centralConcepts = this.identifyCentralConcepts(concepts, relationships);
    if (centralConcepts.length > 0) {
      insights.push({
        type: 'central-concepts',
        title: 'Knowledge Hubs Identified',
        description: `Found ${centralConcepts.length} central concepts that connect many topics together.`,
        concepts: centralConcepts.map(c => c.id),
        confidence: 0.9,
        actionable: true,
        recommendations: [
          'These concepts are key to understanding your domain',
          'Consider expanding on these topics in future conversations',
          'Use these as starting points for knowledge exploration'
        ]
      });
    }

    // Identify isolated concepts (low connectivity)
    const isolatedConcepts = this.identifyIsolatedConcepts(concepts, relationships);
    if (isolatedConcepts.length > 0) {
      insights.push({
        type: 'isolated-concepts',
        title: 'Disconnected Knowledge Areas',
        description: `Found ${isolatedConcepts.length} concepts that are not well connected to other topics.`,
        concepts: isolatedConcepts.map(c => c.id),
        confidence: 0.8,
        actionable: true,
        recommendations: [
          'Consider exploring connections between these and other topics',
          'These might represent emerging or specialized knowledge areas',
          'Look for opportunities to bridge these concepts with existing knowledge'
        ]
      });
    }

    // Identify concept clusters that could be merged
    const mergeCandidates = await this.identifyMergeCandidates(concepts);
    if (mergeCandidates.length > 0) {
      insights.push({
        type: 'merge-candidates',
        title: 'Similar Concepts Detected',
        description: `Found ${mergeCandidates.length} pairs of concepts that might represent the same idea.`,
        concepts: mergeCandidates.flat(),
        confidence: 0.7,
        actionable: true,
        recommendations: [
          'Review these concept pairs for potential consolidation',
          'Merging similar concepts can improve graph clarity',
          'Consider if these represent different aspects of the same topic'
        ]
      });
    }

    // Identify knowledge gaps
    const knowledgeGaps = await this.identifyKnowledgeGaps(concepts, relationships);
    if (knowledgeGaps.length > 0) {
      insights.push({
        type: 'knowledge-gaps',
        title: 'Potential Knowledge Gaps',
        description: `Identified ${knowledgeGaps.length} areas where knowledge might be incomplete.`,
        concepts: knowledgeGaps.map(g => g.relatedConcepts).flat(),
        confidence: 0.6,
        actionable: true,
        recommendations: [
          'These areas might benefit from additional research or conversation',
          'Consider exploring the missing connections between related concepts',
          'Ask AI models about relationships between these topic areas'
        ]
      });
    }

    return insights;
  }

  /**
   * Generate personalized recommendations for knowledge graph expansion
   * Uses AI and pattern analysis to suggest relevant concepts and relationships
   */
  async generateConceptRecommendations(projectId: string): Promise<ConceptRecommendation[]> {
    const concepts = await conceptRepository.getConceptsByProject(projectId);
    const recommendations: ConceptRecommendation[] = [];

    // Analyze concept categories to suggest balanced exploration
    const categoryDistribution = this.analyzeCategoryDistribution(concepts);
    const underrepresentedCategories = this.identifyUnderrepresentedCategories(categoryDistribution);

    for (const category of underrepresentedCategories) {
      recommendations.push({
        type: 'category-expansion',
        title: `Explore ${category} Topics`,
        description: `Your knowledge graph has limited coverage in the ${category} category.`,
        suggestedConcepts: await this.suggestConceptsForCategory(category, concepts),
        priority: 'medium',
        estimatedImpact: 'Improved knowledge diversity and comprehensive coverage',
        actionSteps: [
          `Ask questions about ${category}-related topics`,
          'Upload documents or have conversations in this domain',
          'Look for connections between this category and existing concepts'
        ]
      });
    }

    // Suggest relationship exploration for isolated concepts
    const isolatedConcepts = this.identifyIsolatedConcepts(concepts, []);
    if (isolatedConcepts.length > 0) {
      recommendations.push({
        type: 'relationship-building',
        title: 'Connect Isolated Concepts',
        description: 'Several concepts in your graph have few connections to other topics.',
        suggestedConcepts: isolatedConcepts.map(c => c.name),
        priority: 'high',
        estimatedImpact: 'Better knowledge integration and discovery of hidden relationships',
        actionSteps: [
          'Ask AI models about connections between isolated and popular concepts',
          'Explore how isolated concepts relate to your main topics',
          'Consider broader contexts where these concepts might apply'
        ]
      });
    }

    // Suggest emerging topics based on recent trends
    const emergingTopics = await this.identifyEmergingTopics(projectId);
    if (emergingTopics.length > 0) {
      recommendations.push({
        type: 'emerging-topics',
        title: 'Explore Emerging Topics',
        description: 'New concept areas are emerging in your recent conversations.',
        suggestedConcepts: emergingTopics,
        priority: 'medium',
        estimatedImpact: 'Stay current with evolving knowledge and identify new opportunities',
        actionSteps: [
          'Dive deeper into these emerging topic areas',
          'Look for connections with established concepts',
          'Consider the implications and applications of these new ideas'
        ]
      });
    }

    return recommendations;
  }

  /**
   * Analyze topic evolution over time
   * Tracks how concepts change, grow, and relate to each other across conversations
   */
  async analyzeTopicEvolution(projectId: string): Promise<TopicEvolution[]> {
    const query = `
      SELECT 
        c.name,
        c.category,
        DATE(c.created_at) as date,
        COUNT(*) as daily_mentions,
        AVG(c.confidence) as avg_confidence
      FROM concepts c
      WHERE c.project_id = ?
        AND c.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY c.name, c.category, DATE(c.created_at)
      ORDER BY date ASC, daily_mentions DESC
    `;

    try {
      const results = await tidbClient.query(query, [projectId]);
      
      // Group by concept name to track evolution
      const evolutionMap = new Map<string, TopicEvolution>();
      
      results.forEach((row: any) => {
        const key = row.name;
        if (!evolutionMap.has(key)) {
          evolutionMap.set(key, {
            conceptName: row.name,
            category: row.category,
            timeline: [],
            overallTrend: 'stable',
            peakDate: null,
            totalMentions: 0,
            averageConfidence: 0
          });
        }
        
        const evolution = evolutionMap.get(key)!;
        evolution.timeline.push({
          date: new Date(row.date),
          mentions: row.daily_mentions,
          confidence: row.avg_confidence
        });
        evolution.totalMentions += row.daily_mentions;
      });

      // Calculate trends and peaks
      return Array.from(evolutionMap.values()).map(evolution => {
        evolution.overallTrend = this.calculateOverallTrend(evolution.timeline);
        evolution.peakDate = this.findPeakDate(evolution.timeline);
        evolution.averageConfidence = evolution.timeline.reduce((sum, point) => sum + point.confidence, 0) / evolution.timeline.length;
        return evolution;
      });

    } catch (error) {
      console.error('Failed to analyze topic evolution:', error);
      return [];
    }
  }

  /**
   * Calculate concept influence scores
   * Determines which concepts have the most impact on the knowledge graph
   */
  async calculateConceptInfluence(projectId: string): Promise<ConceptInfluence[]> {
    const concepts = await conceptRepository.getConceptsByProject(projectId);
    const relationships = await this.getProjectRelationships(projectId);
    
    return concepts.map(concept => {
      const directConnections = relationships.filter(r => 
        r.sourceConcept === concept.id || r.targetConcept === concept.id
      );
      
      const indirectInfluence = this.calculateIndirectInfluence(concept.id, relationships);
      const centralityScore = this.calculateCentralityScore(concept.id, relationships);
      const noveltyScore = this.calculateNoveltyScore(concept);
      
      const overallInfluence = (
        directConnections.length * 0.4 +
        indirectInfluence * 0.3 +
        centralityScore * 0.2 +
        noveltyScore * 0.1
      );

      return {
        conceptId: concept.id,
        name: concept.name,
        influenceScore: overallInfluence,
        directConnections: directConnections.length,
        indirectInfluence,
        centralityScore,
        noveltyScore,
        ranking: 0 // Will be set after sorting
      };
    }).sort((a, b) => b.influenceScore - a.influenceScore)
      .map((influence, index) => ({ ...influence, ranking: index + 1 }));
  }

  // Private helper methods

  private calculateTrendType(conceptData: any): 'emerging' | 'growing' | 'stable' | 'declining' {
    const mentionCount = conceptData.mention_count || 0;
    const relationshipCount = conceptData.relationship_count || 0;
    const daysSinceCreation = Math.floor((Date.now() - new Date(conceptData.created_at).getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceCreation <= 7 && mentionCount > 2) return 'emerging';
    if (mentionCount > 5 && relationshipCount > 3) return 'growing';
    if (mentionCount < 2 && relationshipCount < 2) return 'declining';
    return 'stable';
  }

  private calculateGrowthRate(conceptData: any): number {
    // Simplified growth rate calculation
    const mentionCount = conceptData.mention_count || 0;
    const daysSinceCreation = Math.max(1, Math.floor((Date.now() - new Date(conceptData.created_at).getTime()) / (1000 * 60 * 60 * 24)));
    return mentionCount / daysSinceCreation;
  }

  private calculateMomentum(conceptData: any): number {
    // Simplified momentum calculation based on recent activity
    const mentionCount = conceptData.mention_count || 0;
    const relationshipCount = conceptData.relationship_count || 0;
    return (mentionCount * 0.6 + relationshipCount * 0.4) / 10;
  }

  private identifyCentralConcepts(concepts: Concept[], relationships: ConceptRelationship[]): Concept[] {
    return concepts.filter(concept => {
      const connectionCount = relationships.filter(r =>
        r.sourceConcept === concept.id || r.targetConcept === concept.id
      ).length;
      return connectionCount >= 5; // Threshold for "central"
    }).slice(0, 5); // Top 5 most central
  }

  private identifyIsolatedConcepts(concepts: Concept[], relationships: ConceptRelationship[]): Concept[] {
    return concepts.filter(concept => {
      const connectionCount = relationships.filter(r =>
        r.sourceConcept === concept.id || r.targetConcept === concept.id
      ).length;
      return connectionCount <= 1; // Threshold for "isolated"
    });
  }

  private async identifyMergeCandidates(concepts: Concept[]): Promise<string[][]> {
    const mergeCandidates: string[][] = [];
    
    // Find concepts with high semantic similarity
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const concept1 = concepts[i];
        const concept2 = concepts[j];
        
        if (concept1.conceptEmbedding && concept2.conceptEmbedding) {
          const similarity = await this.calculateCosineSimilarity(
            concept1.conceptEmbedding,
            concept2.conceptEmbedding
          );
          
          if (similarity > 0.8) { // High similarity threshold
            mergeCandidates.push([concept1.name, concept2.name]);
          }
        }
      }
    }
    
    return mergeCandidates.slice(0, 10); // Limit to top 10 pairs
  }

  private async identifyKnowledgeGaps(concepts: Concept[], relationships: ConceptRelationship[]): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = [];
    
    // Find concepts that should be related but aren't
    const categories = [...new Set(concepts.map(c => c.category))];
    
    for (const category of categories) {
      const categoryConcepts = concepts.filter(c => c.category === category);
      const categoryRelationships = relationships.filter(r =>
        categoryConcepts.some(c => c.id === r.sourceConcept) &&
        categoryConcepts.some(c => c.id === r.targetConcept)
      );
      
      if (categoryConcepts.length > 2 && categoryRelationships.length < categoryConcepts.length / 2) {
        gaps.push({
          type: 'category-disconnection',
          description: `Concepts in ${category} category are not well connected`,
          relatedConcepts: categoryConcepts.map(c => c.id),
          confidence: 0.7,
          suggestedActions: [
            `Explore relationships between ${category} concepts`,
            'Ask AI models about connections within this domain',
            'Consider broader contexts that connect these topics'
          ]
        });
      }
    }
    
    return gaps;
  }

  private analyzeCategoryDistribution(concepts: Concept[]): Record<string, number> {
    return concepts.reduce((acc, concept) => {
      acc[concept.category] = (acc[concept.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private identifyUnderrepresentedCategories(distribution: Record<string, number>): string[] {
    const totalConcepts = Object.values(distribution).reduce((sum, count) => sum + count, 0);
    const categories = Object.keys(distribution);
    
    return categories.filter(category => {
      const percentage = distribution[category] / totalConcepts;
      return percentage < 0.15; // Less than 15% representation
    });
  }

  private async suggestConceptsForCategory(category: string, existingConcepts: Concept[]): Promise<string[]> {
    // Use AI to suggest concepts for a given category
    const prompt = `Given the category "${category}" and existing concepts: ${existingConcepts.map(c => c.name).join(', ')}, 
    suggest 5 related concepts that would enhance knowledge in this area.`;
    
    try {
      const response = await modelOrchestrator.processMessage(prompt, 'concept-suggestion', 'claude');
      return this.parseConceptSuggestions(response.content);
    } catch (error) {
      console.error('Failed to generate concept suggestions:', error);
      return [];
    }
  }

  private parseConceptSuggestions(aiResponse: string): string[] {
    // Parse AI response to extract concept suggestions
    return aiResponse.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('-') && !line.startsWith('*'))
      .slice(0, 5);
  }

  private async identifyEmergingTopics(projectId: string): Promise<string[]> {
    const query = `
      SELECT name, COUNT(*) as recent_mentions
      FROM concepts
      WHERE project_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY name
      HAVING recent_mentions >= 2
      ORDER BY recent_mentions DESC
      LIMIT 10
    `;

    try {
      const results = await tidbClient.query(query, [projectId]);
      return results.map((row: any) => row.name);
    } catch (error) {
      console.error('Failed to identify emerging topics:', error);
      return [];
    }
  }

  private calculateOverallTrend(timeline: Array<{ date: Date; mentions: number; confidence: number }>): 'emerging' | 'growing' | 'stable' | 'declining' {
    if (timeline.length < 2) return 'stable';
    
    const recent = timeline.slice(-7); // Last 7 data points
    const early = timeline.slice(0, 7); // First 7 data points
    
    const recentAvg = recent.reduce((sum, point) => sum + point.mentions, 0) / recent.length;
    const earlyAvg = early.reduce((sum, point) => sum + point.mentions, 0) / early.length;
    
    if (recentAvg > earlyAvg * 1.5) return 'growing';
    if (recentAvg < earlyAvg * 0.5) return 'declining';
    if (timeline.length <= 7 && recentAvg > 0) return 'emerging';
    return 'stable';
  }

  private findPeakDate(timeline: Array<{ date: Date; mentions: number; confidence: number }>): Date | null {
    if (timeline.length === 0) return null;
    
    const peak = timeline.reduce((max, point) =>
      point.mentions > max.mentions ? point : max
    );
    
    return peak.date;
  }

  private calculateIndirectInfluence(conceptId: string, relationships: ConceptRelationship[]): number {
    // Calculate influence through indirect connections
    const directConnections = relationships.filter(r =>
      r.sourceConcept === conceptId || r.targetConcept === conceptId
    );
    
    let indirectInfluence = 0;
    
    for (const relationship of directConnections) {
      const connectedConceptId = relationship.sourceConcept === conceptId
        ? relationship.targetConcept
        : relationship.sourceConcept;
      
      const secondOrderConnections = relationships.filter(r =>
        (r.sourceConcept === connectedConceptId || r.targetConcept === connectedConceptId) &&
        r.sourceConcept !== conceptId && r.targetConcept !== conceptId
      );
      
      indirectInfluence += secondOrderConnections.length * relationship.strength;
    }
    
    return indirectInfluence;
  }

  private calculateCentralityScore(conceptId: string, relationships: ConceptRelationship[]): number {
    // Calculate betweenness centrality (simplified)
    const directConnections = relationships.filter(r =>
      r.sourceConcept === conceptId || r.targetConcept === conceptId
    );
    
    return directConnections.length;
  }

  private calculateNoveltyScore(concept: Concept): number {
    // Calculate how novel/recent a concept is
    const daysSinceCreation = Math.floor((Date.now() - (concept.createdAt?.getTime() || Date.now())) / (1000 * 60 * 60 * 24));
    return Math.max(0, 1 - daysSinceCreation / 30); // Decreases over 30 days
  }

  private async getProjectRelationships(projectId: string): Promise<ConceptRelationship[]> {
    const query = `
      SELECT * FROM concept_relationships 
      WHERE project_id = ?
      ORDER BY strength DESC
    `;
    
    try {
      const results = await tidbClient.query(query, [projectId]);
      return results.map((row: any) => ({
        id: row.id,
        projectId: row.project_id,
        sourceConcept: row.source_concept,
        targetConcept: row.target_concept,
        relationshipType: row.relationship_type,
        strength: row.strength,
        confidence: row.confidence,
        metadata: JSON.parse(row.metadata || '{}')
      }));
    } catch (error) {
      console.error('Failed to get project relationships:', error);
      return [];
    }
  }

  private async calculateCosineSimilarity(embedding1: number[], embedding2: number[]): Promise<number> {
    const dotProduct = embedding1.reduce((sum, a, i) => sum + a * embedding2[i], 0);
    const magnitude1 = Math.sqrt(embedding1.reduce((sum, a) => sum + a * a, 0));
    const magnitude2 = Math.sqrt(embedding2.reduce((sum, a) => sum + a * a, 0));
    
    return dotProduct / (magnitude1 * magnitude2);
  }
}

// Export singleton instance
export const conceptAnalyticsService = new ConceptAnalyticsService();