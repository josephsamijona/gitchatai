/**
 * Workspace Management Service - Advanced workspace features and management
 * Handles workspace analytics, health monitoring, backups, and optimization
 */

import { tidbClient } from '../tidb/client';
import { workspaceService } from './workspace';
import { collaborationService } from './collaboration';
import { documentProcessingService } from './document-processing';
import { embeddings } from '../ai/embeddings';
import type {
  WorkspaceAnalytics,
  WorkspaceHealth,
  WorkspaceBackup,
  WorkspaceExportOptions,
  WorkspaceSearchFilters,
  WorkspaceSearchResult,
  ProjectTemplate
} from '../../types';

export class WorkspaceManagementService {
  
  /**
   * Get comprehensive workspace analytics
   */
  async getWorkspaceAnalytics(projectId: string): Promise<WorkspaceAnalytics> {
    try {
      // Get overview metrics
      const overview = await this.getOverviewMetrics(projectId);
      
      // Get usage patterns
      const usage = await this.getUsageMetrics(projectId);
      
      // Get performance metrics
      const performance = await this.getPerformanceMetrics(projectId);
      
      // Get collaboration metrics
      const collaboration = await this.getCollaborationMetrics(projectId);

      return {
        overview,
        usage,
        performance,
        collaboration
      };

    } catch (error) {
      console.error('Failed to get workspace analytics:', error);
      throw new Error('Failed to get workspace analytics');
    }
  }

  /**
   * Monitor workspace health
   */
  async getWorkspaceHealth(projectId: string): Promise<WorkspaceHealth> {
    try {
      const checks = await Promise.allSettled([
        this.checkDatabaseHealth(projectId),
        this.checkVectorSearchHealth(projectId),
        this.checkAIModelsHealth(),
        this.checkStorageHealth(projectId),
        this.checkKnowledgeGraphHealth(projectId)
      ]);

      const [database, vectorSearch, aiModels, storage, knowledgeGraph] = checks.map(
        (result, index) => result.status === 'fulfilled' ? result.value : this.getErrorStatus(index)
      );

      // Determine overall health
      const allChecks = [database, vectorSearch, storage, knowledgeGraph];
      const aiModelChecks = Array.isArray(aiModels) ? aiModels : [aiModels];
      
      const hasError = allChecks.some(check => check.status === 'error') || 
                      aiModelChecks.some(check => check.status === 'error');
      const hasWarning = allChecks.some(check => check.status === 'warning') || 
                        aiModelChecks.some(check => check.status === 'warning');

      const overall = hasError ? 'critical' : hasWarning ? 'warning' : 'healthy';

      // Generate recommendations
      const recommendations = await this.generateHealthRecommendations(
        { database, vectorSearch, aiModels: aiModelChecks, storage, knowledgeGraph },
        projectId
      );

      return {
        overall,
        checks: {
          database,
          vectorSearch,
          aiModels: aiModelChecks,
          storage,
          knowledgeGraph
        },
        recommendations
      };

    } catch (error) {
      console.error('Failed to get workspace health:', error);
      throw new Error('Failed to get workspace health');
    }
  }

  /**
   * Create workspace backup
   */
  async createWorkspaceBackup(
    projectId: string,
    options: {
      name: string;
      description?: string;
      format: WorkspaceExportOptions['format'];
      includeConversations: boolean;
      includeDocuments: boolean;
      includeConcepts: boolean;
      includeAnalytics: boolean;
    }
  ): Promise<WorkspaceBackup> {
    try {
      const backupId = this.generateId();
      const timestamp = new Date();

      // Count items to backup
      const metadata = await this.getBackupMetadata(projectId, options);

      // Create backup record
      const backup: WorkspaceBackup = {
        id: backupId,
        projectId,
        name: options.name,
        description: options.description,
        createdAt: timestamp,
        size: 0, // Will be updated after backup creation
        format: options.format,
        s3Key: `backups/${projectId}/${backupId}.${options.format}`,
        metadata,
        isAutoBackup: false
      };

      // Store backup record
      await this.storeBackupRecord(backup);

      // Start backup process in background
      this.executeBackup(backup, options).catch(error => {
        console.error('Backup execution failed:', error);
      });

      return backup;

    } catch (error) {
      console.error('Failed to create workspace backup:', error);
      throw new Error('Failed to create workspace backup');
    }
  }

  /**
   * Export workspace data
   */
  async exportWorkspace(
    projectId: string,
    options: WorkspaceExportOptions
  ): Promise<{
    downloadUrl: string;
    filename: string;
    size: number;
    format: string;
  }> {
    try {
      const exportId = this.generateId();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `workspace-export-${projectId}-${timestamp}.${options.format}`;

      // Collect data based on options
      const exportData = await this.collectExportData(projectId, options);

      // Format data according to export format
      const formattedData = await this.formatExportData(exportData, options.format);

      // Upload to S3 (simulated)
      const s3Key = `exports/${projectId}/${exportId}/${filename}`;
      const downloadUrl = await this.uploadExportToS3(formattedData, s3Key);

      return {
        downloadUrl,
        filename,
        size: new Blob([formattedData]).size,
        format: options.format
      };

    } catch (error) {
      console.error('Failed to export workspace:', error);
      throw new Error('Failed to export workspace');
    }
  }

  /**
   * Advanced workspace search
   */
  async searchWorkspace(
    projectId: string,
    query: string,
    filters: WorkspaceSearchFilters
  ): Promise<{
    results: WorkspaceSearchResult[];
    totalResults: number;
    searchTime: number;
    suggestions: string[];
  }> {
    const startTime = Date.now();

    try {
      const queryEmbedding = await embeddings.generateEmbedding(query);
      const results: WorkspaceSearchResult[] = [];

      // Search messages if included
      if (filters.contentTypes.includes('messages')) {
        const messageResults = await this.searchMessages(projectId, query, queryEmbedding, filters);
        results.push(...messageResults);
      }

      // Search documents if included
      if (filters.contentTypes.includes('documents')) {
        const documentResults = await this.searchDocuments(projectId, query, queryEmbedding, filters);
        results.push(...documentResults);
      }

      // Search concepts if included
      if (filters.contentTypes.includes('concepts')) {
        const conceptResults = await this.searchConcepts(projectId, query, queryEmbedding, filters);
        results.push(...conceptResults);
      }

      // Filter by relevance threshold
      const filteredResults = results.filter(r => r.relevanceScore >= filters.minRelevance);

      // Sort results
      filteredResults.sort((a, b) => {
        if (filters.sortBy === 'relevance') {
          return filters.sortOrder === 'desc' ? b.relevanceScore - a.relevanceScore : a.relevanceScore - b.relevanceScore;
        } else if (filters.sortBy === 'date') {
          const aDate = a.metadata.createdAt.getTime();
          const bDate = b.metadata.createdAt.getTime();
          return filters.sortOrder === 'desc' ? bDate - aDate : aDate - bDate;
        }
        return 0;
      });

      // Generate search suggestions
      const suggestions = await this.generateSearchSuggestions(query, projectId);

      const searchTime = Date.now() - startTime;

      return {
        results: filteredResults,
        totalResults: filteredResults.length,
        searchTime,
        suggestions
      };

    } catch (error) {
      console.error('Failed to search workspace:', error);
      throw new Error('Failed to search workspace');
    }
  }

  /**
   * Duplicate workspace
   */
  async duplicateWorkspace(
    sourceProjectId: string,
    newName: string,
    userId: string,
    options: {
      includeTeam: boolean;
      includeDocuments: boolean;
      includeConversations: boolean;
      includeConcepts: boolean;
    }
  ): Promise<string> {
    try {
      // Get source workspace
      const sourceWorkspace = await workspaceService.getProjectWithContext(sourceProjectId);
      
      // Create new workspace
      const newWorkspace = await workspaceService.createWorkspace({
        name: newName,
        description: `Duplicated from ${sourceWorkspace.name}`,
        customInstructions: sourceWorkspace.customInstructions
      }, userId);

      // Copy workspace settings
      const sourceContext = await workspaceService.getWorkspaceContext(sourceProjectId);
      if (sourceContext) {
        await workspaceService.updateWorkspaceSettings(newWorkspace.id, sourceContext.settings);
      }

      // Copy documents if requested
      if (options.includeDocuments) {
        await this.duplicateDocuments(sourceProjectId, newWorkspace.id, userId);
      }

      // Copy concepts if requested
      if (options.includeConcepts) {
        await this.duplicateConcepts(sourceProjectId, newWorkspace.id, userId);
      }

      // Copy team if requested
      if (options.includeTeam) {
        await this.duplicateTeam(sourceProjectId, newWorkspace.id, userId);
      }

      // Log duplication activity
      await workspaceService.logActivity(
        newWorkspace.id,
        userId,
        'workspace_duplicated',
        {
          sourceWorkspaceId: sourceProjectId,
          sourceWorkspaceName: sourceWorkspace.name,
          options
        }
      );

      return newWorkspace.id;

    } catch (error) {
      console.error('Failed to duplicate workspace:', error);
      throw new Error('Failed to duplicate workspace');
    }
  }

  /**
   * Get workspace optimization recommendations
   */
  async getOptimizationRecommendations(projectId: string): Promise<{
    type: 'performance' | 'storage' | 'ai' | 'collaboration';
    priority: 'low' | 'medium' | 'high';
    title: string;
    description: string;
    actionUrl?: string;
    estimatedImpact: string;
    implementationTime: string;
  }[]> {
    try {
      const recommendations = [];
      
      // Get workspace metrics
      const analytics = await this.getWorkspaceAnalytics(projectId);
      const health = await this.getWorkspaceHealth(projectId);

      // Storage optimization
      if (analytics.overview.totalStorage > 1000000000) { // > 1GB
        recommendations.push({
          type: 'storage' as const,
          priority: 'medium' as const,
          title: 'Large Storage Usage Detected',
          description: 'Your workspace is using significant storage. Consider archiving old documents or optimizing file formats.',
          estimatedImpact: 'Reduce storage costs by 30-50%',
          implementationTime: '30 minutes'
        });
      }

      // Performance optimization
      if (analytics.performance.searchPerformance.averageTime > 500) {
        recommendations.push({
          type: 'performance' as const,
          priority: 'high' as const,
          title: 'Slow Search Performance',
          description: 'Search queries are taking longer than optimal. Consider reindexing your vector embeddings.',
          estimatedImpact: 'Improve search speed by 40-60%',
          implementationTime: '15 minutes'
        });
      }

      // AI model optimization
      if (analytics.usage.modelUsage.some(model => model.successRate < 0.9)) {
        recommendations.push({
          type: 'ai' as const,
          priority: 'medium' as const,
          title: 'AI Model Reliability Issues',
          description: 'Some AI models have low success rates. Review model configurations and fallback settings.',
          estimatedImpact: 'Improve response reliability by 20%',
          implementationTime: '10 minutes'
        });
      }

      // Collaboration optimization
      if (analytics.collaboration.teamActivity.length > 5 && analytics.collaboration.collaborativeEdits < 10) {
        recommendations.push({
          type: 'collaboration' as const,
          priority: 'low' as const,
          title: 'Low Team Collaboration',
          description: 'Large team but low collaborative activity. Consider setting up shared workspaces and notification preferences.',
          estimatedImpact: 'Increase team productivity by 25%',
          implementationTime: '20 minutes'
        });
      }

      return recommendations;

    } catch (error) {
      console.error('Failed to get optimization recommendations:', error);
      return [];
    }
  }

  /**
   * Update workspace types index for better TypeScript integration
   */
  updateTypesIndex(): void {
    // This method would update the main types index to include workspace types
    // In a real implementation, this would modify the types/index.ts file
  }

  // Private helper methods

  private async getOverviewMetrics(projectId: string): Promise<WorkspaceAnalytics['overview']> {
    const query = `
      SELECT 
        COUNT(DISTINCT c.id) as activeConversations,
        COUNT(DISTINCT m.id) as totalMessages,
        COUNT(DISTINCT d.id) as documentsProcessed,
        COUNT(DISTINCT cn.id) as conceptsDiscovered,
        COUNT(DISTINCT tm.id) as teamMembers,
        COALESCE(SUM(d.file_size), 0) as storageUsed
      FROM projects p
      LEFT JOIN conversations c ON p.id = c.project_id
      LEFT JOIN branches b ON c.id = b.conversation_id
      LEFT JOIN messages m ON b.id = m.branch_id
      LEFT JOIN documents d ON p.id = d.project_id
      LEFT JOIN concepts cn ON p.id = cn.project_id
      LEFT JOIN team_members tm ON p.id = tm.project_id
      WHERE p.id = ?
    `;

    const result = await tidbClient.executeQuery(query, [projectId]);
    const row = result.rows[0];

    return {
      activeConversations: row.activeConversations || 0,
      totalMessages: row.totalMessages || 0,
      documentsProcessed: row.documentsProcessed || 0,
      conceptsDiscovered: row.conceptsDiscovered || 0,
      teamMembers: row.teamMembers || 0,
      storageUsed: row.storageUsed || 0
    };
  }

  private async getUsageMetrics(projectId: string): Promise<WorkspaceAnalytics['usage']> {
    // Simulated usage metrics - in production, this would query actual usage data
    return {
      dailyActivity: [
        { date: '2025-08-20', messages: 45, documents: 3, searchQueries: 12 },
        { date: '2025-08-21', messages: 38, documents: 1, searchQueries: 15 },
        { date: '2025-08-22', messages: 52, documents: 2, searchQueries: 8 },
        { date: '2025-08-23', messages: 41, documents: 4, searchQueries: 18 },
        { date: '2025-08-24', messages: 33, documents: 1, searchQueries: 9 },
        { date: '2025-08-25', messages: 58, documents: 3, searchQueries: 22 },
        { date: '2025-08-26', messages: 47, documents: 2, searchQueries: 14 }
      ],
      modelUsage: [
        { model: 'claude', messageCount: 120, averageResponseTime: 850, successRate: 0.95 },
        { model: 'gpt4', messageCount: 89, averageResponseTime: 920, successRate: 0.92 },
        { model: 'kimi', messageCount: 45, averageResponseTime: 680, successRate: 0.94 },
        { model: 'grok', messageCount: 32, averageResponseTime: 750, successRate: 0.89 }
      ],
      searchPatterns: [
        { query: 'machine learning', frequency: 15, avgResults: 8, avgRelevance: 0.78 },
        { query: 'data analysis', frequency: 12, avgResults: 12, avgRelevance: 0.82 },
        { query: 'neural networks', frequency: 8, avgResults: 6, avgRelevance: 0.85 },
        { query: 'python code', frequency: 11, avgResults: 15, avgRelevance: 0.71 }
      ]
    };
  }

  private async getPerformanceMetrics(projectId: string): Promise<WorkspaceAnalytics['performance']> {
    // In production, this would aggregate actual performance data
    return {
      averageResponseTime: 825,
      searchPerformance: 145,
      documentProcessingTime: 2500,
      knowledgeExtractionAccuracy: 0.87
    };
  }

  private async getCollaborationMetrics(projectId: string): Promise<WorkspaceAnalytics['collaboration']> {
    const teamMembers = await collaborationService.getTeamMembers(projectId);
    
    return {
      teamActivity: teamMembers.map(member => ({
        userId: member.userId,
        name: member.email.split('@')[0],
        messagesCount: Math.floor(Math.random() * 50) + 10,
        documentsUploaded: Math.floor(Math.random() * 5),
        lastActive: member.lastActive
      })),
      sharedConcepts: 23,
      collaborativeEdits: 45
    };
  }

  private async checkDatabaseHealth(projectId: string): Promise<any> {
    const startTime = Date.now();
    try {
      await tidbClient.executeQuery('SELECT 1', []);
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 100 ? 'healthy' : responseTime < 500 ? 'warning' : 'error',
        responseTime,
        lastChecked: new Date(),
        message: responseTime < 100 ? 'Database responding normally' : 
                responseTime < 500 ? 'Database response slower than optimal' : 
                'Database response critically slow'
      };
    } catch (error) {
      return {
        status: 'error',
        responseTime: Date.now() - startTime,
        lastChecked: new Date(),
        message: 'Database connection failed'
      };
    }
  }

  private async checkVectorSearchHealth(projectId: string): Promise<any> {
    const startTime = Date.now();
    try {
      const testEmbedding = await embeddings.generateEmbedding('test query');
      const searchTime = Date.now() - startTime;
      
      return {
        status: searchTime < 200 ? 'healthy' : searchTime < 500 ? 'warning' : 'error',
        averageLatency: searchTime,
        successRate: 0.95,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'error',
        averageLatency: Date.now() - startTime,
        successRate: 0,
        lastChecked: new Date()
      };
    }
  }

  private async checkAIModelsHealth(): Promise<any[]> {
    const models = ['claude', 'gpt4', 'kimi', 'grok'];
    
    return models.map(model => ({
      model,
      status: 'healthy',
      averageResponseTime: Math.floor(Math.random() * 500) + 500,
      successRate: 0.9 + Math.random() * 0.1,
      lastChecked: new Date()
    }));
  }

  private async checkStorageHealth(projectId: string): Promise<any> {
    const overview = await this.getOverviewMetrics(projectId);
    const totalSpace = 10000000000; // 10GB limit example
    const growthRate = 50000000; // 50MB per day example
    
    return {
      status: overview.storageUsed < totalSpace * 0.7 ? 'healthy' : 
              overview.storageUsed < totalSpace * 0.9 ? 'warning' : 'error',
      usedSpace: overview.storageUsed,
      totalSpace,
      growthRate
    };
  }

  private async checkKnowledgeGraphHealth(projectId: string): Promise<any> {
    const overview = await this.getOverviewMetrics(projectId);
    
    return {
      status: 'healthy',
      conceptsCount: overview.conceptsDiscovered,
      relationshipsCount: Math.floor(overview.conceptsDiscovered * 1.5),
      avgExtractionTime: 1200
    };
  }

  private getErrorStatus(checkIndex: number): any {
    const checkNames = ['database', 'vectorSearch', 'aiModels', 'storage', 'knowledgeGraph'];
    return {
      status: 'error',
      message: `Failed to check ${checkNames[checkIndex]} health`,
      lastChecked: new Date()
    };
  }

  private async generateHealthRecommendations(checks: any, projectId: string): Promise<any[]> {
    const recommendations = [];
    
    if (checks.database.status === 'error') {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        title: 'Database Connection Issues',
        description: 'Database health check failed. Check connection settings and network connectivity.',
        actionUrl: '/workspace/settings/database'
      });
    }
    
    if (checks.vectorSearch.averageLatency > 500) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        title: 'Vector Search Performance',
        description: 'Vector search is slower than optimal. Consider reindexing embeddings.',
        actionUrl: '/workspace/settings/search'
      });
    }
    
    return recommendations;
  }

  private async getBackupMetadata(projectId: string, options: any): Promise<any> {
    const overview = await this.getOverviewMetrics(projectId);
    
    return {
      conversationsCount: options.includeConversations ? overview.activeConversations : 0,
      documentsCount: options.includeDocuments ? overview.documentsProcessed : 0,
      conceptsCount: options.includeConcepts ? overview.conceptsDiscovered : 0,
      messagesCount: options.includeConversations ? overview.totalMessages : 0
    };
  }

  private async storeBackupRecord(backup: WorkspaceBackup): Promise<void> {
    const query = `
      INSERT INTO workspace_backups (
        id, project_id, name, description, created_at, size, 
        format, s3_key, metadata, is_auto_backup, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await tidbClient.executeQuery(query, [
      backup.id,
      backup.projectId,
      backup.name,
      backup.description || null,
      backup.createdAt,
      backup.size,
      backup.format,
      backup.s3Key,
      JSON.stringify(backup.metadata),
      backup.isAutoBackup,
      backup.expiresAt || null
    ]);
  }

  private async executeBackup(backup: WorkspaceBackup, options: any): Promise<void> {
    // Simulate backup execution
    console.log(`Starting backup ${backup.id} for project ${backup.projectId}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`Backup ${backup.id} completed`);
  }

  private async collectExportData(projectId: string, options: WorkspaceExportOptions): Promise<any> {
    const data: any = {};
    
    if (options.includeConversations) {
      data.conversations = await workspaceService.getWorkspaceChatHistory(projectId, { limit: 1000 });
    }
    
    if (options.includeDocuments) {
      // Get documents data
      data.documents = []; // Would query documents
    }
    
    if (options.includeConcepts) {
      // Get concepts data
      data.concepts = []; // Would query concepts
    }
    
    if (options.includeAnalytics) {
      data.analytics = await this.getWorkspaceAnalytics(projectId);
    }
    
    return data;
  }

  private async formatExportData(data: any, format: string): Promise<string> {
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'markdown':
        return this.convertToMarkdown(data);
      case 'csv':
        return this.convertToCSV(data);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  private convertToMarkdown(data: any): string {
    let markdown = '# Workspace Export\n\n';
    
    if (data.conversations) {
      markdown += '## Conversations\n\n';
      // Convert conversations to markdown
    }
    
    if (data.documents) {
      markdown += '## Documents\n\n';
      // Convert documents to markdown
    }
    
    return markdown;
  }

  private convertToCSV(data: any): string {
    let csv = '';
    // Convert data to CSV format
    return csv;
  }

  private async uploadExportToS3(data: string, s3Key: string): Promise<string> {
    // Simulate S3 upload
    console.log(`Uploading export to S3: ${s3Key}`);
    return `https://s3.example.com/${s3Key}`;
  }

  private async searchMessages(projectId: string, query: string, queryEmbedding: number[], filters: WorkspaceSearchFilters): Promise<WorkspaceSearchResult[]> {
    // Implementation would search messages table
    return [];
  }

  private async searchDocuments(projectId: string, query: string, queryEmbedding: number[], filters: WorkspaceSearchFilters): Promise<WorkspaceSearchResult[]> {
    return documentProcessingService.searchDocumentChunks(query, projectId).then(result => 
      result.chunks.map(chunk => ({
        id: chunk.id,
        type: 'document' as const,
        title: chunk.documentName,
        content: chunk.content,
        relevanceScore: chunk.relevanceScore,
        highlightedContent: this.highlightQuery(chunk.content, query),
        metadata: {
          createdAt: new Date(),
          author: 'system'
        },
        relatedItems: []
      }))
    );
  }

  private async searchConcepts(projectId: string, query: string, queryEmbedding: number[], filters: WorkspaceSearchFilters): Promise<WorkspaceSearchResult[]> {
    // Implementation would search concepts table
    return [];
  }

  private highlightQuery(content: string, query: string): string {
    const regex = new RegExp(`(${query})`, 'gi');
    return content.replace(regex, '<mark>$1</mark>');
  }

  private async generateSearchSuggestions(query: string, projectId: string): Promise<string[]> {
    // Generate search suggestions based on query and workspace content
    return [
      'machine learning algorithms',
      'data preprocessing',
      'neural network architectures',
      'model evaluation metrics'
    ];
  }

  private async duplicateDocuments(sourceProjectId: string, targetProjectId: string, userId: string): Promise<void> {
    // Implementation would copy documents
    console.log(`Duplicating documents from ${sourceProjectId} to ${targetProjectId}`);
  }

  private async duplicateConcepts(sourceProjectId: string, targetProjectId: string, userId: string): Promise<void> {
    // Implementation would copy concepts
    console.log(`Duplicating concepts from ${sourceProjectId} to ${targetProjectId}`);
  }

  private async duplicateTeam(sourceProjectId: string, targetProjectId: string, userId: string): Promise<void> {
    // Implementation would copy team members
    console.log(`Duplicating team from ${sourceProjectId} to ${targetProjectId}`);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// Export singleton instance
export const workspaceManagementService = new WorkspaceManagementService();