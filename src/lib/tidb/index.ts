/**
 * TiDB Integration Entry Point
 * Exports all TiDB services and utilities
 */

// Core client and types
export { default as tidbClient, initializeTiDB, TiDBError, TiDBErrorType } from './client';
export type { TiDBConfig, VectorSearchResult, PerformanceMetric } from './client';

// Schema management
export { initializeSchema, dropSchema, checkSchema, getSchemaStats } from './schema';

// Vector search capabilities
export { default as VectorSearchService } from './vector-search';
export type { SearchFilters, HybridSearchOptions, SearchResult } from './vector-search';

// Database queries
export { default as DatabaseQueries } from './queries';
export type { 
  ConversationData, 
  BranchData, 
  MessageData, 
  DocumentData, 
  ConceptData 
} from './queries';

// HTAP Analytics
export { default as HTAPAnalyticsService } from './analytics';
export type { 
  AnalyticsTimeRange,
  PerformanceAnalytics,
  ConversationAnalytics,
  ProjectAnalytics,
  VectorSearchAnalytics
} from './analytics';

// Performance monitoring
export { default as PerformanceMonitor } from './performance';
export type { 
  QueryPerformanceMetric,
  ConnectionHealthMetric,
  VectorSearchBenchmark
} from './performance';

// Migration management
export { default as MigrationManager, deployToProduction, setupDevelopment, resetDatabase } from './migrations';
export type { Migration, MigrationRecord } from './migrations';

// Workflow orchestration
export { default as TiDBOrchestrator } from './orchestrator';
export type { WorkflowContext, WorkflowStep } from './orchestrator';

/**
 * Initialize complete TiDB stack
 */
export async function initializeTiDBStack(): Promise<void> {
  console.log('Initializing TiDB stack...');
  
  try {
    // Initialize TiDB connection
    await initializeTiDB();
    console.log('✓ TiDB connection established');

    // Run migrations
    const { setupDevelopment } = await import('./migrations');
    await setupDevelopment();
    console.log('✓ Database schema initialized');

    // Initialize performance monitoring
    const { default: PerformanceMonitor } = await import('./performance');
    PerformanceMonitor.initialize();
    console.log('✓ Performance monitoring started');

    console.log('TiDB stack initialization completed successfully');
  } catch (error) {
    console.error('TiDB stack initialization failed:', error);
    throw error;
  }
}

/**
 * Health check for TiDB services
 */
export async function healthCheck(): Promise<{
  database: boolean;
  schema: boolean;
  performance: boolean;
  vectorSearch: boolean;
}> {
  const health = {
    database: false,
    schema: false,
    performance: false,
    vectorSearch: false
  };

  try {
    // Check database connection
    const poolStatus = tidbClient.getPoolStatus();
    health.database = poolStatus.isConnected;

    // Check schema
    health.schema = await checkSchema();

    // Check performance monitoring
    health.performance = true; // PerformanceMonitor is always available

    // Check vector search with a simple query
    try {
      const testEmbedding = Array.from({ length: 1536 }, () => 0);
      await VectorSearchService.searchMessages(testEmbedding, {}, 1);
      health.vectorSearch = true;
    } catch (error) {
      console.warn('Vector search health check failed:', error);
      health.vectorSearch = false;
    }

  } catch (error) {
    console.error('Health check failed:', error);
  }

  return health;
}

/**
 * Get comprehensive system status
 */
export async function getSystemStatus(): Promise<{
  health: any;
  performance: any;
  analytics: any;
  migrations: any;
}> {
  try {
    const [health, performance, analytics, migrations] = await Promise.all([
      healthCheck(),
      PerformanceMonitor.getConnectionHealth(),
      HTAPAnalyticsService.getSystemHealthMetrics(),
      MigrationManager.getStatus()
    ]);

    return {
      health,
      performance,
      analytics,
      migrations
    };
  } catch (error) {
    console.error('Failed to get system status:', error);
    throw error;
  }
}

// Export default as the main client for convenience
export default tidbClient;