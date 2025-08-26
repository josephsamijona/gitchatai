/**
 * Performance Metrics API - Real-time performance monitoring and analytics
 * Provides system metrics, query performance, and optimization insights
 */

import { NextRequest } from 'next/server';
import { performanceMonitor } from '../../../../lib/performance/monitor';
import { redisClient } from '../../../../lib/cache/redis-client';
import { connectionManager } from '../../../../lib/tidb/connection-manager';
import { queryOptimizer } from '../../../../lib/tidb/query-optimizer';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const timeWindow = parseInt(searchParams.get('timeWindow') || '3600000'); // 1 hour default
    const limit = parseInt(searchParams.get('limit') || '100');

    switch (type) {
      case 'summary':
        return await getPerformanceSummary(timeWindow);
      case 'metrics':
        return await getMetrics(timeWindow, limit);
      case 'insights':
        return await getOptimizationInsights(limit);
      case 'health':
        return await getSystemHealth();
      case 'cache':
        return await getCacheMetrics();
      case 'database':
        return await getDatabaseMetrics();
      case 'queries':
        return await getQueryAnalytics(limit);
      default:
        return await getAllMetrics(timeWindow);
    }

  } catch (error) {
    console.error('Performance metrics API error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to retrieve performance metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function getPerformanceSummary(timeWindow: number) {
  const metrics = performanceMonitor.getMetrics(undefined, 1000);
  const cutoff = Date.now() - timeWindow;
  const recentMetrics = metrics.filter(m => m.timestamp.getTime() > cutoff);

  const summary = {
    totalRequests: recentMetrics.length,
    avgResponseTime: recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length || 0,
    errorRate: (recentMetrics.filter(m => !m.success).length / recentMetrics.length) * 100 || 0,
    typeBreakdown: recentMetrics.reduce((acc, m) => {
      acc[m.type] = (acc[m.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    timeWindow: timeWindow / 1000 / 60, // Convert to minutes
    period: {
      start: new Date(cutoff),
      end: new Date()
    }
  };

  return new Response(
    JSON.stringify({ summary, success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getMetrics(timeWindow: number, limit: number) {
  const allMetrics = performanceMonitor.getMetrics(undefined, limit);
  const cutoff = Date.now() - timeWindow;
  const recentMetrics = allMetrics.filter(m => m.timestamp.getTime() > cutoff);

  // Group by type for better analysis
  const metricsByType = recentMetrics.reduce((acc, metric) => {
    if (!acc[metric.type]) {
      acc[metric.type] = [];
    }
    acc[metric.type].push(metric);
    return acc;
  }, {} as Record<string, any[]>);

  // Calculate statistics for each type
  const statistics = Object.entries(metricsByType).map(([type, metrics]) => ({
    type,
    count: metrics.length,
    avgDuration: metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length,
    maxDuration: Math.max(...metrics.map(m => m.duration)),
    minDuration: Math.min(...metrics.map(m => m.duration)),
    errorRate: (metrics.filter(m => !m.success).length / metrics.length) * 100,
    slowest: metrics
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(m => ({
        name: m.name,
        duration: m.duration,
        timestamp: m.timestamp,
        error: m.error
      }))
  }));

  return new Response(
    JSON.stringify({ 
      metrics: recentMetrics.slice(0, limit),
      statistics,
      totalCount: recentMetrics.length,
      success: true
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getOptimizationInsights(limit: number) {
  const insights = performanceMonitor.getInsights(limit);
  const analytics = performanceMonitor['getOperationAnalytics']();

  return new Response(
    JSON.stringify({ 
      insights: insights.map(insight => ({
        ...insight,
        age: Date.now() - insight.detectedAt.getTime()
      })),
      analytics,
      success: true
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getSystemHealth() {
  try {
    // Get health from connection manager
    const dbHealth = connectionManager.getHealthStatus();
    
    // Get cache health
    const cacheStats = await redisClient.getStats();
    const cacheHealthy = await redisClient.ping();

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryHealthy = (memoryUsage.heapUsed / memoryUsage.heapTotal) < 0.9;

    const systemHealth = {
      overall: {
        status: dbHealth.isHealthy && cacheHealthy && memoryHealthy ? 'healthy' : 'degraded',
        score: Math.round((
          (dbHealth.isHealthy ? 100 : 50) +
          (cacheHealthy ? 100 : 0) +
          (memoryHealthy ? 100 : 50)
        ) / 3)
      },
      components: {
        database: {
          status: dbHealth.isHealthy ? 'healthy' : 'degraded',
          score: dbHealth.score,
          responseTime: dbHealth.components.database?.responseTime || 0,
          issues: dbHealth.issues
        },
        cache: {
          status: cacheHealthy ? 'healthy' : 'critical',
          hitRate: cacheStats.hitRate,
          avgResponseTime: cacheStats.avgResponseTime,
          memoryUsage: cacheStats.memoryUsage
        },
        memory: {
          status: memoryHealthy ? 'healthy' : 'critical',
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          usage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
        }
      },
      lastCheck: new Date()
    };

    return new Response(
      JSON.stringify({ health: systemHealth, success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        health: {
          overall: { status: 'critical', score: 0 },
          error: error instanceof Error ? error.message : 'Health check failed'
        },
        success: false
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function getCacheMetrics() {
  const stats = await redisClient.getStats();
  const metrics = redisClient.getMetrics(50);

  const cacheAnalytics = {
    performance: {
      hitRate: stats.hitRate,
      totalRequests: stats.totalRequests,
      avgResponseTime: stats.avgResponseTime,
      memoryUsage: stats.memoryUsage
    },
    recentOperations: metrics.map(m => ({
      operation: m.operation,
      key: m.key.substring(0, 50), // Truncate for privacy
      hit: m.hit,
      responseTime: m.responseTime,
      dataSize: m.dataSize,
      timestamp: m.timestamp
    })),
    recommendations: []
  };

  // Add recommendations based on performance
  if (stats.hitRate < 0.7) {
    cacheAnalytics.recommendations.push({
      type: 'low_hit_rate',
      description: `Cache hit rate is ${(stats.hitRate * 100).toFixed(1)}%, consider optimizing cache strategy`,
      priority: 'medium'
    });
  }

  if (stats.avgResponseTime > 10) {
    cacheAnalytics.recommendations.push({
      type: 'slow_cache',
      description: `Average cache response time is ${stats.avgResponseTime.toFixed(2)}ms, check Redis performance`,
      priority: 'high'
    });
  }

  return new Response(
    JSON.stringify({ cache: cacheAnalytics, success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getDatabaseMetrics() {
  const connectionStats = connectionManager.getStats();
  const healthStatus = connectionManager.getHealthStatus();

  const dbAnalytics = {
    connections: {
      total: connectionStats.total,
      active: connectionStats.active,
      idle: connectionStats.idle,
      queued: connectionStats.queued,
      peak: connectionStats.peakConnections,
      created: connectionStats.created,
      destroyed: connectionStats.destroyed,
      errors: connectionStats.errors
    },
    performance: {
      avgResponseTime: connectionStats.avgResponseTime,
      uptime: connectionStats.uptime,
      lastActivity: connectionStats.lastActivity
    },
    health: healthStatus,
    recommendations: []
  };

  // Add recommendations based on metrics
  const utilizationRate = (connectionStats.active / connectionStats.total) * 100;
  if (utilizationRate > 80) {
    dbAnalytics.recommendations.push({
      type: 'high_utilization',
      description: `Connection utilization is ${utilizationRate.toFixed(1)}%, consider scaling pool`,
      priority: 'high'
    });
  }

  if (connectionStats.avgResponseTime > 1000) {
    dbAnalytics.recommendations.push({
      type: 'slow_queries',
      description: `Average query time is ${connectionStats.avgResponseTime.toFixed(2)}ms, optimize queries`,
      priority: 'high'
    });
  }

  return new Response(
    JSON.stringify({ database: dbAnalytics, success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getQueryAnalytics(limit: number) {
  const queryHistory = queryOptimizer.getQueryHistory(limit);
  const indexRecommendations = queryOptimizer.getIndexRecommendations();

  const queryAnalytics = {
    recentQueries: queryHistory.map(q => ({
      id: q.id,
      queryHash: q.queryHash,
      query: q.query.substring(0, 100), // Truncate for display
      estimatedCost: q.estimatedCost,
      actualCost: q.actualCost,
      executionTime: q.executionTime,
      rowsExamined: q.rowsExamined,
      rowsReturned: q.rowsReturned,
      useIndex: q.useIndex,
      optimizations: q.optimizations.length
    })),
    slowestQueries: queryHistory
      .filter(q => q.executionTime)
      .sort((a, b) => (b.executionTime || 0) - (a.executionTime || 0))
      .slice(0, 10)
      .map(q => ({
        query: q.query.substring(0, 100),
        executionTime: q.executionTime,
        optimizations: q.optimizations.filter(o => o.priority === 'high').length
      })),
    indexRecommendations: indexRecommendations.map(rec => ({
      table: rec.table,
      columns: rec.columns,
      indexType: rec.indexType,
      estimatedGain: rec.estimatedGain,
      priority: rec.priority,
      createStatement: rec.createStatement
    })),
    summary: {
      totalQueries: queryHistory.length,
      avgExecutionTime: queryHistory.reduce((sum, q) => sum + (q.executionTime || 0), 0) / queryHistory.length,
      slowQueries: queryHistory.filter(q => (q.executionTime || 0) > 1000).length,
      recommendations: indexRecommendations.filter(r => r.priority === 'high').length
    }
  };

  return new Response(
    JSON.stringify({ queries: queryAnalytics, success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function getAllMetrics(timeWindow: number) {
  const [summary, health, cache, database] = await Promise.all([
    getPerformanceSummary(timeWindow).then(r => r.json()),
    getSystemHealth().then(r => r.json()),
    getCacheMetrics().then(r => r.json()),
    getDatabaseMetrics().then(r => r.json())
  ]);

  const insights = performanceMonitor.getInsights(20);

  return new Response(
    JSON.stringify({ 
      summary: summary.summary,
      health: health.health,
      cache: cache.cache,
      database: database.database,
      insights: insights.slice(0, 10),
      timestamp: new Date(),
      success: true
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    switch (action) {
      case 'benchmark':
        return await runBenchmark(params);
      case 'optimize':
        return await runOptimization(params);
      case 'clear_metrics':
        return await clearMetrics();
      case 'test_connection':
        return await testConnection();
      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('Performance metrics POST error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to execute performance action',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function runBenchmark(params: any) {
  const { concurrency = 10, iterations = 100 } = params;
  
  try {
    const results = await connectionManager.performanceTest(concurrency, iterations);
    
    return new Response(
      JSON.stringify({ 
        benchmark: results,
        parameters: { concurrency, iterations },
        success: true
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Benchmark failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function runOptimization(params: any) {
  try {
    const recommendations = await queryOptimizer.generateIndexRecommendations();
    
    return new Response(
      JSON.stringify({ 
        optimizations: {
          indexRecommendations: recommendations.length,
          highPriority: recommendations.filter(r => r.priority === 'high').length,
          estimatedGainTotal: recommendations.reduce((sum, r) => sum + r.estimatedGain, 0) / recommendations.length
        },
        recommendations: recommendations.slice(0, 10),
        success: true
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Optimization failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function clearMetrics() {
  try {
    performanceMonitor.clearMetrics();
    performanceMonitor.clearInsights();
    redisClient.clearMetrics();
    queryOptimizer.clearHistory();
    
    return new Response(
      JSON.stringify({ 
        message: 'All performance metrics cleared',
        success: true
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to clear metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function testConnection() {
  try {
    const dbTest = await connectionManager.getHealthStatus();
    const cacheTest = await redisClient.ping();
    
    return new Response(
      JSON.stringify({ 
        tests: {
          database: dbTest.isHealthy,
          cache: cacheTest,
          overall: dbTest.isHealthy && cacheTest
        },
        details: {
          database: dbTest,
          cache: { connected: cacheTest }
        },
        success: true
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        tests: {
          database: false,
          cache: false,
          overall: false
        },
        error: error instanceof Error ? error.message : 'Connection test failed',
        success: false
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}