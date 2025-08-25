/**
 * Central export file for all repository classes
 * SYNAPSE AI Platform - Repository Layer
 */

// Export base repository
export { BaseRepository } from './base';

// Export specific repositories
export { ConversationRepository } from './conversation';
export { BranchRepository } from './branch';
export { MessageRepository } from './message';
export { ProjectRepository } from './project';
export { DocumentRepository } from './document';
export { ConceptRepository } from './concept';

// Repository factory for dependency injection
import { ConversationRepository } from './conversation';
import { BranchRepository } from './branch';
import { MessageRepository } from './message';
import { ProjectRepository } from './project';
import { DocumentRepository } from './document';
import { ConceptRepository } from './concept';

export class RepositoryFactory {
  private static instances = new Map();

  static getConversationRepository(): ConversationRepository {
    if (!this.instances.has('conversation')) {
      this.instances.set('conversation', new ConversationRepository());
    }
    return this.instances.get('conversation');
  }

  static getBranchRepository(): BranchRepository {
    if (!this.instances.has('branch')) {
      this.instances.set('branch', new BranchRepository());
    }
    return this.instances.get('branch');
  }

  static getMessageRepository(): MessageRepository {
    if (!this.instances.has('message')) {
      this.instances.set('message', new MessageRepository());
    }
    return this.instances.get('message');
  }

  static getProjectRepository(): ProjectRepository {
    if (!this.instances.has('project')) {
      this.instances.set('project', new ProjectRepository());
    }
    return this.instances.get('project');
  }

  static getDocumentRepository(): DocumentRepository {
    if (!this.instances.has('document')) {
      this.instances.set('document', new DocumentRepository());
    }
    return this.instances.get('document');
  }

  static getConceptRepository(): ConceptRepository {
    if (!this.instances.has('concept')) {
      this.instances.set('concept', new ConceptRepository());
    }
    return this.instances.get('concept');
  }

  static clearInstances(): void {
    this.instances.clear();
  }
}

// Convenience function to get all repositories
export function getAllRepositories() {
  return {
    conversation: RepositoryFactory.getConversationRepository(),
    branch: RepositoryFactory.getBranchRepository(),
    message: RepositoryFactory.getMessageRepository(),
    project: RepositoryFactory.getProjectRepository(),
    document: RepositoryFactory.getDocumentRepository(),
    concept: RepositoryFactory.getConceptRepository()
  };
}