/**
 * 3D Graph Visualization Service
 * SYNAPSE AI Platform - Task 7 Implementation Support
 * 
 * Prepares knowledge graph data for Three.js and D3.js visualization
 * Implements: 3D positioning → Force simulation → Animation sequences → Interactive controls
 */

import type {
  Concept,
  ConceptRelationship,
  ConceptCluster,
  GraphVisualizationData,
  GraphNode,
  GraphEdge,
  GraphLayout,
  AnimationSequence,
  InteractionEvent,
  VisualizationTheme,
  GraphControls,
  CameraPosition,
  ForceSimulationConfig
} from '../../types/knowledge';

/**
 * Graph Visualization Service
 * Handles 3D positioning, layout algorithms, and animation preparation for knowledge graphs
 */
export class GraphVisualizationService {

  /**
   * Generate 3D force-directed layout for knowledge graph
   * Implements: Force simulation → 3D positioning → Collision detection → Stability analysis
   */
  async generateForceDirectedLayout(
    concepts: Concept[],
    relationships: ConceptRelationship[],
    clusters: ConceptCluster[],
    config: ForceSimulationConfig = {}
  ): Promise<GraphVisualizationData> {
    
    const nodes = await this.prepareNodes(concepts, clusters);
    const edges = await this.prepareEdges(relationships, nodes);
    
    // Configure force simulation parameters
    const forceConfig = {
      linkStrength: config.linkStrength ?? 0.6,
      chargeStrength: config.chargeStrength ?? -300,
      centerStrength: config.centerStrength ?? 0.3,
      collisionRadius: config.collisionRadius ?? 20,
      iterations: config.iterations ?? 300,
      dimensions: config.dimensions ?? 3
    };

    // Run force simulation
    const simulationResult = await this.runForceSimulation(nodes, edges, forceConfig);
    
    // Generate cluster boundaries for 3D visualization
    const clusterBoundaries = this.generateClusterBoundaries(simulationResult.nodes, clusters);
    
    // Prepare animation sequences
    const animations = this.generateLayoutAnimations(simulationResult.nodes, simulationResult.edges);
    
    return {
      nodes: simulationResult.nodes,
      edges: simulationResult.edges,
      clusters: clusterBoundaries,
      layout: 'force-directed-3d',
      animations,
      controls: this.generateGraphControls(simulationResult.nodes),
      metrics: this.calculateLayoutMetrics(simulationResult.nodes, simulationResult.edges)
    };
  }

  /**
   * Generate hierarchical tree layout for knowledge graph
   * Implements: Tree hierarchy → Level positioning → Branch spacing → Radial arrangement
   */
  async generateHierarchicalLayout(
    concepts: Concept[],
    relationships: ConceptRelationship[],
    rootConceptId?: string
  ): Promise<GraphVisualizationData> {
    
    // Build hierarchy tree from relationships
    const hierarchy = this.buildHierarchyTree(concepts, relationships, rootConceptId);
    
    // Calculate positions using hierarchical layout
    const positions = this.calculateHierarchicalPositions(hierarchy, {
      levelHeight: 100,
      nodeSpacing: 50,
      radialSpread: true
    });
    
    const nodes = concepts.map((concept, index) => ({
      id: concept.id,
      name: concept.name,
      description: concept.description,
      category: concept.category,
      size: Math.max(8, Math.min(20, (concept.mentionCount || 1) * 2)),
      color: this.getConceptColor(concept.category),
      position: positions[concept.id] || { x: 0, y: 0, z: 0 },
      cluster: this.findConceptCluster(concept.id, []),
      metadata: {
        confidence: concept.confidence,
        mentionCount: concept.mentionCount,
        level: hierarchy.levels[concept.id] || 0
      }
    }));

    const edges = this.prepareEdgesForHierarchy(relationships, hierarchy);
    
    return {
      nodes,
      edges,
      clusters: [],
      layout: 'hierarchical-3d',
      animations: this.generateHierarchyAnimations(nodes, edges),
      controls: this.generateGraphControls(nodes),
      metrics: this.calculateLayoutMetrics(nodes, edges)
    };
  }

  /**
   * Generate circular/radial layout for concept clusters
   * Implements: Circular positioning → Cluster separation → Radial distribution → Orbit animation
   */
  async generateCircularLayout(
    concepts: Concept[],
    relationships: ConceptRelationship[],
    clusters: ConceptCluster[]
  ): Promise<GraphVisualizationData> {
    
    const clusterPositions = this.calculateClusterPositions(clusters, {
      radius: 150,
      separation: 100
    });
    
    const nodes: GraphNode[] = [];
    
    // Position concepts within their clusters
    for (const cluster of clusters) {
      const clusterConcepts = concepts.filter(c => cluster.conceptIds.includes(c.id));
      const clusterCenter = clusterPositions[cluster.id] || { x: 0, y: 0, z: 0 };
      
      clusterConcepts.forEach((concept, index) => {
        const angle = (index / clusterConcepts.length) * 2 * Math.PI;
        const radius = 30 + (cluster.size * 2);
        
        nodes.push({
          id: concept.id,
          name: concept.name,
          description: concept.description,
          category: concept.category,
          size: Math.max(8, Math.min(20, (concept.mentionCount || 1) * 2)),
          color: cluster.color,
          position: {
            x: clusterCenter.x + Math.cos(angle) * radius,
            y: clusterCenter.y + Math.sin(angle) * radius,
            z: clusterCenter.z + (Math.random() - 0.5) * 20
          },
          cluster: cluster.id,
          metadata: {
            confidence: concept.confidence,
            mentionCount: concept.mentionCount,
            angle: angle,
            radius: radius
          }
        });
      });
    }
    
    const edges = await this.prepareEdges(relationships, nodes);
    
    return {
      nodes,
      edges,
      clusters: clusters.map(cluster => ({
        id: cluster.id,
        name: cluster.name,
        color: cluster.color,
        size: cluster.size,
        position: clusterPositions[cluster.id] || { x: 0, y: 0, z: 0 },
        concepts: cluster.conceptIds
      })),
      layout: 'circular-3d',
      animations: this.generateCircularAnimations(nodes, edges, clusters),
      controls: this.generateGraphControls(nodes),
      metrics: this.calculateLayoutMetrics(nodes, edges)
    };
  }

  /**
   * Apply visual theme to graph visualization
   * Implements: Color schemes → Material properties → Lighting → Visual effects
   */
  applyVisualizationTheme(
    visualizationData: GraphVisualizationData,
    theme: VisualizationTheme
  ): GraphVisualizationData {
    
    const themedNodes = visualizationData.nodes.map(node => ({
      ...node,
      color: this.applyThemeColor(node.color, theme.colorScheme),
      material: {
        type: theme.nodeStyle.material || 'phong',
        opacity: theme.nodeStyle.opacity || 0.9,
        transparent: theme.nodeStyle.transparent || true,
        wireframe: theme.nodeStyle.wireframe || false,
        emissive: theme.nodeStyle.emissive || '#000000'
      },
      glow: theme.effects?.nodeGlow || false,
      shadow: theme.effects?.shadows || true
    }));

    const themedEdges = visualizationData.edges.map(edge => ({
      ...edge,
      color: this.applyThemeColor(edge.color, theme.colorScheme),
      material: {
        type: theme.edgeStyle.material || 'basic',
        opacity: theme.edgeStyle.opacity || 0.6,
        transparent: true
      },
      animated: edge.animated && (theme.effects?.edgeAnimation ?? true)
    }));

    return {
      ...visualizationData,
      nodes: themedNodes,
      edges: themedEdges,
      theme: theme,
      environment: {
        background: theme.background || '#000011',
        lighting: theme.lighting || 'ambient',
        fog: theme.effects?.fog || false,
        particles: theme.effects?.particles || false
      }
    };
  }

  /**
   * Generate interactive controls for 3D graph navigation
   * Implements: Camera controls → Node selection → Zoom/Pan/Rotate → Keyboard shortcuts
   */
  generateGraphControls(nodes: GraphNode[]): GraphControls {
    return {
      camera: {
        type: 'orbital',
        position: this.calculateOptimalCameraPosition(nodes),
        target: this.calculateGraphCenter(nodes),
        minDistance: 50,
        maxDistance: 1000,
        enableZoom: true,
        enableRotate: true,
        enablePan: true,
        autoRotate: false,
        autoRotateSpeed: 0.5
      },
      interaction: {
        enableNodeSelection: true,
        enableNodeHover: true,
        enableEdgeSelection: true,
        multiSelect: true,
        doubleClickAction: 'focus',
        hoverDelay: 200
      },
      navigation: {
        enableKeyboard: true,
        enableMouse: true,
        enableTouch: true,
        keyboardShortcuts: {
          'f': 'focus-selected',
          'r': 'reset-view',
          'space': 'toggle-animation',
          'ctrl+a': 'select-all',
          'escape': 'deselect-all'
        }
      },
      animation: {
        enableTransitions: true,
        transitionDuration: 800,
        easingFunction: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        enablePhysics: true,
        dampingFactor: 0.95
      }
    };
  }

  // Private helper methods

  private async prepareNodes(concepts: Concept[], clusters: ConceptCluster[]): Promise<GraphNode[]> {
    return concepts.map(concept => ({
      id: concept.id,
      name: concept.name,
      description: concept.description,
      category: concept.category,
      size: Math.max(8, Math.min(20, (concept.mentionCount || 1) * 2)),
      color: this.getConceptColor(concept.category),
      position: { x: 0, y: 0, z: 0 }, // Will be set by layout algorithm
      cluster: this.findConceptCluster(concept.id, clusters),
      metadata: {
        confidence: concept.confidence,
        mentionCount: concept.mentionCount,
        lastUpdated: concept.updatedAt
      }
    }));
  }

  private async prepareEdges(relationships: ConceptRelationship[], nodes: GraphNode[]): Promise<GraphEdge[]> {
    return relationships.map(rel => ({
      id: rel.id,
      source: rel.sourceConcept,
      target: rel.targetConcept,
      type: rel.relationshipType,
      strength: rel.strength,
      color: this.getRelationshipColor(rel.relationshipType),
      width: Math.max(1, rel.strength * 5),
      opacity: Math.max(0.3, rel.confidence),
      animated: rel.strength > 0.7,
      curve: this.calculateEdgeCurvature(rel, nodes),
      metadata: {
        confidence: rel.confidence,
        vectorSimilarity: rel.metadata?.vectorSimilarity
      }
    }));
  }

  private async runForceSimulation(
    nodes: GraphNode[],
    edges: GraphEdge[],
    config: ForceSimulationConfig
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    
    // Initialize positions randomly
    nodes.forEach(node => {
      node.position = {
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 200,
        z: (Math.random() - 0.5) * 200
      };
      
      // Initialize velocity for simulation
      (node as any).velocity = { x: 0, y: 0, z: 0 };
    });

    // Run force simulation iterations
    for (let i = 0; i < config.iterations; i++) {
      // Apply forces
      this.applyLinkForces(nodes, edges, config.linkStrength);
      this.applyChargeForces(nodes, config.chargeStrength);
      this.applyCenterForces(nodes, config.centerStrength);
      this.applyCollisionForces(nodes, config.collisionRadius);
      
      // Update positions
      nodes.forEach(node => {
        const velocity = (node as any).velocity;
        node.position.x += velocity.x;
        node.position.y += velocity.y;
        node.position.z += velocity.z;
        
        // Apply damping
        velocity.x *= 0.9;
        velocity.y *= 0.9;
        velocity.z *= 0.9;
      });
    }

    return { nodes, edges };
  }

  private applyLinkForces(nodes: GraphNode[], edges: GraphEdge[], strength: number): void {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    edges.forEach(edge => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      
      if (!source || !target) return;
      
      const dx = target.position.x - source.position.x;
      const dy = target.position.y - source.position.y;
      const dz = target.position.z - source.position.z;
      
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const targetDistance = 50 + edge.strength * 30;
      
      if (distance > 0) {
        const force = (distance - targetDistance) * strength * 0.1;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const fz = (dz / distance) * force;
        
        (source as any).velocity.x += fx;
        (source as any).velocity.y += fy;
        (source as any).velocity.z += fz;
        
        (target as any).velocity.x -= fx;
        (target as any).velocity.y -= fy;
        (target as any).velocity.z -= fz;
      }
    });
  }

  private applyChargeForces(nodes: GraphNode[], strength: number): void {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        
        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const dz = nodeB.position.z - nodeA.position.z;
        
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance > 0) {
          const force = strength / (distance * distance);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          const fz = (dz / distance) * force;
          
          (nodeA as any).velocity.x -= fx;
          (nodeA as any).velocity.y -= fy;
          (nodeA as any).velocity.z -= fz;
          
          (nodeB as any).velocity.x += fx;
          (nodeB as any).velocity.y += fy;
          (nodeB as any).velocity.z += fz;
        }
      }
    }
  }

  private applyCenterForces(nodes: GraphNode[], strength: number): void {
    const center = this.calculateGraphCenter(nodes);
    
    nodes.forEach(node => {
      const dx = center.x - node.position.x;
      const dy = center.y - node.position.y;
      const dz = center.z - node.position.z;
      
      (node as any).velocity.x += dx * strength * 0.01;
      (node as any).velocity.y += dy * strength * 0.01;
      (node as any).velocity.z += dz * strength * 0.01;
    });
  }

  private applyCollisionForces(nodes: GraphNode[], radius: number): void {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        
        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const dz = nodeB.position.z - nodeA.position.z;
        
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minDistance = radius + nodeA.size + nodeB.size;
        
        if (distance < minDistance && distance > 0) {
          const force = (minDistance - distance) * 0.5;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          const fz = (dz / distance) * force;
          
          (nodeA as any).velocity.x -= fx;
          (nodeA as any).velocity.y -= fy;
          (nodeA as any).velocity.z -= fz;
          
          (nodeB as any).velocity.x += fx;
          (nodeB as any).velocity.y += fy;
          (nodeB as any).velocity.z += fz;
        }
      }
    }
  }

  private buildHierarchyTree(
    concepts: Concept[],
    relationships: ConceptRelationship[],
    rootConceptId?: string
  ): { tree: any; levels: Record<string, number> } {
    // Build tree structure from relationships
    const tree: any = {};
    const levels: Record<string, number> = {};
    
    // Find root concept (most connected if not specified)
    const root = rootConceptId || this.findMostConnectedConcept(concepts, relationships);
    
    if (root) {
      levels[root] = 0;
      tree[root] = { children: [], parent: null };
      
      // Build tree using BFS
      const queue = [root];
      const visited = new Set([root]);
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentLevel = levels[current];
        
        const connections = relationships.filter(r =>
          (r.sourceConcept === current || r.targetConcept === current) &&
          !visited.has(r.sourceConcept === current ? r.targetConcept : r.sourceConcept)
        );
        
        connections.forEach(rel => {
          const child = rel.sourceConcept === current ? rel.targetConcept : rel.sourceConcept;
          if (!visited.has(child)) {
            visited.add(child);
            levels[child] = currentLevel + 1;
            tree[child] = { children: [], parent: current };
            tree[current].children.push(child);
            queue.push(child);
          }
        });
      }
    }
    
    return { tree, levels };
  }

  private calculateHierarchicalPositions(
    hierarchy: { tree: any; levels: Record<string, number> },
    config: { levelHeight: number; nodeSpacing: number; radialSpread: boolean }
  ): Record<string, { x: number; y: number; z: number }> {
    const positions: Record<string, { x: number; y: number; z: number }> = {};
    
    // Group concepts by level
    const levelGroups: Record<number, string[]> = {};
    Object.entries(hierarchy.levels).forEach(([conceptId, level]) => {
      if (!levelGroups[level]) levelGroups[level] = [];
      levelGroups[level].push(conceptId);
    });
    
    // Position concepts level by level
    Object.entries(levelGroups).forEach(([levelStr, conceptIds]) => {
      const level = parseInt(levelStr);
      const y = level * config.levelHeight;
      
      if (config.radialSpread) {
        // Arrange in a circle for each level
        conceptIds.forEach((conceptId, index) => {
          const angle = (index / conceptIds.length) * 2 * Math.PI;
          const radius = Math.max(50, level * 30);
          
          positions[conceptId] = {
            x: Math.cos(angle) * radius,
            y: y,
            z: Math.sin(angle) * radius
          };
        });
      } else {
        // Linear arrangement
        conceptIds.forEach((conceptId, index) => {
          const x = (index - (conceptIds.length - 1) / 2) * config.nodeSpacing;
          
          positions[conceptId] = {
            x: x,
            y: y,
            z: 0
          };
        });
      }
    });
    
    return positions;
  }

  private prepareEdgesForHierarchy(
    relationships: ConceptRelationship[],
    hierarchy: { tree: any; levels: Record<string, number> }
  ): GraphEdge[] {
    return relationships.map(rel => ({
      id: rel.id,
      source: rel.sourceConcept,
      target: rel.targetConcept,
      type: rel.relationshipType,
      strength: rel.strength,
      color: this.getRelationshipColor(rel.relationshipType),
      width: Math.max(1, rel.strength * 5),
      opacity: Math.max(0.3, rel.confidence),
      animated: false, // Disable animation for hierarchy
      curve: 0.2, // Slight curve for better visibility
      metadata: {
        confidence: rel.confidence,
        levelDifference: Math.abs(
          hierarchy.levels[rel.sourceConcept] - hierarchy.levels[rel.targetConcept]
        )
      }
    }));
  }

  private calculateClusterPositions(
    clusters: ConceptCluster[],
    config: { radius: number; separation: number }
  ): Record<string, { x: number; y: number; z: number }> {
    const positions: Record<string, { x: number; y: number; z: number }> = {};
    
    clusters.forEach((cluster, index) => {
      const angle = (index / clusters.length) * 2 * Math.PI;
      const radius = config.radius + (cluster.size * 10);
      
      positions[cluster.id] = {
        x: Math.cos(angle) * radius,
        y: (Math.random() - 0.5) * 50,
        z: Math.sin(angle) * radius
      };
    });
    
    return positions;
  }

  private generateLayoutAnimations(nodes: GraphNode[], edges: GraphEdge[]): AnimationSequence[] {
    return [
      {
        name: 'nodes-entrance',
        type: 'stagger',
        duration: 2000,
        delay: 0,
        targets: nodes.map(n => n.id),
        properties: {
          opacity: { from: 0, to: 1 },
          scale: { from: 0.5, to: 1 }
        }
      },
      {
        name: 'edges-entrance',
        type: 'sequence',
        duration: 1500,
        delay: 1000,
        targets: edges.map(e => e.id),
        properties: {
          opacity: { from: 0, to: 1 },
          strokeDashoffset: { from: 100, to: 0 }
        }
      }
    ];
  }

  private generateHierarchyAnimations(nodes: GraphNode[], edges: GraphEdge[]): AnimationSequence[] {
    // Group nodes by level for level-by-level animation
    const nodesByLevel: Record<number, string[]> = {};
    nodes.forEach(node => {
      const level = (node.metadata as any).level || 0;
      if (!nodesByLevel[level]) nodesByLevel[level] = [];
      nodesByLevel[level].push(node.id);
    });
    
    const animations: AnimationSequence[] = [];
    
    Object.entries(nodesByLevel).forEach(([levelStr, nodeIds], index) => {
      animations.push({
        name: `level-${levelStr}-entrance`,
        type: 'parallel',
        duration: 800,
        delay: index * 400,
        targets: nodeIds,
        properties: {
          opacity: { from: 0, to: 1 },
          scale: { from: 0.3, to: 1 }
        }
      });
    });
    
    return animations;
  }

  private generateCircularAnimations(
    nodes: GraphNode[],
    edges: GraphEdge[],
    clusters: ConceptCluster[]
  ): AnimationSequence[] {
    return clusters.map((cluster, index) => ({
      name: `cluster-${cluster.id}-orbit`,
      type: 'infinite',
      duration: 10000 + (index * 1000),
      delay: 0,
      targets: cluster.conceptIds,
      properties: {
        rotation: { from: 0, to: 360 }
      }
    }));
  }

  private calculateOptimalCameraPosition(nodes: GraphNode[]): CameraPosition {
    const bounds = this.calculateGraphBounds(nodes);
    const center = this.calculateGraphCenter(nodes);
    
    return {
      x: center.x + (bounds.width * 0.8),
      y: center.y + (bounds.height * 0.6),
      z: center.z + (bounds.depth * 1.2)
    };
  }

  private calculateGraphCenter(nodes: GraphNode[]): { x: number; y: number; z: number } {
    if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
    
    const sum = nodes.reduce(
      (acc, node) => ({
        x: acc.x + node.position.x,
        y: acc.y + node.position.y,
        z: acc.z + node.position.z
      }),
      { x: 0, y: 0, z: 0 }
    );
    
    return {
      x: sum.x / nodes.length,
      y: sum.y / nodes.length,
      z: sum.z / nodes.length
    };
  }

  private calculateGraphBounds(nodes: GraphNode[]): { width: number; height: number; depth: number } {
    if (nodes.length === 0) return { width: 0, height: 0, depth: 0 };
    
    const xs = nodes.map(n => n.position.x);
    const ys = nodes.map(n => n.position.y);
    const zs = nodes.map(n => n.position.z);
    
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      depth: Math.max(...zs) - Math.min(...zs)
    };
  }

  private calculateLayoutMetrics(nodes: GraphNode[], edges: GraphEdge[]): any {
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      averageConnectivity: edges.length / nodes.length,
      graphDensity: (edges.length * 2) / (nodes.length * (nodes.length - 1)),
      spatialDistribution: this.calculateSpatialDistribution(nodes)
    };
  }

  private calculateSpatialDistribution(nodes: GraphNode[]): any {
    const distances = [];
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].position.x - nodes[j].position.x;
        const dy = nodes[i].position.y - nodes[j].position.y;
        const dz = nodes[i].position.z - nodes[j].position.z;
        distances.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
    
    distances.sort((a, b) => a - b);
    
    return {
      averageDistance: distances.reduce((sum, d) => sum + d, 0) / distances.length,
      medianDistance: distances[Math.floor(distances.length / 2)],
      minDistance: distances[0] || 0,
      maxDistance: distances[distances.length - 1] || 0
    };
  }

  private getConceptColor(category: string): string {
    const colors: Record<string, string> = {
      'technology': '#3b82f6',
      'science': '#10b981',
      'business': '#f59e0b',
      'health': '#ef4444',
      'education': '#8b5cf6',
      'general': '#6b7280'
    };
    return colors[category] || '#6b7280';
  }

  private getRelationshipColor(type: string): string {
    const colors: Record<string, string> = {
      'related': '#10b981',
      'similar': '#3b82f6',
      'opposite': '#ef4444',
      'causes': '#f59e0b',
      'enables': '#8b5cf6',
      'part-of': '#06b6d4'
    };
    return colors[type] || '#6b7280';
  }

  private findConceptCluster(conceptId: string, clusters: ConceptCluster[]): string | undefined {
    return clusters.find(c => c.conceptIds.includes(conceptId))?.id;
  }

  private calculateEdgeCurvature(relationship: ConceptRelationship, nodes: GraphNode[]): number {
    // Add slight curvature based on relationship strength
    return relationship.strength > 0.5 ? 0.1 : 0;
  }

  private applyThemeColor(originalColor: string, colorScheme: string): string {
    // Apply theme color transformations
    switch (colorScheme) {
      case 'dark':
        return this.darkenColor(originalColor, 0.3);
      case 'light':
        return this.lightenColor(originalColor, 0.3);
      case 'neon':
        return this.saturateColor(originalColor, 0.5);
      default:
        return originalColor;
    }
  }

  private darkenColor(color: string, amount: number): string {
    // Simple color darkening - in production, use a proper color library
    return color;
  }

  private lightenColor(color: string, amount: number): string {
    // Simple color lightening - in production, use a proper color library
    return color;
  }

  private saturateColor(color: string, amount: number): string {
    // Simple color saturation - in production, use a proper color library
    return color;
  }

  private findMostConnectedConcept(concepts: Concept[], relationships: ConceptRelationship[]): string | undefined {
    const connectionCounts = concepts.map(concept => ({
      id: concept.id,
      connections: relationships.filter(r =>
        r.sourceConcept === concept.id || r.targetConcept === concept.id
      ).length
    }));
    
    connectionCounts.sort((a, b) => b.connections - a.connections);
    return connectionCounts[0]?.id;
  }

  private generateClusterBoundaries(nodes: GraphNode[], clusters: ConceptCluster[]): any[] {
    return clusters.map(cluster => {
      const clusterNodes = nodes.filter(n => cluster.conceptIds.includes(n.id));
      
      if (clusterNodes.length === 0) return null;
      
      // Calculate convex hull or bounding sphere
      const center = {
        x: clusterNodes.reduce((sum, n) => sum + n.position.x, 0) / clusterNodes.length,
        y: clusterNodes.reduce((sum, n) => sum + n.position.y, 0) / clusterNodes.length,
        z: clusterNodes.reduce((sum, n) => sum + n.position.z, 0) / clusterNodes.length
      };
      
      const maxDistance = Math.max(...clusterNodes.map(n => {
        const dx = n.position.x - center.x;
        const dy = n.position.y - center.y;
        const dz = n.position.z - center.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }));
      
      return {
        id: cluster.id,
        name: cluster.name,
        color: cluster.color,
        center,
        radius: maxDistance + 20,
        concepts: cluster.conceptIds
      };
    }).filter(Boolean);
  }
}

// Export singleton instance
export const graphVisualizationService = new GraphVisualizationService();