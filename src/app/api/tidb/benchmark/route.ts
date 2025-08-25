import { NextRequest, NextResponse } from 'next/server';
import { PerformanceMonitor } from '@/lib/tidb';

/**
 * TiDB Performance Benchmark API Route
 * POST /api/tidb/benchmark - Run performance benchmarks
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      benchmarkType = 'vector_search',
      testQueries = 50,
      embeddingDimension = 1536
    } = body;

    console.log(`Starting ${benchmarkType} benchmark with ${testQueries} queries...`);
    
    let benchmark;
    
    switch (benchmarkType) {
      case 'vector_search':
        benchmark = await PerformanceMonitor.runVectorSearchBenchmark(
          embeddingDimension,
          testQueries
        );
        break;
        
      case 'hybrid_search':
        benchmark = await PerformanceMonitor.runHybridSearchBenchmark(testQueries);
        break;
        
      case 'comprehensive':
        const report = await PerformanceMonitor.generatePerformanceReport();
        return NextResponse.json({
          success: true,
          benchmarkType: 'comprehensive',
          report,
          timestamp: new Date().toISOString()
        });
        
      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid benchmark type. Use: vector_search, hybrid_search, or comprehensive'
        }, {
          status: 400
        });
    }

    // Check if benchmark meets performance requirements
    const meetsRequirements = {
      avgSearchTime: benchmark.avgSearchTime < 200, // <200ms requirement
      p95SearchTime: benchmark.p95SearchTime < 300, // P95 should be reasonable
      throughput: benchmark.throughputQps > 5 // Minimum throughput
    };

    const overallPass = Object.values(meetsRequirements).every(Boolean);

    return NextResponse.json({
      success: true,
      benchmarkType,
      benchmark,
      requirements: {
        checks: meetsRequirements,
        passed: overallPass,
        notes: {
          avgSearchTime: 'Must be < 200ms for hackathon requirements',
          p95SearchTime: 'P95 latency should be reasonable',
          throughput: 'Minimum 5 queries per second'
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Benchmark failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Benchmark failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, {
      status: 500
    });
  }
}