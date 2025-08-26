/**
 * Branch Navigation Service - Enhanced navigation and switching for Git-style branches
 * Provides keyboard shortcuts, breadcrumbs, and navigation history
 */

import { branchingService } from './branching';
import { workspaceService } from './workspace';
import type {
  Branch,
  BranchNavigationState,
  BranchTreeNode
} from '../../types';

export interface NavigationHistory {
  branchId: string;
  branchName: string;
  timestamp: Date;
  context: string;
}

export interface BreadcrumbItem {
  id: string;
  name: string;
  type: 'root' | 'branch' | 'current';
  depth: number;
}

export interface NavigationKeyboardShortcuts {
  navigateUp: string;
  navigateDown: string;
  navigateLeft: string;
  navigateRight: string;
  goToParent: string;
  goToRoot: string;
  createBranch: string;
  mergeBranch: string;
  switchModel: string;
}

export class BranchNavigationService {
  private navigationHistory: Map<string, NavigationHistory[]> = new Map();
  private currentBranch: Map<string, string> = new Map(); // userId -> branchId
  private navigationCallbacks: Map<string, Function[]> = new Map();

  /**
   * Get enhanced navigation state with history and shortcuts
   */
  async getEnhancedNavigationState(
    branchId: string,
    userId: string
  ): Promise<{
    state: BranchNavigationState;
    history: NavigationHistory[];
    breadcrumbs: BreadcrumbItem[];
    shortcuts: NavigationKeyboardShortcuts;
    quickActions: any[];
  }> {
    try {
      // Get basic navigation state
      const switchResult = await branchingService.switchToBranch(branchId, userId);
      const state = switchResult.navigationState;

      // Get navigation history
      const history = this.getNavigationHistory(userId);

      // Build breadcrumbs
      const breadcrumbs = await this.buildBreadcrumbs(branchId);

      // Define keyboard shortcuts
      const shortcuts: NavigationKeyboardShortcuts = {
        navigateUp: 'ArrowUp',
        navigateDown: 'ArrowDown',
        navigateLeft: 'ArrowLeft',
        navigateRight: 'ArrowRight',
        goToParent: 'Alt+ArrowUp',
        goToRoot: 'Ctrl+Home',
        createBranch: 'Ctrl+B',
        mergeBranch: 'Ctrl+M',
        switchModel: 'Ctrl+Shift+M'
      };

      // Get quick actions
      const quickActions = await this.getQuickActions(branchId, userId);

      // Update current branch tracking
      this.currentBranch.set(userId, branchId);

      // Add to navigation history
      this.addToNavigationHistory(userId, {
        branchId,
        branchName: switchResult.branch.name,
        timestamp: new Date(),
        context: switchResult.branch.contextSummary || ''
      });

      return {
        state,
        history,
        breadcrumbs,
        shortcuts,
        quickActions
      };

    } catch (error) {
      console.error('Failed to get enhanced navigation state:', error);
      throw new Error('Failed to get enhanced navigation state');
    }
  }

  /**
   * Navigate using keyboard shortcuts
   */
  async navigateWithKeyboard(
    currentBranchId: string,
    userId: string,
    action: keyof NavigationKeyboardShortcuts
  ): Promise<{
    targetBranchId: string | null;
    success: boolean;
    message: string;
  }> {
    try {
      const branchTree = await branchingService.getBranchTree(currentBranchId);
      const currentNode = this.findNodeInTree(branchTree, currentBranchId);

      if (!currentNode) {
        return {
          targetBranchId: null,
          success: false,
          message: 'Current branch not found in tree'
        };
      }

      let targetBranchId: string | null = null;

      switch (action) {
        case 'navigateUp':
          // Go to parent
          targetBranchId = currentNode.parentBranchId || null;
          break;

        case 'navigateDown':
          // Go to first child
          targetBranchId = currentNode.children.length > 0 
            ? currentNode.children[0].id 
            : null;
          break;

        case 'navigateLeft':
          // Go to previous sibling
          targetBranchId = await this.getPreviousSibling(currentBranchId);
          break;

        case 'navigateRight':
          // Go to next sibling
          targetBranchId = await this.getNextSibling(currentBranchId);
          break;

        case 'goToParent':
          targetBranchId = currentNode.parentBranchId || null;
          break;

        case 'goToRoot':
          targetBranchId = await this.getRootBranch(currentBranchId);
          break;

        default:
          return {
            targetBranchId: null,
            success: false,
            message: `Navigation action "${action}" not implemented`
          };
      }

      if (targetBranchId && targetBranchId !== currentBranchId) {
        await branchingService.switchToBranch(targetBranchId, userId);
        return {
          targetBranchId,
          success: true,
          message: `Navigated to branch ${targetBranchId}`
        };
      }

      return {
        targetBranchId: null,
        success: false,
        message: `No target branch available for action "${action}"`
      };

    } catch (error) {
      console.error('Navigation failed:', error);
      return {
        targetBranchId: null,
        success: false,
        message: 'Navigation failed due to error'
      };
    }
  }

  /**
   * Get navigation suggestions based on current context
   */
  async getNavigationSuggestions(
    currentBranchId: string,
    userId: string
  ): Promise<{
    similarBranches: { branchId: string; branchName: string; similarity: number }[];
    recentBranches: { branchId: string; branchName: string; lastVisited: Date }[];
    suggestedActions: string[];
  }> {
    try {
      // Get similar branches based on context
      const similarBranches = await this.findSimilarBranches(currentBranchId, 5);

      // Get recent branches from history
      const history = this.getNavigationHistory(userId);
      const recentBranches = history
        .slice(-5)
        .filter(h => h.branchId !== currentBranchId)
        .map(h => ({
          branchId: h.branchId,
          branchName: h.branchName,
          lastVisited: h.timestamp
        }));

      // Generate action suggestions
      const suggestedActions = await this.generateActionSuggestions(currentBranchId);

      return {
        similarBranches,
        recentBranches,
        suggestedActions
      };

    } catch (error) {
      console.error('Failed to get navigation suggestions:', error);
      return {
        similarBranches: [],
        recentBranches: [],
        suggestedActions: []
      };
    }
  }

  /**
   * Register navigation event callback
   */
  onNavigationEvent(userId: string, callback: Function): void {
    if (!this.navigationCallbacks.has(userId)) {
      this.navigationCallbacks.set(userId, []);
    }
    this.navigationCallbacks.get(userId)!.push(callback);
  }

  /**
   * Remove navigation event callback
   */
  offNavigationEvent(userId: string, callback: Function): void {
    const callbacks = this.navigationCallbacks.get(userId);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Get current branch for user
   */
  getCurrentBranch(userId: string): string | null {
    return this.currentBranch.get(userId) || null;
  }

  /**
   * Clear navigation history for user
   */
  clearNavigationHistory(userId: string): void {
    this.navigationHistory.delete(userId);
  }

  // Private helper methods

  private getNavigationHistory(userId: string): NavigationHistory[] {
    return this.navigationHistory.get(userId) || [];
  }

  private addToNavigationHistory(userId: string, entry: NavigationHistory): void {
    if (!this.navigationHistory.has(userId)) {
      this.navigationHistory.set(userId, []);
    }

    const history = this.navigationHistory.get(userId)!;
    
    // Don't add duplicate consecutive entries
    if (history.length > 0 && history[history.length - 1].branchId === entry.branchId) {
      return;
    }

    history.push(entry);

    // Keep only last 50 entries
    if (history.length > 50) {
      history.shift();
    }
  }

  private async buildBreadcrumbs(branchId: string): Promise<BreadcrumbItem[]> {
    const breadcrumbs: BreadcrumbItem[] = [];
    let currentId: string | null = branchId;
    let depth = 0;

    // Build path from current to root
    const path: { id: string; name: string; depth: number }[] = [];
    
    while (currentId) {
      try {
        const switchResult = await branchingService.switchToBranch(currentId, 'system');
        path.unshift({
          id: currentId,
          name: switchResult.branch.name,
          depth
        });
        
        currentId = switchResult.branch.parentBranchId || null;
        depth++;
      } catch (error) {
        break;
      }
    }

    // Convert to breadcrumb items
    for (let i = 0; i < path.length; i++) {
      const item = path[i];
      breadcrumbs.push({
        id: item.id,
        name: item.name,
        type: i === 0 ? 'root' : i === path.length - 1 ? 'current' : 'branch',
        depth: item.depth
      });
    }

    return breadcrumbs;
  }

  private async getQuickActions(branchId: string, userId: string): Promise<any[]> {
    const actions = [];

    // Get branch info
    const switchResult = await branchingService.switchToBranch(branchId, userId);
    const branch = switchResult.branch;

    // Always available actions
    actions.push(
      {
        id: 'create_branch',
        label: 'Create Branch',
        icon: 'git-branch',
        shortcut: 'Ctrl+B',
        description: 'Create a new branch from current position'
      },
      {
        id: 'switch_model',
        label: 'Switch AI Model',
        icon: 'cpu',
        shortcut: 'Ctrl+Shift+M',
        description: `Currently using ${branch.model}`
      }
    );

    // Conditional actions
    if (branch.parentBranchId) {
      actions.push({
        id: 'merge_branch',
        label: 'Merge Branch',
        icon: 'git-merge',
        shortcut: 'Ctrl+M',
        description: 'Merge this branch with parent'
      });

      actions.push({
        id: 'compare_parent',
        label: 'Compare with Parent',
        icon: 'compare',
        shortcut: 'Ctrl+D',
        description: 'Compare this branch with parent branch'
      });
    }

    if (switchResult.navigationState.childBranchIds.length > 0) {
      actions.push({
        id: 'view_children',
        label: 'View Child Branches',
        icon: 'tree',
        shortcut: 'Ctrl+T',
        description: `View ${switchResult.navigationState.childBranchIds.length} child branches`
      });
    }

    return actions;
  }

  private findNodeInTree(tree: BranchTreeNode[], branchId: string): BranchTreeNode | null {
    for (const node of tree) {
      if (node.id === branchId) {
        return node;
      }
      
      const found = this.findNodeInTree(node.children, branchId);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  private async getPreviousSibling(branchId: string): Promise<string | null> {
    try {
      const switchResult = await branchingService.switchToBranch(branchId, 'system');
      const branch = switchResult.branch;
      
      if (!branch.parentBranchId) return null;

      const siblings = switchResult.navigationState.siblingBranchIds;
      const currentIndex = siblings.indexOf(branchId);
      
      return currentIndex > 0 ? siblings[currentIndex - 1] : null;
    } catch (error) {
      return null;
    }
  }

  private async getNextSibling(branchId: string): Promise<string | null> {
    try {
      const switchResult = await branchingService.switchToBranch(branchId, 'system');
      const siblings = switchResult.navigationState.siblingBranchIds;
      const currentIndex = siblings.indexOf(branchId);
      
      return currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;
    } catch (error) {
      return null;
    }
  }

  private async getRootBranch(branchId: string): Promise<string | null> {
    try {
      let currentId = branchId;
      
      while (currentId) {
        const switchResult = await branchingService.switchToBranch(currentId, 'system');
        if (!switchResult.branch.parentBranchId) {
          return currentId;
        }
        currentId = switchResult.branch.parentBranchId;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  private async findSimilarBranches(
    branchId: string,
    limit: number
  ): Promise<{ branchId: string; branchName: string; similarity: number }[]> {
    try {
      // Get current branch context
      const switchResult = await branchingService.switchToBranch(branchId, 'system');
      const branch = switchResult.branch;
      
      if (!branch.contextEmbedding || branch.contextEmbedding.length === 0) {
        return [];
      }

      // This would use vector similarity search in TiDB
      // For now, return empty array as placeholder
      return [];
      
    } catch (error) {
      console.error('Failed to find similar branches:', error);
      return [];
    }
  }

  private async generateActionSuggestions(branchId: string): Promise<string[]> {
    const suggestions: string[] = [];
    
    try {
      const switchResult = await branchingService.switchToBranch(branchId, 'system');
      const branch = switchResult.branch;
      const nav = switchResult.navigationState;
      
      // Suggest creating a branch if this branch has many messages
      if (switchResult.messages.length > 5) {
        suggestions.push('Consider creating a branch to explore alternative approaches');
      }
      
      // Suggest merging if branch has children
      if (nav.childBranchIds.length > 1) {
        suggestions.push('Multiple child branches available - consider merging insights');
      }
      
      // Suggest model switching if using same model for a while
      if (switchResult.messages.filter(m => m.model === branch.model).length > 10) {
        suggestions.push(`Try switching from ${branch.model} to get different perspectives`);
      }
      
    } catch (error) {
      console.error('Failed to generate action suggestions:', error);
    }
    
    return suggestions;
  }

  private notifyNavigationEvent(userId: string, event: any): void {
    const callbacks = this.navigationCallbacks.get(userId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error('Navigation callback error:', error);
        }
      });
    }
  }
}

// Export singleton instance
export const branchNavigationService = new BranchNavigationService();