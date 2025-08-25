/**
 * Integration tests for repository operations
 * Tests repository interactions with mocked TiDB client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  ConversationRepository, 
  BranchRepository, 
  MessageRepository,
  ProjectRepository,
  DocumentRepository,
  ConceptRepository
} from '../../src/lib/repositories';
import { tidbClient } from '../../src/lib/tidb/client';
import type { AIModel, MessageRole, ConceptRelationshipType } from '../../src/types';

// Mock TiDB client
vi.mock('../../src/lib/tidb/client', () => ({
  tidbClient: {
    query: vi.fn(),
    vectorSearch: vi.fn(),
    hybridSearch: vi.fn()
  }
}));

describe('Repository Integration Tests', () => {
  const mockQuery = vi.mocked(tidbClient.query);
  const mockVectorSearch = vi.mocked(tidbClient.vectorSearch);
  const mockHybridSearch = vi.mocked(tidbClient.hybridSearch);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ConversationRepository', () => {
    let repository: ConversationRepository;

    beforeEach(() => {
      repository = new ConversationRepository();
    });

    it('should create conversation and update title embedding', async () => {
      const conversationId = 'conv-123';
      const input = {
        name: 'Test Conversation',
        title: 'Test Conversation',
        description: 'A test conversation'
      };

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: conversationId,
            title: input.title,
            description: input.description,
            title_embedding: JSON.stringify([]),
            created_at: new Date(),
            updated_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 6,
          warningCount: 0
        })
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }); // updateTitleEmbedding

      const conversation = await repository.create(input);
      expect(conversation.title).toBe(input.title);

      // Update title embedding
      const embedding = new Array(1536).fill(0.1);
      await repository.updateTitleEmbedding(conversationId, embedding);

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenLastCalledWith(
        'UPDATE conversations SET title_embedding = ? WHERE id = ?',
        [JSON.stringify(embedding), conversationId]
      );
    });

    it('should search conversations by title similarity', async () => {
      const embedding = new Array(1536).fill(0.1);
      const mockSearchResults = [
        { id: 'conv-1', similarity: 0.9, content: 'Similar conversation 1' },
        { id: 'conv-2', similarity: 0.8, content: 'Similar conversation 2' }
      ];

      mockVectorSearch.mockResolvedValueOnce(mockSearchResults);

      const results = await repository.searchByTitle(embedding, 'project-123', 10, 0.3);

      expect(results).toEqual(mockSearchResults);
      expect(mockVectorSearch).toHaveBeenCalledWith(
        embedding,
        'conversations',
        'title_embedding',
        'title',
        { project_id: 'project-123' },
        10,
        0.3
      );
    });

    it('should get conversation statistics', async () => {
      const projectId = 'project-123';
      const mockStats = {
        total_conversations: 5,
        conversations_this_week: 2,
        avg_title_length: 25
      };
      const mockMostActive = {
        id: 'conv-1',
        title: 'Most Active Conversation',
        message_count: 42
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockStats], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockMostActive], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 });

      const statistics = await repository.getStatistics(projectId);

      expect(statistics).toEqual({
        totalConversations: 5,
        conversationsThisWeek: 2,
        averageTitleLength: 25,
        mostActiveConversation: {
          id: 'conv-1',
          title: 'Most Active Conversation',
          messageCount: 42
        }
      });
    });
  });

  describe('BranchRepository', () => {
    let repository: BranchRepository;

    beforeEach(() => {
      repository = new BranchRepository();
    });

    it('should create branch and build tree structure', async () => {
      const input = {
        conversationId: 'conv-123',
        name: 'Main Branch',
        model: 'claude' as AIModel
      };
      const branchId = 'branch-123';

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: branchId,
            conversation_id: input.conversationId,
            parent_branch_id: null,
            name: input.name,
            model: input.model,
            context_summary: null,
            context_embedding: JSON.stringify([]),
            created_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 7,
          warningCount: 0
        });

      const branch = await repository.create(input);
      expect(branch.name).toBe(input.name);
      expect(branch.model).toBe(input.model);
    });

    it('should get branch tree for visualization', async () => {
      const conversationId = 'conv-123';
      const mockBranches = [
        {
          id: 'branch-1',
          conversation_id: conversationId,
          parent_branch_id: null,
          name: 'Main',
          model: 'claude',
          context_summary: null,
          context_embedding: JSON.stringify([]),
          created_at: new Date()
        },
        {
          id: 'branch-2',
          conversation_id: conversationId,
          parent_branch_id: 'branch-1',
          name: 'Feature',
          model: 'gpt4',
          context_summary: null,
          context_embedding: JSON.stringify([]),
          created_at: new Date()
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockBranches, affectedRows: 0, insertId: 0, fieldCount: 7, warningCount: 0 }) // findByConversation
        .mockResolvedValueOnce({ rows: [{ count: 5 }], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 }) // message count for branch-1
        .mockResolvedValueOnce({ rows: [{ last_activity: new Date() }], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 }) // last activity for branch-1
        .mockResolvedValueOnce({ rows: [{ count: 3 }], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 }) // message count for branch-2
        .mockResolvedValueOnce({ rows: [{ last_activity: new Date() }], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 }); // last activity for branch-2

      const tree = await repository.getBranchTree(conversationId);

      expect(tree).toHaveLength(1); // One root node
      expect(tree[0].id).toBe('branch-1');
      expect(tree[0].children).toHaveLength(1); // One child
      expect(tree[0].children[0].id).toBe('branch-2');
    });

    it('should get branch statistics', async () => {
      const conversationId = 'conv-123';
      const mockBasicStats = {
        total_branches: 3,
        average_depth: 1.5,
        max_depth: 2
      };
      const mockModelDist = [
        { model: 'claude', count: 2 },
        { model: 'gpt4', count: 1 }
      ];
      const mockActivity = {
        branches_today: 1,
        branches_this_week: 3
      };
      const mockMostActive = {
        id: 'branch-1',
        message_count: 10
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockBasicStats], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 })
        .mockResolvedValueOnce({ rows: mockModelDist, affectedRows: 0, insertId: 0, fieldCount: 2, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockActivity], affectedRows: 0, insertId: 0, fieldCount: 2, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockMostActive], affectedRows: 0, insertId: 0, fieldCount: 2, warningCount: 0 });

      const statistics = await repository.getStatistics(conversationId);

      expect(statistics.totalBranches).toBe(3);
      expect(statistics.modelDistribution).toEqual({
        'claude': 2,
        'gpt4': 1
      });
      expect(statistics.activityMetrics.branchesCreatedToday).toBe(1);
    });
  });

  describe('MessageRepository', () => {
    let repository: MessageRepository;

    beforeEach(() => {
      repository = new MessageRepository();
    });

    it('should create message and find by branch', async () => {
      const branchId = 'branch-123';
      const input = {
        branchId,
        role: 'user' as MessageRole,
        content: 'Hello, AI!',
        model: 'claude',
        tokenCount: 5,
        processingTimeMs: 100
      };
      const messageId = 'message-123';

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: messageId,
            branch_id: input.branchId,
            role: input.role,
            content: input.content,
            content_embedding: JSON.stringify([]),
            model: input.model,
            token_count: input.tokenCount,
            processing_time_ms: input.processingTimeMs,
            created_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 8,
          warningCount: 0
        });

      const message = await repository.create(input);
      expect(message.content).toBe(input.content);
      expect(message.role).toBe(input.role);

      // Mock findByBranch
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: 1 }], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 }) // count
        .mockResolvedValueOnce({ // messages data
          rows: [{
            id: messageId,
            branch_id: branchId,
            role: 'user',
            content: 'Hello, AI!',
            content_embedding: JSON.stringify([]),
            model: 'claude',
            token_count: 5,
            processing_time_ms: 100,
            created_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 8,
          warningCount: 0
        });

      const messages = await repository.findByBranch(branchId);
      expect(messages.data).toHaveLength(1);
      expect(messages.data[0].content).toBe('Hello, AI!');
      expect(messages.pagination.total).toBe(1);
    });

    it('should search messages by content', async () => {
      const embedding = new Array(1536).fill(0.2);
      const mockSearchResults = [
        { id: 'msg-1', similarity: 0.95, content: 'Similar message content' },
        { id: 'msg-2', similarity: 0.85, content: 'Another similar message' }
      ];

      mockVectorSearch.mockResolvedValueOnce(mockSearchResults);

      const results = await repository.searchByContent(embedding, 'branch-123', undefined, 10, 0.3);

      expect(results).toEqual(mockSearchResults);
      expect(mockVectorSearch).toHaveBeenCalledWith(
        embedding,
        'messages',
        'content_embedding',
        'content',
        { branch_id: 'branch-123' },
        10,
        0.3
      );
    });
  });

  describe('ProjectRepository', () => {
    let repository: ProjectRepository;

    beforeEach(() => {
      repository = new ProjectRepository();
    });

    it('should create project and get statistics', async () => {
      const input = {
        name: 'Test Project',
        description: 'A test project for validation',
        customInstructions: 'Be helpful and accurate'
      };
      const projectId = 'project-123';

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: projectId,
            name: input.name,
            description: input.description,
            custom_instructions: input.customInstructions,
            created_at: new Date(),
            updated_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 5,
          warningCount: 0
        });

      const project = await repository.create(input);
      expect(project.name).toBe(input.name);

      // Mock statistics queries
      const mockBasicStats = {
        conversation_count: 3,
        document_count: 5,
        concept_count: 10,
        team_member_count: 2
      };
      const mockMessageCount = { message_count: 25 };
      const mockStorage = { total_storage: 1024000 };
      const mockActivity = {
        conversations_today: 1,
        conversations_this_week: 3,
        conversations_this_month: 5
      };
      const mockMostActive = {
        id: 'conv-1',
        title: 'Most Active',
        message_count: 15
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockBasicStats], affectedRows: 0, insertId: 0, fieldCount: 4, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockMessageCount], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockStorage], affectedRows: 0, insertId: 0, fieldCount: 1, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockActivity], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockMostActive], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 });

      const statistics = await repository.getStatistics(projectId);

      expect(statistics).toEqual({
        conversationCount: 3,
        messageCount: 25,
        documentCount: 5,
        conceptCount: 10,
        teamMemberCount: 2,
        storageUsedBytes: 1024000,
        activityMetrics: {
          conversationsToday: 1,
          conversationsThisWeek: 3,
          conversationsThisMonth: 5,
          mostActiveConversation: {
            conversationId: 'conv-1',
            title: 'Most Active',
            messageCount: 15
          }
        }
      });
    });
  });

  describe('DocumentRepository', () => {
    let repository: DocumentRepository;

    beforeEach(() => {
      repository = new DocumentRepository();
    });

    it('should create document and search by content', async () => {
      const input = {
        projectId: 'project-123',
        filename: 'test.pdf',
        content: 'This is a test document content',
        fileSize: 2048,
        mimeType: 'application/pdf' as const
      };
      const documentId = 'doc-123';

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: documentId,
            project_id: input.projectId,
            filename: input.filename,
            content: input.content,
            content_embedding: JSON.stringify([]),
            metadata: JSON.stringify({}),
            s3_key: null,
            file_size: input.fileSize,
            mime_type: input.mimeType,
            processed_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 9,
          warningCount: 0
        });

      const document = await repository.create(input);
      expect(document.filename).toBe(input.filename);
      expect(document.content).toBe(input.content);

      // Test search
      const embedding = new Array(1536).fill(0.3);
      const mockSearchResults = [
        { id: documentId, similarity: 0.9, content: 'Matching document content' }
      ];

      mockVectorSearch.mockResolvedValueOnce(mockSearchResults);

      const results = await repository.searchByContent(embedding, input.projectId, 10, 0.3);
      expect(results).toEqual(mockSearchResults);
    });

    it('should get processing statistics', async () => {
      const projectId = 'project-123';
      const mockBasicStats = {
        total_documents: 10,
        total_size: 10485760, // 10MB
        avg_size: 1048576 // 1MB
      };
      const mockMimeTypes = [
        { mime_type: 'application/pdf', count: 5 },
        { mime_type: 'text/plain', count: 3 },
        { mime_type: 'application/msword', count: 2 }
      ];
      const mockDailyStats = [
        { date: '2023-01-01', count: 2, size: 2097152 },
        { date: '2023-01-02', count: 1, size: 1048576 }
      ];
      const mockLargest = {
        id: 'doc-large',
        filename: 'large-document.pdf',
        size: 5242880 // 5MB
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [mockBasicStats], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 })
        .mockResolvedValueOnce({ rows: mockMimeTypes, affectedRows: 0, insertId: 0, fieldCount: 2, warningCount: 0 })
        .mockResolvedValueOnce({ rows: mockDailyStats, affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 })
        .mockResolvedValueOnce({ rows: [mockLargest], affectedRows: 0, insertId: 0, fieldCount: 3, warningCount: 0 });

      const statistics = await repository.getProcessingStatistics(projectId);

      expect(statistics).toEqual({
        totalDocuments: 10,
        totalSizeBytes: 10485760,
        averageSizeBytes: 1048576,
        mimeTypeDistribution: {
          'application/pdf': 5,
          'text/plain': 3,
          'application/msword': 2
        },
        processingByDay: mockDailyStats,
        largestDocument: mockLargest
      });
    });
  });

  describe('ConceptRepository', () => {
    let repository: ConceptRepository;

    beforeEach(() => {
      repository = new ConceptRepository();
    });

    it('should create concept and build knowledge graph', async () => {
      const input = {
        projectId: 'project-123',
        name: 'Machine Learning',
        description: 'A subset of AI',
        confidenceScore: 0.9
      };
      const conceptId = 'concept-123';

      // Mock create operation
      mockQuery
        .mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 }) // INSERT
        .mockResolvedValueOnce({ // findById for created entity
          rows: [{
            id: conceptId,
            project_id: input.projectId,
            name: input.name,
            description: input.description,
            concept_embedding: JSON.stringify([]),
            mention_count: 0,
            confidence_score: input.confidenceScore,
            created_at: new Date()
          }],
          affectedRows: 0,
          insertId: 0,
          fieldCount: 7,
          warningCount: 0
        });

      const concept = await repository.create(input);
      expect(concept.name).toBe(input.name);
      expect(concept.confidenceScore).toBe(input.confidenceScore);

      // Mock knowledge graph queries
      const mockConcepts = [
        {
          id: conceptId,
          project_id: input.projectId,
          name: input.name,
          description: input.description,
          concept_embedding: JSON.stringify([]),
          mention_count: 5,
          confidence_score: input.confidenceScore,
          created_at: new Date()
        }
      ];
      const mockRelationships = [
        {
          id: 'rel-123',
          source_concept_id: conceptId,
          target_concept_id: 'concept-456',
          relationship_type: 'related',
          strength: 0.8,
          created_at: new Date()
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: mockConcepts, affectedRows: 0, insertId: 0, fieldCount: 7, warningCount: 0 })
        .mockResolvedValueOnce({ rows: mockRelationships, affectedRows: 0, insertId: 0, fieldCount: 6, warningCount: 0 });

      const knowledgeGraph = await repository.getKnowledgeGraph(input.projectId);

      expect(knowledgeGraph.nodes).toHaveLength(1);
      expect(knowledgeGraph.edges).toHaveLength(1);
      expect(knowledgeGraph.nodes[0].name).toBe(input.name);
      expect(knowledgeGraph.edges[0].relationshipType).toBe('related');
    });

    it('should create concept relationship', async () => {
      const relationshipInput = {
        sourceConceptId: 'concept-123',
        targetConceptId: 'concept-456',
        relationshipType: 'related' as ConceptRelationshipType,
        strength: 0.75
      };

      // Mock check for existing relationship (none found)
      mockQuery.mockResolvedValueOnce({ rows: [], affectedRows: 0, insertId: 0, fieldCount: 0, warningCount: 0 });

      // Mock insert new relationship
      mockQuery.mockResolvedValueOnce({ rows: [], affectedRows: 1, insertId: 0, fieldCount: 0, warningCount: 0 });

      const relationship = await repository.createRelationship(relationshipInput);

      expect(relationship.sourceConceptId).toBe(relationshipInput.sourceConceptId);
      expect(relationship.targetConceptId).toBe(relationshipInput.targetConceptId);
      expect(relationship.relationshipType).toBe(relationshipInput.relationshipType);
      expect(relationship.strength).toBe(relationshipInput.strength);
    });
  });
});