/**
 * Branch Visualization Service - D3.js data preparation for Git-style branch trees
 * Generates optimized data structures for interactive branch visualization
 */

import { branchingService } from './branching';
import { branchNavigationService } from './branch-navigation';
import { workspaceService } from './workspace';
import type {
  Branch,
  BranchTreeNode,
  BranchStatistics,
  AIModel
} from '../../types';

export interface D3TreeNode {
  id: string;
  name: string;
  model: AIModel;
  group: number;
  size: number;
  color: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  depth: number;
  messageCount: number;
  lastActivity: Date;
  isActive: boolean;
  metadata: {
    branchPoint?: string;
    contextSummary?: string;
    parentId?: string;
    childrenCount: number;
    createdAt: Date;
    modelColor: string;
    activityScore: number;
    importance: number;
  };
  tooltip: {
    title: string;
    subtitle: string;
    details: string[];
    metrics: Array<{ label: string; value: string | number }>;
  };
}

export interface D3TreeLink {
  source: string;
  target: string;
  type: 'parent_child' | 'merge_relation' | 'similar_context';
  strength: number;
  distance: number;
  color: string;
  strokeWidth: number;
  animated: boolean;
  metadata: {
    createdAt: Date;
    messageCountDiff: number;
    modelTransition?: { from: AIModel; to: AIModel };
    branchPoint?: string;
  };
}

export interface D3LayoutConfig {
  type: 'force' | 'tree' | 'radial' | 'timeline';
  width: number;
  height: number;
  forces: {
    charge: number;
    linkDistance: number;
    centerForce: number;
    collideRadius: number;
    gravity: number;
  };
  animation: {
    duration: number;
    easing: string;
    stagger: number;
  };
  zoom: {
    minScale: number;
    maxScale: number;
    initialScale: number;
  };
}

export interface BranchVisualizationData {
  nodes: D3TreeNode[];
  links: D3TreeLink[];
  layout: D3LayoutConfig;
  statistics: {
    totalBranches: number;
    maxDepth: number;
    modelDistribution: Record<AIModel, number>;
    activityHeatmap: Array<{ date: string; activity: number }>;
  };
  interactions: {
    enableDrag: boolean;
    enableZoom: boolean;
    enableSelection: boolean;
    enableContextMenu: boolean;
    keyboardShortcuts: boolean;
  };
  styling: {
    theme: 'light' | 'dark';
    colorScheme: Record<AIModel, string>;
    fontFamily: string;
    animations: boolean;
  };
}

export class BranchVisualizationService {

  /**
   * Generate complete visualization data for D3.js
   */
  async generateVisualizationData(
    conversationId: string,
    config: {
      layoutType?: D3LayoutConfig['type'];
      theme?: 'light' | 'dark';
      width?: number;
      height?: number;
      activeBranchId?: string;
      showMetrics?: boolean;
      animateTransitions?: boolean;
    } = {}
  ): Promise<BranchVisualizationData> {
    try {
      const {
        layoutType = 'force',
        theme = 'light',
        width = 1200,
        height = 800,
        activeBranchId,
        showMetrics = true,
        animateTransitions = true
      } = config;

      // Get branch tree data
      const branchTree = await branchingService.getBranchTree(conversationId);
      
      // Get branch statistics
      const statistics = await this.getBranchStatistics(conversationId);
      
      // Generate D3 nodes
      const nodes = await this.generateD3Nodes(branchTree, activeBranchId, showMetrics);
      
      // Generate D3 links
      const links = await this.generateD3Links(branchTree, statistics);
      
      // Create layout configuration
      const layout = this.createLayoutConfig(layoutType, width, height, animateTransitions);
      
      // Generate interaction configuration
      const interactions = this.createInteractionConfig();
      
      // Create styling configuration
      const styling = this.createStylingConfig(theme);

      return {
        nodes,
        links,
        layout,
        statistics: {
          totalBranches: nodes.length,
          maxDepth: Math.max(...nodes.map(n => n.depth)),
          modelDistribution: this.calculateModelDistribution(nodes),
          activityHeatmap: await this.generateActivityHeatmap(conversationId)
        },
        interactions,
        styling
      };

    } catch (error) {
      console.error('Failed to generate visualization data:', error);
      throw new Error('Failed to generate visualization data');
    }
  }

  /**
   * Generate optimized force-directed layout data
   */
  async generateForceLayoutData(
    conversationId: string,
    options: {
      centerNode?: string;
      groupBySimilarity?: boolean;
      emphasizeRecent?: boolean;
    } = {}
  ): Promise<{
    nodes: D3TreeNode[];
    links: D3TreeLink[];
    groups: Array<{ id: string; nodes: string[]; color: string }>;
  }> {
    try {
      const branchTree = await branchingService.getBranchTree(conversationId);
      const nodes = await this.generateD3Nodes(branchTree, options.centerNode);
      const links = await this.generateD3Links(branchTree);

      // Position nodes for force layout
      const centeredNodes = this.positionNodesForForceLayout(
        nodes,
        options.centerNode,
        options.emphasizeRecent
      );

      // Group nodes by similarity if requested
      const groups = options.groupBySimilarity 
        ? await this.groupNodesBySimilarity(centeredNodes, conversationId)
        : [];

      return {
        nodes: centeredNodes,
        links,
        groups
      };

    } catch (error) {
      console.error('Failed to generate force layout data:', error);
      throw new Error('Failed to generate force layout data');
    }
  }

  /**
   * Generate timeline-based visualization data
   */
  async generateTimelineVisualizationData(
    conversationId: string,
    options: {
      timeScale: 'hours' | 'days' | 'weeks';
      showParallelBranches?: boolean;
    }
  ): Promise<{
    nodes: (D3TreeNode & { timestamp: Date; lane: number })[];
    timeline: Array<{ date: Date; label: string; events: number }>;
    lanes: Array<{ id: number; label: string; color: string }>;
  }> {
    try {
      const branchTree = await branchingService.getBranchTree(conversationId);
      const baseNodes = await this.generateD3Nodes(branchTree);

      // Add timeline positioning
      const timelineNodes = baseNodes.map(node => ({
        ...node,
        timestamp: node.metadata.createdAt,
        lane: this.assignTimelineLane(node, baseNodes)
      }));

      // Generate timeline scale
      const timeline = this.generateTimelineScale(timelineNodes, options.timeScale);
      
      // Create lane definitions
      const lanes = this.createTimelineLanes(timelineNodes);

      return {
        nodes: timelineNodes,
        timeline,
        lanes
      };

    } catch (error) {
      console.error('Failed to generate timeline visualization:', error);
      throw new Error('Failed to generate timeline visualization');
    }
  }

  /**
   * Generate interactive minimap data
   */
  async generateMinimapData(
    conversationId: string,
    currentViewport: { x: number; y: number; scale: number }
  ): Promise<{
    overview: D3TreeNode[];
    viewport: { x: number; y: number; width: number; height: number };
    hotspots: Array<{ x: number; y: number; importance: number; label: string }>;
  }> {
    try {
      const branchTree = await branchingService.getBranchTree(conversationId);
      const nodes = await this.generateD3Nodes(branchTree);
      
      // Create simplified overview nodes
      const overview = nodes.map(node => ({
        ...node,
        size: Math.max(2, node.size * 0.3), // Smaller for overview
        x: (node.x || 0) * 0.1, // Scale down positions
        y: (node.y || 0) * 0.1
      }));

      // Calculate viewport rectangle
      const viewport = {
        x: currentViewport.x * 0.1,
        y: currentViewport.y * 0.1,
        width: 120 / currentViewport.scale,
        height: 80 / currentViewport.scale
      };

      // Identify hotspots (important nodes)
      const hotspots = overview
        .filter(node => node.metadata.importance > 0.7)
        .map(node => ({
          x: node.x || 0,
          y: node.y || 0,
          importance: node.metadata.importance,
          label: node.name
        }));

      return {
        overview,
        viewport,
        hotspots
      };

    } catch (error) {
      console.error('Failed to generate minimap data:', error);
      throw new Error('Failed to generate minimap data');
    }
  }

  /**
   * Update visualization with real-time changes
   */
  async updateVisualizationWithChanges(
    existingData: BranchVisualizationData,
    changes: {
      newBranches?: string[];
      updatedBranches?: string[];
      deletedBranches?: string[];
      activeBranchChange?: { from: string; to: string };
    }
  ): Promise<{
    updatedNodes: D3TreeNode[];
    updatedLinks: D3TreeLink[];
    animations: Array<{ type: string; target: string; duration: number }>;
  }> {
    try {
      const animations: Array<{ type: string; target: string; duration: number }> = [];
      let updatedNodes = [...existingData.nodes];
      let updatedLinks = [...existingData.links];

      // Handle new branches
      if (changes.newBranches) {
        for (const branchId of changes.newBranches) {
          // Add animation for new node appearance
          animations.push({
            type: 'node_enter',
            target: branchId,
            duration: 800
          });
        }
      }

      // Handle active branch change
      if (changes.activeBranchChange) {
        // Update active states
        updatedNodes = updatedNodes.map(node => ({
          ...node,
          isActive: node.id === changes.activeBranchChange!.to
        }));

        // Add highlight animation
        animations.push({
          type: 'highlight_change',
          target: changes.activeBranchChange.to,
          duration: 600
        });
      }

      // Handle updated branches
      if (changes.updatedBranches) {
        for (const branchId of changes.updatedBranches) {
          animations.push({
            type: 'node_pulse',
            target: branchId,
            duration: 400
          });
        }
      }

      return {
        updatedNodes,
        updatedLinks,
        animations
      };

    } catch (error) {
      console.error('Failed to update visualization:', error);
      throw new Error('Failed to update visualization');
    }
  }

  // Private helper methods

  private async generateD3Nodes(
    branchTree: BranchTreeNode[],
    activeBranchId?: string,
    showMetrics: boolean = true
  ): Promise<D3TreeNode[]> {
    const nodes: D3TreeNode[] = [];

    const processNode = (treeNode: BranchTreeNode, depth: number = 0) => {
      const activityScore = this.calculateActivityScore(treeNode);
      const importance = this.calculateNodeImportance(treeNode, branchTree);
      
      const node: D3TreeNode = {
        id: treeNode.id,
        name: treeNode.name,
        model: treeNode.model,
        group: this.getModelGroup(treeNode.model),
        size: this.calculateNodeSize(treeNode),
        color: this.getModelColor(treeNode.model),
        depth,
        messageCount: treeNode.messageCount || 0,
        lastActivity: treeNode.lastActivity,
        isActive: treeNode.id === activeBranchId,
        metadata: {
          branchPoint: treeNode.branchPoint,
          contextSummary: treeNode.contextSummary,
          parentId: treeNode.parentBranchId,
          childrenCount: treeNode.children.length,
          createdAt: treeNode.createdAt,
          modelColor: this.getModelColor(treeNode.model),
          activityScore,
          importance
        },
        tooltip: this.generateTooltip(treeNode, showMetrics)
      };

      nodes.push(node);

      // Process children
      treeNode.children.forEach(child => {
        processNode(child, depth + 1);
      });
    };

    branchTree.forEach(root => processNode(root));

    return nodes;
  }

  private async generateD3Links(
    branchTree: BranchTreeNode[],
    statistics?: any
  ): Promise<D3TreeLink[]> {
    const links: D3TreeLink[] = [];

    const processNode = (treeNode: BranchTreeNode) => {
      treeNode.children.forEach(child => {
        const messageCountDiff = Math.abs(
          (treeNode.messageCount || 0) - (child.messageCount || 0)
        );

        const link: D3TreeLink = {
          source: treeNode.id,
          target: child.id,
          type: 'parent_child',
          strength: this.calculateLinkStrength(treeNode, child),
          distance: this.calculateLinkDistance(treeNode, child),
          color: this.getLinkColor(treeNode, child),
          strokeWidth: this.calculateStrokeWidth(messageCountDiff),
          animated: this.shouldAnimateLink(treeNode, child),
          metadata: {
            createdAt: child.createdAt,
            messageCountDiff,
            modelTransition: treeNode.model !== child.model 
              ? { from: treeNode.model, to: child.model }
              : undefined,
            branchPoint: child.branchPoint
          }
        };

        links.push(link);
        processNode(child);
      });
    };

    branchTree.forEach(root => processNode(root));

    return links;
  }

  private createLayoutConfig(
    type: D3LayoutConfig['type'],
    width: number,
    height: number,
    animated: boolean
  ): D3LayoutConfig {
    const baseConfig = {
      type,
      width,
      height,
      zoom: {
        minScale: 0.1,
        maxScale: 3.0,
        initialScale: 1.0
      }
    };

    switch (type) {
      case 'force':
        return {
          ...baseConfig,
          forces: {
            charge: -300,
            linkDistance: 80,
            centerForce: 0.1,
            collideRadius: 20,
            gravity: 0.3
          },
          animation: {
            duration: animated ? 1000 : 0,
            easing: 'easeInOutCubic',
            stagger: 50
          }
        };

      case 'tree':
        return {
          ...baseConfig,
          forces: {
            charge: 0,
            linkDistance: 100,
            centerForce: 0,
            collideRadius: 0,
            gravity: 0
          },
          animation: {
            duration: animated ? 800 : 0,
            easing: 'easeOutQuad',
            stagger: 100
          }
        };

      case 'radial':
        return {
          ...baseConfig,
          forces: {
            charge: -200,
            linkDistance: 60,
            centerForce: 0.2,
            collideRadius: 15,
            gravity: 0.1
          },
          animation: {
            duration: animated ? 1200 : 0,
            easing: 'easeInOutSine',
            stagger: 75
          }
        };

      default:
        return baseConfig as D3LayoutConfig;
    }
  }

  private createInteractionConfig(): BranchVisualizationData['interactions'] {
    return {
      enableDrag: true,
      enableZoom: true,
      enableSelection: true,
      enableContextMenu: true,
      keyboardShortcuts: true
    };
  }

  private createStylingConfig(theme: 'light' | 'dark'): BranchVisualizationData['styling'] {
    return {
      theme,
      colorScheme: {
        claude: theme === 'light' ? '#3b82f6' : '#60a5fa',
        gpt4: theme === 'light' ? '#10b981' : '#34d399',
        kimi: theme === 'light' ? '#ef4444' : '#f87171',
        grok: theme === 'light' ? '#8b5cf6' : '#a78bfa'
      },
      fontFamily: 'Inter, system-ui, sans-serif',
      animations: true
    };
  }

  private async getBranchStatistics(conversationId: string): Promise<any> {
    // Get statistics from branching service
    return await branchingService.getBranchStatistics('dummy-id'); // Would pass actual branch ID
  }

  private calculateModelDistribution(nodes: D3TreeNode[]): Record<AIModel, number> {
    const distribution = { claude: 0, gpt4: 0, kimi: 0, grok: 0 };
    
    nodes.forEach(node => {
      distribution[node.model]++;
    });
    
    return distribution;
  }

  private async generateActivityHeatmap(conversationId: string): Promise<Array<{ date: string; activity: number }>> {
    // Generate activity heatmap data
    const heatmap = [];
    const now = new Date();
    
    for (let i = 30; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      heatmap.push({
        date: date.toISOString().split('T')[0],
        activity: Math.floor(Math.random() * 10) // Placeholder
      });
    }
    
    return heatmap;
  }

  private calculateActivityScore(node: BranchTreeNode): number {
    const daysSinceActivity = (Date.now() - node.lastActivity.getTime()) / (1000 * 60 * 60 * 24);
    const messageScore = Math.min(1, (node.messageCount || 0) / 20);
    const recencyScore = Math.max(0, 1 - (daysSinceActivity / 7));
    
    return (messageScore + recencyScore) / 2;
  }

  private calculateNodeImportance(node: BranchTreeNode, allNodes: BranchTreeNode[]): number {
    let importance = 0.5; // Base importance
    
    // Higher importance for nodes with more messages
    importance += Math.min(0.3, (node.messageCount || 0) / 50);
    
    // Higher importance for nodes with children
    importance += Math.min(0.2, node.children.length * 0.1);
    
    // Higher importance for recent activity
    const daysSinceActivity = (Date.now() - node.lastActivity.getTime()) / (1000 * 60 * 60 * 24);
    importance += Math.max(0, 0.2 - (daysSinceActivity / 7) * 0.2);
    
    return Math.min(1, importance);
  }

  private calculateNodeSize(node: BranchTreeNode): number {
    const baseSize = 8;
    const messageBonus = Math.min(12, (node.messageCount || 0) / 2);
    const childBonus = node.children.length * 2;
    
    return baseSize + messageBonus + childBonus;
  }

  private generateTooltip(node: BranchTreeNode, showMetrics: boolean): D3TreeNode['tooltip'] {
    const tooltip = {
      title: node.name,
      subtitle: `Model: ${node.model}`,
      details: [
        `Created: ${node.createdAt.toLocaleDateString()}`,
        `Messages: ${node.messageCount || 0}`,
        `Children: ${node.children.length}`
      ],
      metrics: [] as Array<{ label: string; value: string | number }>
    };

    if (showMetrics) {
      tooltip.metrics.push(
        { label: 'Last Activity', value: node.lastActivity.toLocaleDateString() },
        { label: 'Depth', value: node.depth || 0 },
        { label: 'Branch Point', value: node.branchPoint || 'Root' }
      );
    }

    if (node.contextSummary) {
      tooltip.details.push(`Context: ${node.contextSummary}`);
    }

    return tooltip;
  }

  private positionNodesForForceLayout(
    nodes: D3TreeNode[],
    centerNodeId?: string,
    emphasizeRecent?: boolean
  ): D3TreeNode[] {
    return nodes.map(node => {
      let x = Math.random() * 800 - 400;
      let y = Math.random() * 600 - 300;

      // Center the specified node
      if (centerNodeId && node.id === centerNodeId) {
        x = 0;
        y = 0;
        node.fx = 0; // Fix position
        node.fy = 0;
      }

      // Position recent nodes closer to center
      if (emphasizeRecent && node.metadata.activityScore > 0.7) {
        x *= 0.5;
        y *= 0.5;
      }

      return { ...node, x, y };
    });
  }

  private async groupNodesBySimilarity(
    nodes: D3TreeNode[],
    conversationId: string
  ): Promise<Array<{ id: string; nodes: string[]; color: string }>> {
    // Group nodes by model as a simple similarity measure
    const groups = [];
    const modelGroups = nodes.reduce((acc, node) => {
      if (!acc[node.model]) acc[node.model] = [];
      acc[node.model].push(node.id);
      return acc;
    }, {} as Record<AIModel, string[]>);

    Object.entries(modelGroups).forEach(([model, nodeIds], index) => {
      groups.push({
        id: `group-${model}`,
        nodes: nodeIds,
        color: this.getModelColor(model as AIModel)
      });
    });

    return groups;
  }

  private assignTimelineLane(node: D3TreeNode, allNodes: D3TreeNode[]): number {
    // Assign timeline lanes based on branch hierarchy
    if (!node.metadata.parentId) return 0; // Root nodes in lane 0
    
    const parent = allNodes.find(n => n.id === node.metadata.parentId);
    if (!parent) return 0;
    
    const siblings = allNodes.filter(n => n.metadata.parentId === node.metadata.parentId);
    return siblings.indexOf(node) + 1;
  }

  private generateTimelineScale(
    nodes: (D3TreeNode & { timestamp: Date })[],
    scale: 'hours' | 'days' | 'weeks'
  ): Array<{ date: Date; label: string; events: number }> {
    const timeline = [];
    const sortedNodes = nodes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    if (sortedNodes.length === 0) return timeline;
    
    const start = sortedNodes[0].timestamp;
    const end = sortedNodes[sortedNodes.length - 1].timestamp;
    
    // Generate timeline markers based on scale
    const increment = scale === 'hours' ? 60 * 60 * 1000 : 
                     scale === 'days' ? 24 * 60 * 60 * 1000 :
                     7 * 24 * 60 * 60 * 1000;
    
    for (let time = start.getTime(); time <= end.getTime(); time += increment) {
      const date = new Date(time);
      const eventsInPeriod = nodes.filter(node => 
        Math.abs(node.timestamp.getTime() - time) < increment / 2
      ).length;
      
      timeline.push({
        date,
        label: this.formatTimelineLabel(date, scale),
        events: eventsInPeriod
      });
    }
    
    return timeline;
  }

  private createTimelineLanes(nodes: (D3TreeNode & { lane: number })[]): Array<{ id: number; label: string; color: string }> {
    const maxLane = Math.max(...nodes.map(n => n.lane));
    const lanes = [];
    
    for (let i = 0; i <= maxLane; i++) {
      lanes.push({
        id: i,
        label: i === 0 ? 'Main' : `Branch ${i}`,
        color: i === 0 ? '#6b7280' : this.getModelColor('claude') // Fallback color
      });
    }
    
    return lanes;
  }

  private formatTimelineLabel(date: Date, scale: string): string {
    switch (scale) {
      case 'hours':
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      case 'days':
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      case 'weeks':
        return `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      default:
        return date.toLocaleDateString();
    }
  }

  private calculateLinkStrength(parent: BranchTreeNode, child: BranchTreeNode): number {
    // Stronger links for more similar message counts
    const messageDiff = Math.abs((parent.messageCount || 0) - (child.messageCount || 0));
    return Math.max(0.1, 1 - (messageDiff / 20));
  }

  private calculateLinkDistance(parent: BranchTreeNode, child: BranchTreeNode): number {
    // Closer distance for same model, further for different models
    const baseDistance = 80;
    const modelPenalty = parent.model !== child.model ? 20 : 0;
    return baseDistance + modelPenalty;
  }

  private getLinkColor(parent: BranchTreeNode, child: BranchTreeNode): string {
    // Color based on model transition
    if (parent.model === child.model) {
      return this.getModelColor(parent.model);
    } else {
      return '#6b7280'; // Gray for model transitions
    }
  }

  private calculateStrokeWidth(messageCountDiff: number): number {
    return Math.max(1, Math.min(4, 1 + messageCountDiff / 10));
  }

  private shouldAnimateLink(parent: BranchTreeNode, child: BranchTreeNode): boolean {
    // Animate links for recent activity
    const daysSinceChild = (Date.now() - child.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceChild < 7; // Animate if created in last week
  }

  private getModelGroup(model: AIModel): number {
    const groups = { claude: 1, gpt4: 2, kimi: 3, grok: 4 };
    return groups[model] || 0;
  }

  private getModelColor(model: AIModel): string {
    const colors = {
      claude: '#3b82f6', // Blue
      gpt4: '#10b981',   // Green
      kimi: '#ef4444',   // Red
      grok: '#8b5cf6'    // Purple
    };
    return colors[model] || '#6b7280';
  }
}

// Export singleton instance
export const branchVisualizationService = new BranchVisualizationService();