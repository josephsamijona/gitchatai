import { NextRequest, NextResponse } from 'next/server';
import { initializeTiDBStack } from '@/lib/tidb';

/**
 * TiDB Initialization API Route
 * POST /api/tidb/init - Initialize TiDB stack (development only)
 */

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({
      success: false,
      error: 'Initialization not allowed in production'
    }, {
      status: 403
    });
  }

  try {
    console.log('Starting TiDB stack initialization...');
    
    await initializeTiDBStack();
    
    return NextResponse.json({
      success: true,
      message: 'TiDB stack initialized successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('TiDB initialization failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'TiDB initialization failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, {
      status: 500
    });
  }
}