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
        FROM performance_metrics 
        WHERE created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        ${operationFilter}
        GROUP BY operation_type, DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
        ORDER BY timestamp DESC, operation_type
      `;

      const result = await tidbClient.query<PerformanceAnalytics>(sql, params);
      const executionTime = Date.now() - startTime;

      console.log(`Performance analytics query completed in ${executionTime}ms`);
      return result.rows;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Performance analytics query failed', error);
    }
  }

  /**
   * Get conversation analytics with HTAP capabilities
   */
  static async getConversationAnalytics(
    projectId?: string,
    timeRange: AnalyticsTimeRange = {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date()
    }
  ): Promise<ConversationAnalytics> {
    const startTime = Date.now();
    
    try {
      const projectFilter = projectId ? 'WHERE c.project_id = ?' : '';
      const params = projectId ? [projectId, timeRange.start, timeRange.end] : [timeRange.start, timeRange.end];

      // Main analytics query using HTAP capabilities
      const sql = `
        SELECT 
          COUNT(DISTINCT c.id) as totalConversations,
          COUNT(DISTINCT b.id) as totalBranches,
          COUNT(DISTINCT m.id) as totalMessages,
          COALESCE(AVG(branch_counts.branch_count), 0) as avgBranchesPerConversation,
          COALESCE(AVG(message_counts.message_count), 0) as avgMessagesPerBranch
        FROM conversations c
        LEFT JOIN branches b ON c.id = b.conversation_id
        LEFT JOIN messages m ON b.id = m.branch_id
        LEFT JOIN (
          SELECT conversation_id, COUNT(*) as branch_count
          FROM branches
          GROUP BY conversation_id
        ) branch_counts ON c.id = branch_counts.conversation_id
        LEFT JOIN (
          SELECT branch_id, COUNT(*) as message_count
          FROM messages
          GROUP BY branch_id
        ) message_counts ON b.id = message_counts.branch_id
        ${projectFilter}
        AND c.created_at BETWEEN ? AND ?
      `;

      const mainResult = await tidbClient.query(sql, params);

      // Model distribution query
      const modelSql = `
        SELECT 
          COALESCE(b.model, 'unknown') as model,
          COUNT(*) as count
        FROM branches b
        JOIN conversations c ON b.conversation_id = c.id
        ${projectFilter}
        AND c.created_at BETWEEN ? AND ?
        GROUP BY b.model
        ORDER BY count DESC
      `;

      const modelResult = await tidbClient.query(modelSql, params);

      // Daily activity query
      const dailySql = `
        SELECT 
          DATE(c.created_at) as date,
          COUNT(DISTINCT c.id) as conversations,
          COUNT(DISTINCT m.id) as messages,
          COUNT(DISTINCT b.id) as branches
        FROM conversations c
        LEFT JOIN branches b ON c.id = b.conversation_id
        LEFT JOIN messages m ON b.id = m.branch_id
        ${projectFilter}
        AND c.created_at BETWEEN ? AND ?
        GROUP BY DATE(c.created_at)
        ORDER BY date DESC
        LIMIT 30
      `;

      const dailyResult = await tidbClient.query(dailySql, params);

      const executionTime = Date.now() - startTime;
      console.log(`Conversation analytics completed in ${executionTime}ms`);

      return {
        totalConversations: mainResult.rows[0]?.totalConversations || 0,
        totalBranches: mainResult.rows[0]?.totalBranches || 0,
        totalMessages: mainResult.rows[0]?.totalMessages || 0,
        avgBranchesPerConversation: mainResult.rows[0]?.avgBranchesPerConversation || 0,
        avgMessagesPerBranch: mainResult.rows[0]?.avgMessagesPerBranch || 0,
        modelDistribution: modelResult.rows.reduce((acc, row) => {
          acc[row.model] = row.count;
          return acc;
        }, {} as Record<string, number>),
        dailyActivity: dailyResult.rows.map(row => ({
          date: row.date,
          conversations: row.conversations || 0,
          messages: row.messages || 0,
          branches: row.branches || 0
        }))
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Conversation analytics query failed', error);
    }
  }

  /**
   * Get project analytics
   */
  static async getProjectAnalytics(projectId?: string): Promise<ProjectAnalytics[]> {
    const startTime = Date.now();
    
    try {
      const projectFilter = projectId ? 'WHERE p.id = ?' : '';
      const params = projectId ? [projectId] : [];

      const sql = `
        SELECT 
          p.id as projectId,
          p.name as projectName,
          COUNT(DISTINCT d.id) as totalDocuments,
          COUNT(DISTINCT con.id) as totalConcepts,
          COUNT(DISTINCT c.id) as totalConversations,
          COALESCE(AVG(d.file_size), 0) as avgDocumentSize,
          COALESCE(SUM(con.mention_count), 0) as conceptMentions,
          COUNT(DISTINCT tm.id) as teamMembers,
          COALESCE(MAX(GREATEST(
            COALESCE(c.updated_at, c.created_at),
            COALESCE(d.processed_at, '1970-01-01'),
            COALESCE(con.updated_at, con.created_at)
          )), p.created_at) as lastActivity
        FROM projects p
        LEFT JOIN documents d ON p.id = d.project_id
        LEFT JOIN concepts con ON p.id = con.project_id
        LEFT JOIN conversations c ON p.id = c.project_id
        LEFT JOIN team_members tm ON p.id = tm.project_id
        ${projectFilter}
        GROUP BY p.id, p.name
        ORDER BY lastActivity DESC
      `;

      const result = await tidbClient.query<ProjectAnalytics>(sql, params);
      const executionTime = Date.now() - startTime;

      console.log(`Project analytics completed in ${executionTime}ms`);
      return result.rows;
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Project analytics query failed', error);
    }
  }

  /**
   * Get vector search analytics
   */
  static async getVectorSearchAnalytics(
    timeRange: '1h' | '24h' | '7d' = '24h'
  ): Promise<VectorSearchAnalytics> {
    const startTime = Date.now();
    
    try {
      const intervals = {
        '1h': 'INTERVAL 1 HOUR',
        '24h': 'INTERVAL 24 HOUR',
        '7d': 'INTERVAL 7 DAY'
      };

      // Main search metrics
      const mainSql = `
        SELECT 
          AVG(execution_time_ms) as avgSearchTime,
          COUNT(*) as searchVolume,
          AVG(result_count) as avgResultCount
        FROM performance_metrics
        WHERE operation_type IN ('vector_search', 'hybrid_search', 'full_text_search')
        AND created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
      `;

      const mainResult = await tidbClient.query(mainSql);

      // Top queries by hash
      const topQueriesSql = `
        SELECT 
          query_hash as queryHash,
          COUNT(*) as count,
          AVG(execution_time_ms) as avgTime
        FROM performance_metrics
        WHERE operation_type IN ('vector_search', 'hybrid_search', 'full_text_search')
        AND created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        AND query_hash IS NOT NULL
        GROUP BY query_hash
        ORDER BY count DESC
        LIMIT 10
      `;

      const topQueriesResult = await tidbClient.query(topQueriesSql);

      // Search type distribution
      const typeSql = `
        SELECT 
          operation_type,
          COUNT(*) as count
        FROM performance_metrics
        WHERE operation_type IN ('vector_search', 'hybrid_search', 'full_text_search')
        AND created_at >= DATE_SUB(NOW(), ${intervals[timeRange]})
        GROUP BY operation_type
        ORDER BY count DESC
      `;

      const typeResult = await tidbClient.query(typeSql);

      const executionTime = Date.now() - startTime;
      console.log(`Vector search analytics completed in ${executionTime}ms`);

      return {
        avgSearchTime: mainResult.rows[0]?.avgSearchTime || 0,
        searchVolume: mainResult.rows[0]?.searchVolume || 0,
        avgResultCount: mainResult.rows[0]?.avgResultCount || 0,
        topQueries: topQueriesResult.rows.map(row => ({
          queryHash: row.queryHash,
          count: row.count,
          avgTime: row.avgTime
        })),
        searchTypeDistribution: typeResult.rows.reduce((acc, row) => {
          acc[row.operation_type] = row.count;
          return acc;
        }, {} as Record<string, number>)
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Vector search analytics query failed', error);
    }
  }

  /**
   * Get real-time system health metrics
   */
  static async getSystemHealthMetrics(): Promise<{
    connectionPoolStatus: any;
    recentErrors: Array<{
      operationType: string;
      errorMessage: string;
      timestamp: Date;
      count: number;
    }>;
    performanceTrends: Array<{
      operationType: string;
      avgTime: number;
      trend: 'improving' | 'degrading' | 'stable';
    }>;
  }> {
    const startTime = Date.now();
    
    try {
      // Get connection pool status
      const poolStatus = tidbClient.getPoolStatus();

      // Recent errors
      const errorsSql = `
        SELECT 
          operation_type as operationType,
          error_message as errorMessage,
          MAX(created_at) as timestamp,
          COUNT(*) as count
        FROM performance_metrics
        WHERE success = 0
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        GROUP BY operation_type, error_message
        ORDER BY timestamp DESC
        LIMIT 10
      `;

      const errorsResult = await tidbClient.query(errorsSql);

      // Performance trends (comparing last hour vs previous hour)
      const trendsSql = `
        SELECT 
          operation_type as operationType,
          AVG(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) 
              THEN execution_time_ms END) as currentAvg,
          AVG(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR) 
                   AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
              THEN execution_time_ms END) as previousAvg
        FROM performance_metrics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        AND success = 1
        GROUP BY operation_type
        HAVING currentAvg IS NOT NULL AND previousAvg IS NOT NULL
      `;

      const trendsResult = await tidbClient.query(trendsSql);

      const executionTime = Date.now() - startTime;
      console.log(`System health metrics completed in ${executionTime}ms`);

      return {
        connectionPoolStatus: poolStatus,
        recentErrors: errorsResult.rows,
        performanceTrends: trendsResult.rows.map(row => {
          const currentAvg = row.currentAvg;
          const previousAvg = row.previousAvg;
          const change = (currentAvg - previousAvg) / previousAvg;
          
          let trend: 'improving' | 'degrading' | 'stable' = 'stable';
          if (change < -0.1) trend = 'improving'; // 10% faster
          else if (change > 0.1) trend = 'degrading'; // 10% slower
          
          return {
            operationType: row.operationType,
            avgTime: currentAvg,
            trend
          };
        })
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'System health metrics query failed', error);
    }
  }

  /**
   * Get knowledge graph analytics
   */
  static async getKnowledgeGraphAnalytics(projectId?: string): Promise<{
    totalConcepts: number;
    totalRelationships: number;
    avgConceptConnections: number;
    topConcepts: Array<{
      name: string;
      mentionCount: number;
      connectionCount: number;
    }>;
    relationshipTypes: Record<string, number>;
  }> {
    const startTime = Date.now();
    
    try {
      const projectFilter = projectId ? 'WHERE c.project_id = ?' : '';
      const params = projectId ? [projectId] : [];

      // Main knowledge graph metrics
      const mainSql = `
        SELECT 
          COUNT(DISTINCT c.id) as totalConcepts,
          COUNT(DISTINCT cr.id) as totalRelationships,
          COALESCE(AVG(connection_counts.connection_count), 0) as avgConceptConnections
        FROM concepts c
        LEFT JOIN concept_relationships cr ON c.id = cr.source_concept_id OR c.id = cr.target_concept_id
        LEFT JOIN (
          SELECT 
            concept_id,
            COUNT(*) as connection_count
          FROM (
            SELECT source_concept_id as concept_id FROM concept_relationships
            UNION ALL
            SELECT target_concept_id as concept_id FROM concept_relationships
          ) connections
          GROUP BY concept_id
        ) connection_counts ON c.id = connection_counts.concept_id
        ${projectFilter}
      `;

      const mainResult = await tidbClient.query(mainSql, params);

      // Top concepts by mentions and connections
      const topConceptsSql = `
        SELECT 
          c.name,
          c.mention_count as mentionCount,
          COALESCE(connection_counts.connection_count, 0) as connectionCount
        FROM concepts c
        LEFT JOIN (
          SELECT 
            concept_id,
            COUNT(*) as connection_count
          FROM (
            SELECT source_concept_id as concept_id FROM concept_relationships
            UNION ALL
            SELECT target_concept_id as concept_id FROM concept_relationships
          ) connections
          GROUP BY concept_id
        ) connection_counts ON c.id = connection_counts.concept_id
        ${projectFilter}
        ORDER BY (c.mention_count + COALESCE(connection_counts.connection_count, 0)) DESC
        LIMIT 10
      `;

      const topConceptsResult = await tidbClient.query(topConceptsSql, params);

      // Relationship type distribution
      const relationshipTypesSql = `
        SELECT 
          cr.relationship_type,
          COUNT(*) as count
        FROM concept_relationships cr
        JOIN concepts c ON cr.source_concept_id = c.id
        ${projectFilter}
        GROUP BY cr.relationship_type
        ORDER BY count DESC
      `;

      const relationshipTypesResult = await tidbClient.query(relationshipTypesSql, params);

      const executionTime = Date.now() - startTime;
      console.log(`Knowledge graph analytics completed in ${executionTime}ms`);

      return {
        totalConcepts: mainResult.rows[0]?.totalConcepts || 0,
        totalRelationships: mainResult.rows[0]?.totalRelationships || 0,
        avgConceptConnections: mainResult.rows[0]?.avgConceptConnections || 0,
        topConcepts: topConceptsResult.rows,
        relationshipTypes: relationshipTypesResult.rows.reduce((acc, row) => {
          acc[row.relationship_type] = row.count;
          return acc;
        }, {} as Record<string, number>)
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Knowledge graph analytics query failed', error);
    }
  }

  /**
   * Generate comprehensive analytics dashboard data
   */
  static async getDashboardAnalytics(projectId?: string): Promise<{
    performance: PerformanceAnalytics[];
    conversations: ConversationAnalytics;
    vectorSearch: VectorSearchAnalytics;
    knowledgeGraph: any;
    systemHealth: any;
  }> {
    const startTime = Date.now();
    
    try {
      // Run all analytics queries in parallel for better performance
      const [
        performance,
        conversations,
        vectorSearch,
        knowledgeGraph,
        systemHealth
      ] = await Promise.all([
        this.getPerformanceMetrics('24h'),
        this.getConversationAnalytics(projectId),
        this.getVectorSearchAnalytics('24h'),
        this.getKnowledgeGraphAnalytics(projectId),
        this.getSystemHealthMetrics()
      ]);

      const executionTime = Date.now() - startTime;
      console.log(`Dashboard analytics completed in ${executionTime}ms`);

      return {
        performance,
        conversations,
        vectorSearch,
        knowledgeGraph,
        systemHealth
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Dashboard analytics query failed', error);
    }
  }
}

export default HTAPAnalyticsService;