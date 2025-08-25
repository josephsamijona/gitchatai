import { tidbClient, TiDBError, TiDBErrorType } from './client';

/**
 * HTAP Analytics for real-time performance monitoring
 * Demonstrates TiDB's hybrid transactional/analytical processing capabilities
 */

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
}

export interface PerformanceAnalytics {
  operationType: string;
  avgExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  p95ExecutionTime: number;
  operationCount: number;
  successRate: number;
  timestamp: Date;
}

export interface ConversationAnalytics {
  totalConversations: number;
  totalBranches: number;
  totalMessages: number;
  avgBranchesPerConversation: number;
  avgMessagesPerBranch: number;
  modelDistribution: Record<string, number>;
  dailyActivity: Array<{
    date: string;
    conversations: number;
    messages: number;
    branches: number;
  }>;
}

export interface ProjectAnalytics {
  projectId: string;
  projectName: string;
  totalDocuments: number;
  totalConcepts: number;
  totalConversations: number;
  avgDocumentSize: number;
  conceptMentions: number;
  teamMembers: number;
  lastActivity: Date;
}

export interface VectorSearchAnalytics {
  avgSearchTime: number;
  searchVolume: number;
  avgResultCount: number;
  topQueries: Array<{
    queryHash: string;
    count: number;
    avgTime: number;
  }>;
  searchTypeDistribution: Record<string, number>;
}

/**
 * HTAP Analytics Service
 */
export class HTAPAnalyticsService {
  /**
   * Get real-time performance metrics
   */
  static async getPerformanceMetrics(
    timeRange: '1h' | '24h' | '7d' = '24h',
    operationType?: string
  ): Promise<PerformanceAnalytics[]> {
    const startTime = Date.now();
    
    try {
      const intervals = {
        '1h': 'INTERVAL 1 HOUR',
        '24h': 'INTERVAL 24 HOUR',
        '7d': 'INTERVAL 7 DAY'
      };

      const operationFilter = operationType 
        ? 'AND operation_type = ?' 
        : '';

      const params = operationType ? [operationType] : [];

      const sql = `
        SELECT 
          operation_type as operationType,
          AVG(execution_time_ms) as avgExecutionTime,
          MIN(execution_time_ms) as minExecutionTime,
          MAX(execution_time_ms) as maxExecutionTime,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95ExecutionTime,
          COUNT(*) as operationCount,
          (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as successRate,
          DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as timestamp