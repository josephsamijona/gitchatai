/**
 * Individual Workflow Execution API Routes
 * Handles specific workflow execution monitoring and control
 */

import { NextRequest, NextResponse } from 'next/server';
import { WorkflowOrchestrator } from '../../../../lib/workflows/orchestrator';

// Note: In production, this would be a singleton or dependency injected
let workflowOrchestrator: WorkflowOrchestrator;

/**
 * GET /api/workflows/[executionId] - Get workflow execution status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { executionId: string } }
) {
  try {
    const { executionId } = params;

    if (!executionId) {
      return NextResponse.json({
        success: false,
        error: 'Execution ID is required'
      }, { status: 400 });
    }

    // Get execution status
    const execution = workflowOrchestrator?.getExecutionStatus(executionId);

    if (!execution) {
      return NextResponse.json({
        success: false,
        error: 'Execution not found or expired'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      execution: {
        id: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        currentStep: execution.currentStep,
        startTime: execution.startTime,
        endTime: execution.endTime,
        progress: execution.progress,
        error: execution.error?.message,
        processingTimeMs: execution.processingTimeMs,
        metadata: execution.metadata
      }
    });

  } catch (error) {
    console.error('Failed to get execution status:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get execution status'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/workflows/[executionId] - Cancel workflow execution
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { executionId: string } }
) {
  try {
    const { executionId } = params;

    if (!executionId) {
      return NextResponse.json({
        success: false,
        error: 'Execution ID is required'
      }, { status: 400 });
    }

    // Cancel execution
    const cancelled = await workflowOrchestrator?.cancelExecution(executionId);

    if (!cancelled) {
      return NextResponse.json({
        success: false,
        error: 'Execution not found or cannot be cancelled'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Workflow execution cancelled successfully'
    });

  } catch (error) {
    console.error('Failed to cancel execution:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to cancel execution'
    }, { status: 500 });
  }
}