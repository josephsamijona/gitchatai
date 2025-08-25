/**
 * WorkflowVisualizer Component
 * Real-time visualization of multi-step workflow execution
 * Demonstrates TiDB performance and AI orchestration pipeline
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Pause, 
  Square, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Database,
  Brain,
  Search,
  Send,
  Zap
} from 'lucide-react';
import { StepIndicator } from './StepIndicator';
import { DataFlow } from './DataFlow';
import { ProcessingStages } from './ProcessingStages';
import type { 
  WorkflowExecution, 
  WorkflowProgress, 
  WorkflowDefinition 
} from '../../../types/workflow';

interface WorkflowVisualizerProps {
  className?: string;
}

const demoWorkflows: WorkflowDefinition[] = [
  {
    id: 'document-ingestion',
    name: 'Document Ingestion & Knowledge Extraction',
    description: 'Complete pipeline for document processing and knowledge graph updates',
    steps: [
      {
        id: 'ingestion',
        name: 'Document Ingestion',
        type: 'ingestion',
        description: 'Process and chunk document content',
        configuration: { chunkSize: 1000, overlap: 200 },
        critical: true
      },
      {
        id: 'embedding',
        name: 'Vector Embedding Generation',
        type: 'embedding',
        description: 'Generate embeddings for document chunks',
        configuration: { model: 'text-embedding-3-small' },
        critical: true
      },
      {
        id: 'storage',
        name: 'TiDB Vector Storage',
        type: 'storage',
        description: 'Store document and embeddings in TiDB Serverless',
        configuration: { updateIndexes: true },
        critical: true
      },
      {
        id: 'search',
        name: 'Content Analysis Search',
        type: 'search',
        description: 'Find related content using hybrid vector + full-text search',
        configuration: { searchType: 'hybrid', maxResults: 20 },
        critical: false
      },
      {
        id: 'llm_analysis',
        name: 'AI Content Analysis',
        type: 'llm',
        description: 'Extract concepts and insights using multi-model AI',
        configuration: { model: 'claude', extractConcepts: true },
        critical: true
      },
      {
        id: 'external_notification',
        name: 'Team Notification',
        type: 'external',
        description: 'Notify team members via Slack/email',
        configuration: { channels: ['slack', 'email'] },
        critical: false
      },
      {
        id: 'synthesis',
        name: 'Knowledge Graph Update',
        type: 'synthesis',
        description: 'Update knowledge graph with new concepts and relationships',
        configuration: { updateExisting: true },
        critical: true
      }
    ],
    metadata: {
      category: 'document_processing',
      estimatedDuration: 30000,
      tidbOperations: ['vector_insert', 'fulltext_search', 'analytics_query'],
      demoFeatures: ['vector_search', 'htap_analytics', 'real_time_updates']
    }
  },
  {
    id: 'research-workflow',
    name: 'Research & Educational Workflow',
    description: 'Comprehensive research workflow for educational use cases',
    steps: [
      {
        id: 'query_processing',
        name: 'Research Query Processing',
        type: 'ingestion',
        description: 'Process and analyze research query',
        configuration: { expandQuery: true },
        critical: true
      },
      {
        id: 'multi_search',
        name: 'Multi-Source Search',
        type: 'search',
        description: 'Search across documents, conversations, and knowledge base',
        configuration: { searchType: 'hybrid', sources: ['documents', 'conversations', 'concepts'] },
        critical: true
      },
      {
        id: 'ai_research',
        name: 'AI Research Analysis',
        type: 'llm',
        description: 'Generate comprehensive research insights',
        configuration: { model: 'claude', generateOutline: true },
        critical: true
      },
      {
        id: 'collaboration',
        name: 'Team Collaboration',
        type: 'external',
        description: 'Share findings with research team',
        configuration: { channels: ['slack', 'email'], generateReport: true },
        critical: false
      },
      {
        id: 'synthesis',
        name: 'Research Synthesis',
        type: 'synthesis',
        description: 'Create structured research output and update knowledge',
        configuration: { generateSummary: true },
        critical: true
      }
    ],
    metadata: {
      category: 'research_education',
      estimatedDuration: 35000,
      tidbOperations: ['vector_search', 'fulltext_search', 'concept_clustering'],
      demoFeatures: ['educational_use', 'cost_savings', 'collaboration']
    }
  }
];

const stepIcons = {
  ingestion: Database,
  embedding: Zap,
  storage: Database,
  search: Search,
  llm: Brain,
  external: Send,
  synthesis: CheckCircle
};

export function WorkflowVisualizer({ className }: WorkflowVisualizerProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDefinition>(demoWorkflows[0]);
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [metrics, setMetrics] = useState({
    totalTime: 0,
    stepsCompleted: 0,
    tidbOperations: 0,
    conceptsExtracted: 0
  });

  // Simulate workflow execution
  const executeWorkflow = useCallback(async () => {
    if (isRunning) return;

    setIsRunning(true);
    setProgress(null);
    setMetrics({ totalTime: 0, stepsCompleted: 0, tidbOperations: 0, conceptsExtracted: 0 });

    const executionId = `demo_${Date.now()}`;
    const startTime = new Date();

    // Create mock execution
    const mockExecution: WorkflowExecution = {
      id: executionId,
      workflowId: selectedWorkflow.id,
      status: 'running',
      startTime,
      context: {
        type: 'document',
        content: 'Demo document content for hackathon visualization...',
        projectId: 'demo-project'
      },
      currentStep: 0,
      results: {},
      progress: {
        executionId,
        currentStep: 0,
        totalSteps: selectedWorkflow.steps.length,
        stepResults: {},
        status: 'running',
        startTime,
        processingTimeMs: 0,
        metadata: {}
      },
      metadata: {
        tidbMetrics: {},
        performanceMetrics: {},
        stepTimings: {}
      }
    };

    setExecution(mockExecution);

    // Simulate step-by-step execution
    for (let i = 0; i < selectedWorkflow.steps.length; i++) {
      const step = selectedWorkflow.steps[i];
      const stepStartTime = Date.now();

      // Update progress
      const currentProgress: WorkflowProgress = {
        executionId,
        currentStep: i,
        totalSteps: selectedWorkflow.steps.length,
        stepResults: {},
        status: 'running',
        message: `Executing: ${step.name}`,
        startTime,
        processingTimeMs: Date.now() - startTime.getTime(),
        metadata: {
          stepName: step.name,
          stepType: step.type
        }
      };

      setProgress(currentProgress);

      // Simulate step processing time
      const processingTime = Math.random() * 3000 + 1000; // 1-4 seconds
      await new Promise(resolve => setTimeout(resolve, processingTime));

      // Update metrics
      setMetrics(prev => ({
        totalTime: prev.totalTime + processingTime,
        stepsCompleted: prev.stepsCompleted + 1,
        tidbOperations: prev.tidbOperations + (step.type === 'storage' || step.type === 'search' ? 1 : 0),
        conceptsExtracted: prev.conceptsExtracted + (step.type === 'synthesis' ? Math.floor(Math.random() * 5) + 3 : 0)
      }));

      // Mark step as completed
      mockExecution.results[step.id] = {
        success: true,
        processingTime,
        data: generateMockStepResult(step.type)
      };
    }

    // Complete execution
    mockExecution.status = 'completed';
    mockExecution.endTime = new Date();
    mockExecution.processingTimeMs = Date.now() - startTime.getTime();

    const finalProgress: WorkflowProgress = {
      executionId,
      currentStep: selectedWorkflow.steps.length,
      totalSteps: selectedWorkflow.steps.length,
      stepResults: mockExecution.results,
      status: 'completed',
      message: 'Workflow completed successfully!',
      startTime,
      processingTimeMs: mockExecution.processingTimeMs,
      metadata: {
        success: true,
        stepsCompleted: selectedWorkflow.steps.length
      }
    };

    setProgress(finalProgress);
    setExecution(mockExecution);
    setIsRunning(false);
  }, [selectedWorkflow, isRunning]);

  const stopWorkflow = () => {
    setIsRunning(false);
    setProgress(prev => prev ? { ...prev, status: 'cancelled', message: 'Workflow cancelled by user' } : null);
    setExecution(prev => prev ? { ...prev, status: 'cancelled' } : null);
  };

  const resetWorkflow = () => {
    setExecution(null);
    setProgress(null);
    setIsRunning(false);
    setMetrics({ totalTime: 0, stepsCompleted: 0, tidbOperations: 0, conceptsExtracted: 0 });
  };

  return (
    <div className={`workflow-visualizer bg-white rounded-lg shadow-lg p-6 ${className}`}>
      {/* Header Controls */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Multi-Step Workflow Demonstration
          </h2>
          <p className="text-gray-600">
            Real-time visualization of TiDB Serverless AI agent workflows
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedWorkflow.id}
            onChange={(e) => setSelectedWorkflow(demoWorkflows.find(w => w.id === e.target.value)!)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isRunning}
          >
            {demoWorkflows.map(workflow => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>

          <button
            onClick={executeWorkflow}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'Running...' : 'Execute Workflow'}
          </button>

          {isRunning && (
            <button
              onClick={stopWorkflow}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          )}

          <button
            onClick={resetWorkflow}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Workflow Info */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-gray-900 mb-2">{selectedWorkflow.name}</h3>
        <p className="text-gray-600 mb-3">{selectedWorkflow.description}</p>
        <div className="flex items-center gap-6 text-sm text-gray-500">
          <span>Steps: {selectedWorkflow.steps.length}</span>
          <span>Est. Duration: {Math.round(selectedWorkflow.metadata.estimatedDuration / 1000)}s</span>
          <span>Category: {selectedWorkflow.metadata.category}</span>
        </div>
      </div>

      {/* Progress Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Step Progress */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-4">Workflow Steps</h4>
            
            <div className="space-y-3">
              {selectedWorkflow.steps.map((step, index) => {
                const StepIcon = stepIcons[step.type];
                const isActive = progress && progress.currentStep === index;
                const isCompleted = progress && progress.currentStep > index;
                const isCurrent = progress && progress.currentStep === index && progress.status === 'running';

                return (
                  <motion.div
                    key={step.id}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                      isActive || isCurrent ? 'bg-blue-50 border-2 border-blue-200' :
                      isCompleted ? 'bg-green-50 border border-green-200' :
                      'bg-gray-50 border border-gray-200'
                    }`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      isCompleted ? 'bg-green-600' :
                      isActive || isCurrent ? 'bg-blue-600' :
                      'bg-gray-400'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle className="w-5 h-5 text-white" />
                      ) : (
                        <StepIcon className={`w-4 h-4 ${
                          isActive || isCurrent ? 'text-white' : 'text-white'
                        }`} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h5 className={`font-medium truncate ${
                          isActive || isCurrent ? 'text-blue-900' :
                          isCompleted ? 'text-green-900' :
                          'text-gray-900'
                        }`}>
                          {step.name}
                        </h5>
                        {step.critical && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Critical
                          </span>
                        )}
                      </div>
                      <p className={`text-sm truncate ${
                        isActive || isCurrent ? 'text-blue-700' :
                        isCompleted ? 'text-green-700' :
                        'text-gray-500'
                      }`}>
                        {step.description}
                      </p>
                    </div>

                    {isCurrent && (
                      <div className="flex-shrink-0">
                        <motion.div
                          className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                    )}

                    {isCompleted && execution?.results[step.id] && (
                      <div className="flex-shrink-0 text-xs text-green-600">
                        {Math.round(execution.results[step.id].processingTime)}ms
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Metrics and Status */}
        <div className="space-y-4">
          {/* Current Status */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Execution Status</h4>
            
            {progress ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    progress.status === 'completed' ? 'bg-green-500' :
                    progress.status === 'running' ? 'bg-blue-500 animate-pulse' :
                    progress.status === 'cancelled' ? 'bg-red-500' :
                    'bg-gray-400'
                  }`} />
                  <span className="text-sm font-medium capitalize">{progress.status}</span>
                </div>
                
                {progress.message && (
                  <p className="text-sm text-gray-600">{progress.message}</p>
                )}

                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.currentStep / progress.totalSteps) * 100}%` }}
                  />
                </div>
                
                <div className="text-xs text-gray-500">
                  Step {progress.currentStep} of {progress.totalSteps}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Ready to execute workflow</p>
            )}
          </div>

          {/* Performance Metrics */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-3">Performance Metrics</h4>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Time</span>
                <span className="text-sm font-medium">
                  {Math.round(metrics.totalTime)}ms
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Steps Completed</span>
                <span className="text-sm font-medium">
                  {metrics.stepsCompleted} / {selectedWorkflow.steps.length}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">TiDB Operations</span>
                <span className="text-sm font-medium">{metrics.tidbOperations}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Concepts Extracted</span>
                <span className="text-sm font-medium">{metrics.conceptsExtracted}</span>
              </div>
            </div>
          </div>

          {/* TiDB Features */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-3">TiDB Serverless Features</h4>
            
            <div className="space-y-2">
              {selectedWorkflow.metadata.demoFeatures.map(feature => (
                <div key={feature} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-blue-800 capitalize">
                    {feature.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data Flow Visualization */}
      {(isRunning || execution) && (
        <div className="mt-6">
          <DataFlow 
            steps={selectedWorkflow.steps}
            currentStep={progress?.currentStep || 0}
            isRunning={isRunning}
          />
        </div>
      )}
    </div>
  );
}

// Helper function to generate mock step results
function generateMockStepResult(stepType: string): any {
  switch (stepType) {
    case 'ingestion':
      return { chunksCreated: Math.floor(Math.random() * 10) + 5 };
    case 'embedding':
      return { embeddingsGenerated: Math.floor(Math.random() * 10) + 5 };
    case 'storage':
      return { recordsStored: Math.floor(Math.random() * 10) + 5, indexesUpdated: 2 };
    case 'search':
      return { resultsFound: Math.floor(Math.random() * 20) + 10, searchTime: Math.floor(Math.random() * 100) + 50 };
    case 'llm':
      return { responseGenerated: true, tokensUsed: Math.floor(Math.random() * 1000) + 500 };
    case 'external':
      return { notificationsSent: Math.floor(Math.random() * 3) + 1 };
    case 'synthesis':
      return { conceptsExtracted: Math.floor(Math.random() * 5) + 3, relationshipsCreated: Math.floor(Math.random() * 8) + 2 };
    default:
      return { success: true };
  }
}