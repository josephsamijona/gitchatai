/**
 * External API Integrations Routes
 * Handles Slack, email, and webhook integrations for workflow steps
 */

import { NextRequest, NextResponse } from 'next/server';
import { ExternalAPIService, createDemoExternalAPIConfig } from '../../../../lib/workflows/external-apis';

const externalAPIService = new ExternalAPIService(createDemoExternalAPIConfig());

/**
 * GET /api/workflows/integrations - Get integration status and metrics
 */
export async function GET(request: NextRequest) {
  try {
    const metrics = externalAPIService.getMetrics();

    return NextResponse.json({
      success: true,
      integrations: {
        slack: {
          enabled: process.env.SLACK_BOT_TOKEN ? true : false,
          channel: process.env.SLACK_DEFAULT_CHANNEL || '#synapse-ai'
        },
        email: {
          enabled: process.env.EMAIL_PROVIDER ? true : false,
          provider: process.env.EMAIL_PROVIDER || 'resend'
        },
        webhooks: {
          analytics_service: {
            enabled: process.env.ANALYTICS_WEBHOOK_URL ? true : false
          },
          crm_update: {
            enabled: process.env.CRM_WEBHOOK_URL ? true : false
          }
        }
      },
      metrics,
      metadata: {
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Failed to get integration status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get integration status'
    }, { status: 500 });
  }
}

/**
 * POST /api/workflows/integrations/test - Test all configured integrations
 */
export async function POST(request: NextRequest) {
  try {
    const testResults = await externalAPIService.testIntegrations();

    const summary = {
      total: Object.keys(testResults).length,
      successful: Object.values(testResults).filter(result => result.success).length,
      failed: Object.values(testResults).filter(result => !result.success).length
    };

    return NextResponse.json({
      success: true,
      testResults,
      summary,
      metadata: {
        testDate: new Date().toISOString(),
        allPassed: summary.failed === 0
      }
    });

  } catch (error) {
    console.error('Integration test failed:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Integration test failed'
    }, { status: 500 });
  }
}

/**
 * POST /api/workflows/integrations/slack - Send Slack message
 */
export async function POST(request: NextRequest) {
  const { pathname } = new URL(request.url);
  
  if (pathname.endsWith('/slack')) {
    try {
      const body = await request.json();
      const { channel, message, attachments, metadata } = body;

      if (!message) {
        return NextResponse.json({
          success: false,
          error: 'Message is required'
        }, { status: 400 });
      }

      const result = await externalAPIService.sendSlackMessage({
        channel,
        message,
        attachments,
        metadata
      });

      return NextResponse.json({
        success: result.success,
        result,
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Slack integration failed:', error);
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : 'Slack integration failed'
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: false,
    error: 'Invalid endpoint'
  }, { status: 404 });
}