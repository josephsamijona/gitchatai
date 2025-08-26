/**
 * Services index - Export all workspace, management, and knowledge graph services
 * SYNAPSE AI Platform - Task 5 & 7 Implementation Complete
 */

// Core workspace services
export { workspaceService } from './workspace';
export { projectWizardService } from './project-wizard';
export { documentProcessingService } from './document-processing';
export { collaborationService } from './collaboration';
export { workspaceManagementService } from './workspace-management';

// Branching services (Task 6)
export { branchingService } from './branching';
export { branchNavigationService } from './branch-navigation';
export { branchMergingService } from './branch-merging';
export { branchVisualizationService } from './branch-visualization';

// Knowledge graph services (Task 7)
export { knowledgeGraphService } from './knowledge-graph';
export { conceptAnalyticsService } from './concept-analytics';
export { graphVisualizationService } from './graph-visualization';

// Search services (Task 8)
export { universalSearchService } from './universal-search';

// Real-time collaboration services (Task 9)
export { webSocketService } from './websocket';
export { realtimeCollaborationService } from './realtime-collaboration';

// Service types for better TypeScript integration
export type {
  WorkspaceService,
  ProjectWizardService,
  DocumentProcessingService,
  CollaborationService,
  WorkspaceManagementService
} from './types';

// Service factory for dependency injection
export class ServiceFactory {
  private static instance: ServiceFactory;
  
  private constructor() {}
  
  static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }
  
  // Workspace services
  getWorkspaceService() {
    return workspaceService;
  }
  
  getProjectWizardService() {
    return projectWizardService;
  }
  
  getDocumentProcessingService() {
    return documentProcessingService;
  }
  
  getCollaborationService() {
    return collaborationService;
  }
  
  getWorkspaceManagementService() {
    return workspaceManagementService;
  }

  // Branching services
  getBranchingService() {
    return branchingService;
  }
  
  getBranchNavigationService() {
    return branchNavigationService;
  }
  
  getBranchMergingService() {
    return branchMergingService;
  }
  
  getBranchVisualizationService() {
    return branchVisualizationService;
  }

  // Knowledge graph services
  getKnowledgeGraphService() {
    return knowledgeGraphService;
  }
  
  getConceptAnalyticsService() {
    return conceptAnalyticsService;
  }
  
  getGraphVisualizationService() {
    return graphVisualizationService;
  }

  // Search services
  getUniversalSearchService() {
    return universalSearchService;
  }

  // Real-time collaboration services
  getWebSocketService() {
    return webSocketService;
  }
  
  getRealtimeCollaborationService() {
    return realtimeCollaborationService;
  }
}