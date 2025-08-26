/**
 * Branch Merging Service - AI-powered conflict resolution for branch merging
 * Advanced merge strategies with intelligent conflict detection and resolution
 */

import { branchingService } from './branching';
import { workspaceService } from './workspace';
import { embeddings } from '../ai/embeddings';
import { ModelOrchestrator } from '../ai/orchestrator';
import type {
  Branch,
  BranchMergeConfig,
  BranchMergeResult,
  BranchConflict,
  BranchComparison,
  Message,
  AIModel
} from '../../types';

export interface AdvancedMergeConfig extends BranchMergeConfig {
  semanticMerging: boolean;
  preserveIndividualPerspectives: boolean;
  conflictResolutionModel: AIModel;
  mergeSummaryModel: AIModel;
  customMergeInstructions: string;
  qualityThreshold: number;
}

export interface MergePreview {
  targetBranch: Branch;
  sourceBranch: Branch;
  predictedConflicts: BranchConflict[];
  mergeComplexity: 'simple' | 'moderate' | 'complex';
  estimatedTime: number;
  recommendedStrategy: BranchMergeConfig['strategy'];
  potentialIssues: string[];
  mergeableScore: number;
}

export interface ConflictResolution {
  conflictId: string;
  conflictType: BranchConflict['type'];
  originalContent: string;
  alternativeContent: string;
  resolvedContent: string;
  resolutionStrategy: 'ai_synthesis' | 'preference_target' | 'preference_source' | 'manual';
  confidence: number;
  reasoning: string;
  preservedElements: string[];
}

export class BranchMergingService {
  private orchestrator: ModelOrchestrator;

  constructor() {
    this.orchestrator = new ModelOrchestrator();
  }

  /**
   * Generate detailed merge preview
   */
  async generateMergePreview(
    targetBranchId: string,
    sourceBranchId: string,
    config: Partial<AdvancedMergeConfig> = {}
  ): Promise<MergePreview> {
    try {
      // Get branch comparison
      const comparison = await branchingService.compareBranches(targetBranchId, sourceBranchId);
      
      // Predict conflicts using AI analysis
      const predictedConflicts = await this.predictConflicts(
        targetBranchId,
        sourceBranchId,
        comparison
      );

      // Assess merge complexity
      const mergeComplexity = this.assessMergeComplexity(comparison, predictedConflicts);
      
      // Estimate time based on complexity and conflict count
      const estimatedTime = this.estimateMergeTime(mergeComplexity, predictedConflicts.length);
      
      // Recommend strategy
      const recommendedStrategy = this.recommendMergeStrategy(
        comparison,
        predictedConflicts,
        config.semanticMerging || false
      );

      // Identify potential issues
      const potentialIssues = this.identifyPotentialIssues(comparison, predictedConflicts);
      
      // Calculate mergeability score
      const mergeableScore = this.calculateMergeabilityScore(comparison, predictedConflicts);

      return {
        targetBranch: comparison.branch1 as any, // Type assertion for demo
        sourceBranch: comparison.branch2 as any,
        predictedConflicts,
        mergeComplexity,
        estimatedTime,
        recommendedStrategy,
        potentialIssues,
        mergeableScore
      };

    } catch (error) {
      console.error('Failed to generate merge preview:', error);
      throw new Error('Failed to generate merge preview');
    }
  }

  /**
   * Execute intelligent merge with AI-powered conflict resolution
   */
  async executeIntelligentMerge(
    targetBranchId: string,
    sourceBranchId: string,
    config: AdvancedMergeConfig,
    userId: string
  ): Promise<BranchMergeResult & {
    resolutions: ConflictResolution[];
    mergeSummary: string;
    qualityScore: number;
    preservedPerspectives: string[];
  }> {
    try {
      const startTime = Date.now();

      // Generate merge preview
      const preview = await this.generateMergePreview(targetBranchId, sourceBranchId, config);
      
      // If merge complexity is too high, recommend manual review
      if (preview.mergeComplexity === 'complex' && preview.mergeableScore < config.qualityThreshold) {
        throw new Error(`Merge complexity too high (score: ${preview.mergeableScore}). Manual review recommended.`);
      }

      // Get messages from both branches
      const [targetMessages, sourceMessages] = await Promise.all([
        this.getBranchMessages(targetBranchId),
        this.getBranchMessages(sourceBranchId)
      ]);

      // Detect actual conflicts
      const conflicts = await this.detectDetailedConflicts(
        targetMessages,
        sourceMessages,
        config.semanticMerging
      );

      // Resolve conflicts with AI
      const resolutions = await this.resolveConflictsWithAI(
        conflicts,
        config,
        targetMessages,
        sourceMessages
      );

      // Create merged content
      const mergedMessages = await this.createMergedContent(
        targetMessages,
        sourceMessages,
        resolutions,
        config
      );

      // Execute the basic merge
      const basicResult = await branchingService.mergeBranches(
        targetBranchId,
        sourceBranchId,
        config,
        userId
      );

      // Generate AI-powered merge summary
      const mergeSummary = await this.generateMergeSummary(
        targetMessages,
        sourceMessages,
        mergedMessages,
        resolutions,
        config.mergeSummaryModel
      );

      // Calculate quality score
      const qualityScore = this.calculateMergeQuality(
        targetMessages,
        sourceMessages,
        mergedMessages,
        resolutions
      );

      // Extract preserved perspectives
      const preservedPerspectives = this.extractPreservedPerspectives(
        resolutions,
        config.preserveIndividualPerspectives
      );

      const result = {
        ...basicResult,
        resolutions,
        mergeSummary,
        qualityScore,
        preservedPerspectives,
        processingTime: Date.now() - startTime
      };

      // Log advanced merge activity
      await workspaceService.logActivity(
        'project-id', // Would get from branch
        userId,
        'intelligent_merge_completed',
        {
          targetBranchId,
          sourceBranchId,
          mergedBranchId: result.mergedBranchId,
          conflictsResolved: resolutions.length,
          qualityScore,
          mergeStrategy: config.strategy,
          aiModel: config.conflictResolutionModel,
          processingTime: result.processingTime
        }
      );

      return result;

    } catch (error) {
      console.error('Intelligent merge failed:', error);
      throw new Error(`Intelligent merge failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolve specific conflict with AI guidance
   */
  async resolveConflictWithAI(
    conflict: BranchConflict,
    context: {
      targetMessages: Message[];
      sourceMessages: Message[];
      userInstructions?: string;
    },
    model: AIModel = 'claude'
  ): Promise<ConflictResolution> {
    try {
      const prompt = this.buildConflictResolutionPrompt(conflict, context);
      
      const response = await this.orchestrator.processMessage(
        prompt,
        'conflict-resolution-branch',
        model,
        {
          type: 'conflict_resolution',
          conflictId: conflict.messageId || this.generateId(),
          targetContent: conflict.targetContent,
          sourceContent: conflict.sourceContent
        }
      );

      // Parse AI response to extract resolution
      const resolution = this.parseConflictResolution(response.content, conflict);
      
      return resolution;

    } catch (error) {
      console.error('AI conflict resolution failed:', error);
      
      // Fallback to simple resolution
      return {
        conflictId: conflict.messageId || this.generateId(),
        conflictType: conflict.type,
        originalContent: conflict.targetContent,
        alternativeContent: conflict.sourceContent,
        resolvedContent: conflict.targetContent, // Default to target
        resolutionStrategy: 'preference_target',
        confidence: 0.5,
        reasoning: 'AI resolution failed, defaulted to target content',
        preservedElements: []
      };
    }
  }

  /**
   * Get merge recommendations based on conversation context
   */
  async getMergeRecommendations(
    targetBranchId: string,
    sourceBranchId: string
  ): Promise<{
    strategy: BranchMergeConfig['strategy'];
    reasoning: string;
    alternativeStrategies: Array<{
      strategy: BranchMergeConfig['strategy'];
      pros: string[];
      cons: string[];
    }>;
    aiModelRecommendations: {
      forConflictResolution: AIModel;
      forSummary: AIModel;
      reasoning: string;
    };
  }> {
    try {
      const comparison = await branchingService.compareBranches(targetBranchId, sourceBranchId);
      
      // Analyze conversation patterns
      const [targetMessages, sourceMessages] = await Promise.all([
        this.getBranchMessages(targetBranchId),
        this.getBranchMessages(sourceBranchId)
      ]);

      const analysis = this.analyzeConversationPatterns(targetMessages, sourceMessages);
      
      // Primary recommendation
      const strategy = this.recommendMergeStrategy(comparison, [], analysis.semanticMerging);
      const reasoning = this.explainStrategyChoice(strategy, analysis, comparison);
      
      // Alternative strategies
      const alternativeStrategies = this.getAlternativeStrategies(strategy, analysis);
      
      // AI model recommendations
      const aiModelRecommendations = this.recommendAIModels(analysis, comparison);

      return {
        strategy,
        reasoning,
        alternativeStrategies,
        aiModelRecommendations
      };

    } catch (error) {
      console.error('Failed to get merge recommendations:', error);
      throw new Error('Failed to get merge recommendations');
    }
  }

  // Private helper methods

  private async predictConflicts(
    targetBranchId: string,
    sourceBranchId: string,
    comparison: BranchComparison
  ): Promise<BranchConflict[]> {
    const conflicts: BranchConflict[] = [];
    
    // Predict based on modified messages
    for (const modification of comparison.differences.modifiedMessages) {
      conflicts.push({
        type: 'content_conflict',
        messageId: modification.original.id,
        targetContent: modification.original.content,
        sourceContent: modification.modified.content,
        conflictReason: 'Content differs between branches',
        resolution: 'ai_synthesis'
      });
    }

    // Predict model conflicts
    if (comparison.differences.modelChanges) {
      conflicts.push({
        type: 'model_conflict',
        messageId: 'branch-model',
        targetContent: comparison.differences.modelChanges.from,
        sourceContent: comparison.differences.modelChanges.to,
        conflictReason: 'Different AI models used',
        resolution: 'ai_synthesis'
      });
    }

    return conflicts;
  }

  private assessMergeComplexity(
    comparison: BranchComparison,
    conflicts: BranchConflict[]
  ): 'simple' | 'moderate' | 'complex' {
    if (conflicts.length === 0 && comparison.similarity > 0.8) {
      return 'simple';
    } else if (conflicts.length <= 3 && comparison.similarity > 0.6) {
      return 'moderate';
    } else {
      return 'complex';
    }
  }

  private estimateMergeTime(
    complexity: 'simple' | 'moderate' | 'complex',
    conflictCount: number
  ): number {
    const baseTime = {
      simple: 30,
      moderate: 120,
      complex: 300
    };

    return baseTime[complexity] + (conflictCount * 30); // 30 seconds per conflict
  }

  private recommendMergeStrategy(
    comparison: BranchComparison,
    conflicts: BranchConflict[],
    semanticMerging: boolean = false
  ): BranchMergeConfig['strategy'] {
    if (conflicts.length === 0) {
      return 'chronological';
    } else if (conflicts.length <= 2 && semanticMerging) {
      return 'ai_synthesis';
    } else {
      return 'manual';
    }
  }

  private identifyPotentialIssues(
    comparison: BranchComparison,
    conflicts: BranchConflict[]
  ): string[] {
    const issues: string[] = [];
    
    if (comparison.similarity < 0.5) {
      issues.push('Branches have diverged significantly');
    }
    
    if (conflicts.some(c => c.type === 'model_conflict')) {
      issues.push('Different AI models may have conflicting response styles');
    }
    
    if (comparison.differences.addedMessages.length > 10) {
      issues.push('Large number of new messages may complicate merge');
    }
    
    return issues;
  }

  private calculateMergeabilityScore(
    comparison: BranchComparison,
    conflicts: BranchConflict[]
  ): number {
    let score = comparison.similarity;
    
    // Reduce score based on conflicts
    score -= (conflicts.length * 0.1);
    
    // Reduce score based on complexity
    if (comparison.differences.modelChanges) {
      score -= 0.2;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  private async getBranchMessages(branchId: string): Promise<Message[]> {
    const result = await branchingService.switchToBranch(branchId, 'system');
    return result.messages;
  }

  private async detectDetailedConflicts(
    targetMessages: Message[],
    sourceMessages: Message[],
    semanticMerging: boolean
  ): Promise<BranchConflict[]> {
    const conflicts: BranchConflict[] = [];
    
    // Content conflicts
    const targetMap = new Map(targetMessages.map(m => [m.id, m]));
    const sourceMap = new Map(sourceMessages.map(m => [m.id, m]));
    
    for (const [id, targetMsg] of targetMap) {
      const sourceMsg = sourceMap.get(id);
      if (sourceMsg && targetMsg.content !== sourceMsg.content) {
        conflicts.push({
          type: 'content_conflict',
          messageId: id,
          targetContent: targetMsg.content,
          sourceContent: sourceMsg.content,
          conflictReason: 'Message content differs',
          resolution: semanticMerging ? 'ai_synthesis' : 'manual'
        });
      }
    }
    
    return conflicts;
  }

  private async resolveConflictsWithAI(
    conflicts: BranchConflict[],
    config: AdvancedMergeConfig,
    targetMessages: Message[],
    sourceMessages: Message[]
  ): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = [];
    
    for (const conflict of conflicts) {
      const resolution = await this.resolveConflictWithAI(
        conflict,
        { targetMessages, sourceMessages, userInstructions: config.customMergeInstructions },
        config.conflictResolutionModel
      );
      resolutions.push(resolution);
    }
    
    return resolutions;
  }

  private async createMergedContent(
    targetMessages: Message[],
    sourceMessages: Message[],
    resolutions: ConflictResolution[],
    config: AdvancedMergeConfig
  ): Promise<Message[]> {
    // Apply resolutions to create merged content
    const mergedMessages = [...targetMessages];
    
    for (const resolution of resolutions) {
      const messageIndex = mergedMessages.findIndex(m => m.id === resolution.conflictId);
      if (messageIndex !== -1) {
        mergedMessages[messageIndex] = {
          ...mergedMessages[messageIndex],
          content: resolution.resolvedContent,
          metadata: {
            ...mergedMessages[messageIndex].metadata,
            mergeResolution: {
              strategy: resolution.resolutionStrategy,
              confidence: resolution.confidence,
              reasoning: resolution.reasoning
            }
          }
        };
      }
    }
    
    return mergedMessages;
  }

  private buildConflictResolutionPrompt(
    conflict: BranchConflict,
    context: { targetMessages: Message[]; sourceMessages: Message[]; userInstructions?: string }
  ): string {
    return `You are an AI assistant helping to resolve a merge conflict in a conversation branch.

CONFLICT DETAILS:
- Type: ${conflict.type}
- Reason: ${conflict.conflictReason}

TARGET CONTENT:
${conflict.targetContent}

SOURCE CONTENT:
${conflict.sourceContent}

CONTEXT:
Recent messages from target branch: ${context.targetMessages.slice(-3).map(m => m.content).join('\n')}
Recent messages from source branch: ${context.sourceMessages.slice(-3).map(m => m.content).join('\n')}

${context.userInstructions ? `USER INSTRUCTIONS: ${context.userInstructions}` : ''}

Please provide a resolved version that:
1. Preserves the key information from both versions
2. Maintains conversational flow
3. Resolves any contradictions intelligently
4. Provides a brief explanation of your resolution strategy

Format your response as:
RESOLVED_CONTENT: [your resolved version]
REASONING: [explanation of your approach]
CONFIDENCE: [0-1 score for how confident you are]
PRESERVED_ELEMENTS: [key elements you preserved from each version]`;
  }

  private parseConflictResolution(aiResponse: string, conflict: BranchConflict): ConflictResolution {
    // Parse AI response to extract structured resolution
    const resolvedContentMatch = aiResponse.match(/RESOLVED_CONTENT:\s*(.*?)(?=REASONING:|$)/s);
    const reasoningMatch = aiResponse.match(/REASONING:\s*(.*?)(?=CONFIDENCE:|$)/s);
    const confidenceMatch = aiResponse.match(/CONFIDENCE:\s*([\d.]+)/);
    const preservedMatch = aiResponse.match(/PRESERVED_ELEMENTS:\s*(.*?)$/s);

    return {
      conflictId: conflict.messageId || this.generateId(),
      conflictType: conflict.type,
      originalContent: conflict.targetContent,
      alternativeContent: conflict.sourceContent,
      resolvedContent: resolvedContentMatch?.[1]?.trim() || conflict.targetContent,
      resolutionStrategy: 'ai_synthesis',
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7,
      reasoning: reasoningMatch?.[1]?.trim() || 'AI synthesis of conflicting content',
      preservedElements: preservedMatch?.[1]?.split(',').map(e => e.trim()) || []
    };
  }

  private async generateMergeSummary(
    targetMessages: Message[],
    sourceMessages: Message[],
    mergedMessages: Message[],
    resolutions: ConflictResolution[],
    model: AIModel
  ): Promise<string> {
    const prompt = `Generate a concise summary of a branch merge operation:

TARGET BRANCH: ${targetMessages.length} messages
SOURCE BRANCH: ${sourceMessages.length} messages  
MERGED RESULT: ${mergedMessages.length} messages
CONFLICTS RESOLVED: ${resolutions.length}

Key resolutions:
${resolutions.map(r => `- ${r.conflictType}: ${r.reasoning}`).join('\n')}

Provide a 2-3 sentence summary of what was merged and the key outcomes.`;

    try {
      const response = await this.orchestrator.processMessage(
        prompt,
        'merge-summary-branch',
        model
      );
      return response.content;
    } catch (error) {
      return `Merged ${sourceMessages.length} messages from source branch with ${resolutions.length} conflicts resolved.`;
    }
  }

  private calculateMergeQuality(
    targetMessages: Message[],
    sourceMessages: Message[],
    mergedMessages: Message[],
    resolutions: ConflictResolution[]
  ): number {
    // Simple quality calculation based on various factors
    let score = 0.8; // Base score
    
    // Higher confidence resolutions increase quality
    const avgConfidence = resolutions.reduce((sum, r) => sum + r.confidence, 0) / resolutions.length;
    score += (avgConfidence - 0.5) * 0.3;
    
    // Penalty for unresolved conflicts
    const unresolvedConflicts = resolutions.filter(r => r.confidence < 0.5).length;
    score -= unresolvedConflicts * 0.1;
    
    return Math.max(0, Math.min(1, score));
  }

  private extractPreservedPerspectives(
    resolutions: ConflictResolution[],
    preserveIndividualPerspectives: boolean
  ): string[] {
    if (!preserveIndividualPerspectives) return [];
    
    return resolutions
      .flatMap(r => r.preservedElements)
      .filter((elem, index, arr) => arr.indexOf(elem) === index);
  }

  private analyzeConversationPatterns(
    targetMessages: Message[],
    sourceMessages: Message[]
  ): { semanticMerging: boolean; complexity: string; patterns: string[] } {
    // Analyze patterns to inform merge strategy
    const patterns: string[] = [];
    
    if (targetMessages.some(m => m.content.includes('code'))) {
      patterns.push('technical_discussion');
    }
    
    if (sourceMessages.some(m => m.content.includes('creative'))) {
      patterns.push('creative_content');
    }
    
    return {
      semanticMerging: patterns.includes('technical_discussion'),
      complexity: patterns.length > 2 ? 'high' : 'low',
      patterns
    };
  }

  private explainStrategyChoice(
    strategy: BranchMergeConfig['strategy'],
    analysis: any,
    comparison: BranchComparison
  ): string {
    switch (strategy) {
      case 'ai_synthesis':
        return 'AI synthesis recommended due to semantic conflicts that can be intelligently resolved';
      case 'chronological':
        return 'Chronological merge recommended due to low conflict potential and high similarity';
      case 'manual':
        return 'Manual merge recommended due to high complexity or low confidence in automated resolution';
      default:
        return 'Standard merge strategy selected';
    }
  }

  private getAlternativeStrategies(
    primaryStrategy: BranchMergeConfig['strategy'],
    analysis: any
  ): Array<{ strategy: BranchMergeConfig['strategy']; pros: string[]; cons: string[] }> {
    const alternatives = [];
    
    if (primaryStrategy !== 'ai_synthesis') {
      alternatives.push({
        strategy: 'ai_synthesis' as const,
        pros: ['Intelligent conflict resolution', 'Preserves context from both branches'],
        cons: ['May take longer', 'Requires AI model availability']
      });
    }
    
    if (primaryStrategy !== 'chronological') {
      alternatives.push({
        strategy: 'chronological' as const,
        pros: ['Fast execution', 'Preserves timeline'],
        cons: ['May not resolve semantic conflicts', 'Could create inconsistencies']
      });
    }
    
    return alternatives;
  }

  private recommendAIModels(
    analysis: any,
    comparison: BranchComparison
  ): { forConflictResolution: AIModel; forSummary: AIModel; reasoning: string } {
    // Recommend models based on content analysis
    if (analysis.patterns.includes('technical_discussion')) {
      return {
        forConflictResolution: 'claude',
        forSummary: 'gpt4',
        reasoning: 'Claude excels at technical conflict resolution, GPT-4 for comprehensive summaries'
      };
    } else if (analysis.patterns.includes('creative_content')) {
      return {
        forConflictResolution: 'gpt4',
        forSummary: 'claude',
        reasoning: 'GPT-4 for creative conflict resolution, Claude for analytical summaries'
      };
    } else {
      return {
        forConflictResolution: 'claude',
        forSummary: 'claude',
        reasoning: 'Claude provides consistent performance for general content'
      };
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// Export singleton instance
export const branchMergingService = new BranchMergingService();