/**
 * Service type definitions for better TypeScript integration
 */

import type { 
  WorkspaceService as WSType,
  ProjectWizardService as PWType,
  DocumentProcessingService as DPType,
  CollaborationService as CSType,
  WorkspaceManagementService as WMType 
} from './workspace';

// Re-export service class types
export type WorkspaceService = WSType;
export type ProjectWizardService = PWType;
export type DocumentProcessingService = DPType;
export type CollaborationService = CSType;
export type WorkspaceManagementService = WMType;