import { NextRequest, NextResponse } from 'next/server';
import { healthCheck, getSystemStatus } from '@/lib/tidb';

/**
 * TiDB Health Check API Route
 * GET /api/tidb/health - Basic health check
 * GET /api/tidb/health?detailed=true - Detailed system status
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get('detailed') === 'true';

    if (detailed) {
      // Get comprehensive system status
      const status = await getSystemStatus();
      
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        status
      });
    } else {
      // Basic health check
      const health = await healthCheck();
      const isHealthy = Object.values(health).every(Boolean);
      
      return NextResponse.json({
        success: true,
        healthy: isHealthy,
        timestamp: new Date().toISOString(),
        services: health
      }, {
        status: isHealthy ? 200 : 503
      });
    }
  } catch (error) {
    console.error('Health check failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, {
      status: 500
    });
  }
}