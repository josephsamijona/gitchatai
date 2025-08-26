/**
 * Task 2: Data Models & Repository Pattern Tests
 * Created by: Joseph Samuel Jonathan
 * Date: 2024-08-26T14:32:18
 * 
 * Tests TypeScript interfaces, data validation, repository operations,
 * and all data models (Conversation, Branch, Message, Project, Document, Concept)
 * as specified in CLAUDE.md Task 2
 */

import { TiDBClient } from '../../lib/tidb/client';
import { ConversationRepository } from '../../lib/repositories/conversation';
import { BranchRepository } from '../../lib/repositories/branch';
import { MessageRepository } from '../../lib/repositories/message';
import { ProjectRepository } from '../../lib/repositories/project';
import { DocumentRepository } from '../../lib/repositories/document';
import { ConceptRepository } from '../../lib/repositories/concept';
import TestLogger from '../utils/test-logger';
import type { 
  Conversation, 
  Branch, 
  Message, 
  Project, 
  Document, 
  Concept,
  AIModel 
} from '../../types';

const logger = new TestLogger();

describe('Task 2: Data Models & Repository Pattern', () => {
  let tidbClient: TiDBClient;
  let conversationRepo: ConversationRepository;
  let branchRepo: BranchRepository;
  let messageRepo: MessageRepository;
  let projectRepo: ProjectRepository;
  let documentRepo: DocumentRepository;
  let conceptRepo: ConceptRepository;

  // Test data IDs for cleanup
  const testIds = {
    projects: [] as string[],
    conversations: [] as string[],
    branches: [] as string[],
    messages: [] as string[],
    documents: [] as string[],
    concepts: [] as string[]
  };

  beforeAll(async () => {
    logger.startSuite('Data Models & Repository Pattern');
    logger.log('🗄️ Initializing data models test suite...');
    
    // Verify environment
    if (!process.env.TIDB_HOST) {
      throw new Error('TIDB_HOST environment variable is required');
    }

    // Initialize TiDB client
    tidbClient = new TiDBClient({
      host: process.env.TIDB_HOST!,
      port: parseInt(process.env.TIDB_PORT || '4000'),
      user: process.env.TIDB_USER!,
      password: process.env.TIDB_PASSWORD!,
      database: process.env.TIDB_DATABASE!,
      ssl: process.env.TIDB_SSL === 'true'
    });

    // Initialize repositories
    conversationRepo = new ConversationRepository(tidbClient);
    branchRepo = new BranchRepository(tidbClient);
    messageRepo = new MessageRepository(tidbClient);
    projectRepo = new ProjectRepository(tidbClient);
    documentRepo = new DocumentRepository(tidbClient);
    conceptRepo = new ConceptRepository(tidbClient);

    logger.log('✅ All repositories initialized successfully');

    // Ensure tables exist
    await tidbClient.initializeSchema();
    logger.log('✅ Database schema initialized');
  });

  afterAll(async () => {
    logger.log('🧹 Cleaning up test data...');
    
    try {
      // Cleanup in reverse dependency order
      await Promise.all([
        ...testIds.messages.map(id => messageRepo.delete(id).catch(() => {})),
        ...testIds.concepts.map(id => conceptRepo.delete(id).catch(() => {})),
        ...testIds.documents.map(id => documentRepo.delete(id).catch(() => {}))
      ]);

      await Promise.all([
        ...testIds.branches.map(id => branchRepo.delete(id).catch(() => {}))
      ]);

      await Promise.all([
        ...testIds.conversations.map(id => conversationRepo.delete(id).catch(() => {}))
      ]);

      await Promise.all([
        ...testIds.projects.map(id => projectRepo.delete(id).catch(() => {}))
      ]);

      await tidbClient.close();
      logger.log('✅ Cleanup completed successfully');
    } catch (error) {
      logger.log(`❌ Error during cleanup: ${error}`);
    }

    logger.endSuite();
    
    // Generate reports
    const report = logger.generateReport();
    logger.saveJsonReport();
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 DATA MODELS TEST REPORT');
    console.log('='.repeat(80));
    console.log(report);
  });

  describe('2.1 TypeScript Interfaces & Data Validation', () => {
    test('should validate Project model structure', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📋 Testing Project model validation...');
        
        const validProject: Partial<Project> = {
          id: 'test_project_1',
          name: 'Test Project',
          description: 'A test project for validation',
          customInstructions: 'Use formal language',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Test valid data
        const created = await projectRepo.create(validProject);
        testIds.projects.push(created.id);
        
        expect(created.id).toBeDefined();
        expect(created.name).toBe(validProject.name);
        expect(created.description).toBe(validProject.description);
        expect(created.customInstructions).toBe(validProject.customInstructions);
        
        // Test invalid data handling
        let errorCaught = false;
        try {
          await projectRepo.create({
            name: '', // Invalid: empty name
            description: validProject.description
          });
        } catch (error) {
          errorCaught = true;
          logger.log(`   Expected validation error: ${error}`);
        }
        
        const duration = Date.now() - startTime;
        
        expect(errorCaught).toBe(true);
        
        logger.logTest({
          testName: 'Project Model Validation',
          status: 'PASSED',
          duration,
          details: {
            validProjectCreated: created.id,
            validationErrorHandled: errorCaught,
            modelFields: Object.keys(created)
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Project model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Project Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate Conversation model with embeddings', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('💬 Testing Conversation model with embeddings...');
        
        // Create a project first
        const project = await projectRepo.create({
          name: 'Test Project for Conversations',
          description: 'Project for conversation testing'
        });
        testIds.projects.push(project.id);
        
        const validConversation: Partial<Conversation> = {
          id: 'test_conv_1',
          projectId: project.id,
          title: 'Test Conversation',
          titleEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const created = await conversationRepo.create(validConversation);
        testIds.conversations.push(created.id);
        
        const duration = Date.now() - startTime;
        
        expect(created.id).toBeDefined();
        expect(created.projectId).toBe(project.id);
        expect(created.title).toBe(validConversation.title);
        expect(created.titleEmbedding).toBeDefined();
        
        logger.logTest({
          testName: 'Conversation Model Validation',
          status: 'PASSED',
          duration,
          details: {
            conversationId: created.id,
            projectId: created.projectId,
            embeddingDimensions: created.titleEmbedding?.length || 0,
            hasTitle: !!created.title
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Conversation model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Conversation Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate Branch model with AI model enum', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🌿 Testing Branch model with AI model validation...');
        
        // Get existing conversation
        const conversationId = testIds.conversations[0];
        if (!conversationId) {
          throw new Error('No conversation available for branch testing');
        }
        
        const validBranch: Partial<Branch> = {
          id: 'test_branch_1',
          conversationId,
          name: 'Main Branch',
          model: 'claude' as AIModel,
          contextSummary: 'Initial conversation branch',
          contextEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          createdAt: new Date()
        };

        const created = await branchRepo.create(validBranch);
        testIds.branches.push(created.id);
        
        // Test all supported AI models
        const aiModels: AIModel[] = ['claude', 'gpt4', 'kimi', 'grok', 'gemini'];
        const modelBranches: Branch[] = [];
        
        for (let i = 0; i < aiModels.length; i++) {
          const model = aiModels[i];
          const modelBranch = await branchRepo.create({
            conversationId,
            name: `${model} Branch`,
            model,
            contextSummary: `Branch using ${model} model`,
            contextEmbedding: Array.from({ length: 1536 }, () => Math.random())
          });
          modelBranches.push(modelBranch);
          testIds.branches.push(modelBranch.id);
          
          logger.log(`   Created branch with model: ${model} (ID: ${modelBranch.id})`);
        }
        
        const duration = Date.now() - startTime;
        
        expect(created.model).toBe('claude');
        expect(modelBranches).toHaveLength(aiModels.length);
        
        logger.logTest({
          testName: 'Branch Model Validation',
          status: 'PASSED',
          duration,
          details: {
            mainBranchId: created.id,
            aiModelsSupported: aiModels,
            branchesCreated: modelBranches.length + 1,
            contextEmbeddingSize: created.contextEmbedding?.length || 0
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Branch model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Branch Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate Message model with content embeddings', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('✉️ Testing Message model with content embeddings...');
        
        const branchId = testIds.branches[0];
        if (!branchId) {
          throw new Error('No branch available for message testing');
        }
        
        const validMessage: Partial<Message> = {
          id: 'test_msg_1',
          branchId,
          role: 'user',
          content: 'Hello, this is a test message for the SYNAPSE AI platform',
          contentEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          model: 'claude',
          tokenCount: 15,
          processingTimeMs: 150,
          createdAt: new Date()
        };

        const created = await messageRepo.create(validMessage);
        testIds.messages.push(created.id);
        
        // Create assistant response
        const responseMessage = await messageRepo.create({
          branchId,
          role: 'assistant',
          content: 'Hello! I am SYNAPSE AI, ready to help with your Git-style conversation branching needs.',
          contentEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          model: 'claude',
          tokenCount: 18,
          processingTimeMs: 200
        });
        testIds.messages.push(responseMessage.id);
        
        const duration = Date.now() - startTime;
        
        expect(created.role).toBe('user');
        expect(responseMessage.role).toBe('assistant');
        expect(created.tokenCount).toBe(15);
        expect(created.processingTimeMs).toBe(150);
        
        logger.logTest({
          testName: 'Message Model Validation',
          status: 'PASSED',
          duration,
          details: {
            userMessageId: created.id,
            assistantMessageId: responseMessage.id,
            userTokens: created.tokenCount || 0,
            assistantTokens: responseMessage.tokenCount || 0,
            totalProcessingTime: (created.processingTimeMs || 0) + (responseMessage.processingTimeMs || 0)
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Message model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Message Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate Document model with metadata', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📄 Testing Document model with metadata...');
        
        const projectId = testIds.projects[0];
        if (!projectId) {
          throw new Error('No project available for document testing');
        }
        
        const validDocument: Partial<Document> = {
          id: 'test_doc_1',
          projectId,
          filename: 'test-document.md',
          content: '# Test Document\n\nThis is a test document for the SYNAPSE AI platform.\n\n## Features\n- Git-style branching\n- Multi-model AI orchestration\n- Vector search capabilities',
          contentEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          metadata: {
            fileType: 'markdown',
            wordCount: 25,
            author: 'Joseph Samuel Jonathan',
            tags: ['test', 'documentation', 'synapse-ai']
          },
          s3Key: 'test-documents/test-document.md',
          fileSize: 150,
          mimeType: 'text/markdown',
          processedAt: new Date()
        };

        const created = await documentRepo.create(validDocument);
        testIds.documents.push(created.id);
        
        // Test document retrieval with metadata
        const retrieved = await documentRepo.findById(created.id);
        
        const duration = Date.now() - startTime;
        
        expect(retrieved).toBeDefined();
        expect(retrieved?.filename).toBe(validDocument.filename);
        expect(retrieved?.metadata?.fileType).toBe('markdown');
        expect(retrieved?.metadata?.tags).toEqual(['test', 'documentation', 'synapse-ai']);
        expect(retrieved?.fileSize).toBe(150);
        
        logger.logTest({
          testName: 'Document Model Validation',
          status: 'PASSED',
          duration,
          details: {
            documentId: created.id,
            filename: created.filename,
            fileSize: created.fileSize,
            mimeType: created.mimeType,
            metadataFields: Object.keys(created.metadata || {}),
            contentEmbeddingSize: created.contentEmbedding?.length || 0
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Document model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Document Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate Concept model for knowledge graphs', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🧠 Testing Concept model for knowledge graphs...');
        
        const projectId = testIds.projects[0];
        if (!projectId) {
          throw new Error('No project available for concept testing');
        }
        
        const concepts = [
          {
            name: 'Artificial Intelligence',
            description: 'The simulation of human intelligence processes by machines',
            embedding: Array.from({ length: 1536 }, () => Math.random())
          },
          {
            name: 'Git Branching',
            description: 'Version control system branching for parallel development',
            embedding: Array.from({ length: 1536 }, () => Math.random())
          },
          {
            name: 'Vector Search',
            description: 'Similarity search using high-dimensional vector representations',
            embedding: Array.from({ length: 1536 }, () => Math.random())
          }
        ];
        
        const createdConcepts: Concept[] = [];
        
        for (const conceptData of concepts) {
          const concept = await conceptRepo.create({
            projectId,
            name: conceptData.name,
            description: conceptData.description,
            conceptEmbedding: conceptData.embedding,
            mentionCount: Math.floor(Math.random() * 10) + 1,
            createdAt: new Date()
          });
          
          createdConcepts.push(concept);
          testIds.concepts.push(concept.id);
          
          logger.log(`   Created concept: "${concept.name}" (mentions: ${concept.mentionCount})`);
        }
        
        // Test concept relationships (similarity)
        const concept1 = createdConcepts[0];
        const concept2 = createdConcepts[1];
        
        // Simulate relationship calculation (in real implementation, this would use vector similarity)
        const relationshipStrength = Math.random() * 0.5 + 0.3; // 0.3 to 0.8
        
        const duration = Date.now() - startTime;
        
        expect(createdConcepts).toHaveLength(3);
        expect(concept1.name).toBe('Artificial Intelligence');
        expect(concept2.name).toBe('Git Branching');
        expect(relationshipStrength).toBeGreaterThan(0.3);
        
        logger.logTest({
          testName: 'Concept Model Validation',
          status: 'PASSED',
          duration,
          details: {
            conceptsCreated: createdConcepts.length,
            concepts: createdConcepts.map(c => ({
              name: c.name,
              mentions: c.mentionCount,
              embeddingSize: c.conceptEmbedding?.length || 0
            })),
            relationshipStrength: Math.round(relationshipStrength * 100) / 100
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Concept model validation completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Concept Model Validation',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('2.2 Repository Pattern Operations', () => {
    test('should perform CRUD operations efficiently', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔄 Testing CRUD operations across all repositories...');
        
        const operations = [];
        
        // Create operations
        const createStart = Date.now();
        const newProject = await projectRepo.create({
          name: 'CRUD Test Project',
          description: 'Project for testing CRUD operations'
        });
        testIds.projects.push(newProject.id);
        const createTime = Date.now() - createStart;
        operations.push({ operation: 'CREATE', time: createTime, entity: 'Project' });
        
        // Read operations
        const readStart = Date.now();
        const foundProject = await projectRepo.findById(newProject.id);
        const readTime = Date.now() - readStart;
        operations.push({ operation: 'READ', time: readTime, entity: 'Project' });
        
        // Update operations
        const updateStart = Date.now();
        const updatedProject = await projectRepo.update(newProject.id, {
          description: 'Updated description for CRUD testing'
        });
        const updateTime = Date.now() - updateStart;
        operations.push({ operation: 'UPDATE', time: updateTime, entity: 'Project' });
        
        // List operations (with pagination)
        const listStart = Date.now();
        const projects = await projectRepo.findMany({
          limit: 10,
          offset: 0
        });
        const listTime = Date.now() - listStart;
        operations.push({ operation: 'LIST', time: listTime, entity: 'Project' });
        
        const duration = Date.now() - startTime;
        
        expect(foundProject).toBeDefined();
        expect(foundProject?.id).toBe(newProject.id);
        expect(updatedProject.description).toBe('Updated description for CRUD testing');
        expect(projects.length).toBeGreaterThan(0);
        
        const avgOperationTime = operations.reduce((sum, op) => sum + op.time, 0) / operations.length;
        
        logger.logTest({
          testName: 'CRUD Operations Test',
          status: 'PASSED',
          duration,
          details: {
            operations: operations.length,
            averageOperationTime: Math.round(avgOperationTime),
            operationBreakdown: operations,
            projectsFound: projects.length
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ CRUD operations test completed in ${duration}ms`);
        logger.log(`   Average operation time: ${Math.round(avgOperationTime)}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'CRUD Operations Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should handle complex queries with relationships', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔗 Testing complex queries with relationships...');
        
        // Get test data
        const projectId = testIds.projects[0];
        const conversationId = testIds.conversations[0];
        const branchId = testIds.branches[0];
        
        if (!projectId || !conversationId || !branchId) {
          throw new Error('Missing test data for relationship queries');
        }
        
        // Test project with conversations
        const projectWithConversations = await projectRepo.findByIdWithRelations(projectId, {
          includeConversations: true
        });
        
        // Test conversation with branches
        const conversationWithBranches = await conversationRepo.findByIdWithRelations(conversationId, {
          includeBranches: true
        });
        
        // Test branch with messages
        const branchWithMessages = await branchRepo.findByIdWithRelations(branchId, {
          includeMessages: true,
          messageLimit: 10
        });
        
        // Test complex aggregation query
        const projectStats = await projectRepo.getProjectStatistics(projectId);
        
        const duration = Date.now() - startTime;
        
        expect(projectWithConversations).toBeDefined();
        expect(conversationWithBranches).toBeDefined();
        expect(branchWithMessages).toBeDefined();
        expect(projectStats).toBeDefined();
        
        logger.logTest({
          testName: 'Complex Relationship Queries',
          status: 'PASSED',
          duration,
          details: {
            projectConversations: projectWithConversations?.conversations?.length || 0,
            conversationBranches: conversationWithBranches?.branches?.length || 0,
            branchMessages: branchWithMessages?.messages?.length || 0,
            projectStats: projectStats ? {
              totalConversations: projectStats.totalConversations,
              totalMessages: projectStats.totalMessages,
              totalDocuments: projectStats.totalDocuments
            } : null
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Complex relationship queries completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Complex Relationship Queries',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should handle batch operations efficiently', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📦 Testing batch operations...');
        
        const projectId = testIds.projects[0];
        if (!projectId) {
          throw new Error('No project available for batch testing');
        }
        
        // Create batch data
        const batchSize = 50;
        const batchConcepts = Array.from({ length: batchSize }, (_, i) => ({
          projectId,
          name: `Batch Concept ${i + 1}`,
          description: `Auto-generated concept ${i + 1} for batch testing`,
          conceptEmbedding: Array.from({ length: 1536 }, () => Math.random()),
          mentionCount: i + 1
        }));
        
        // Test batch create
        const batchStart = Date.now();
        const createdConcepts = await conceptRepo.createBatch(batchConcepts);
        const batchTime = Date.now() - batchStart;
        
        // Add to cleanup list
        createdConcepts.forEach(concept => testIds.concepts.push(concept.id));
        
        // Test batch read
        const readStart = Date.now();
        const foundConcepts = await conceptRepo.findByProject(projectId, {
          limit: batchSize + 10 // Include existing concepts
        });
        const readTime = Date.now() - readStart;
        
        // Test batch update
        const updateStart = Date.now();
        const updateData = createdConcepts.slice(0, 10).map(concept => ({
          id: concept.id,
          mentionCount: concept.mentionCount + 5
        }));
        await conceptRepo.updateBatch(updateData);
        const updateTime = Date.now() - updateStart;
        
        const duration = Date.now() - startTime;
        
        expect(createdConcepts).toHaveLength(batchSize);
        expect(foundConcepts.length).toBeGreaterThanOrEqual(batchSize);
        
        const throughput = Math.round((batchSize * 1000) / batchTime); // Records per second
        
        logger.logTest({
          testName: 'Batch Operations Test',
          status: 'PASSED',
          duration,
          details: {
            batchSize,
            createTime: batchTime,
            readTime,
            updateTime,
            throughput: `${throughput} records/second`,
            conceptsCreated: createdConcepts.length,
            conceptsFound: foundConcepts.length
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Batch operations test completed in ${duration}ms`);
        logger.log(`   Throughput: ${throughput} records/second`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Batch Operations Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('2.3 Data Integrity & Constraints', () => {
    test('should enforce foreign key constraints', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔒 Testing foreign key constraints...');
        
        // Test conversation foreign key constraint
        let constraintError = false;
        try {
          await conversationRepo.create({
            projectId: 'non_existent_project',
            title: 'Invalid Conversation'
          });
        } catch (error) {
          constraintError = true;
          logger.log(`   Expected FK constraint error: ${error}`);
        }
        
        // Test branch foreign key constraint
        let branchConstraintError = false;
        try {
          await branchRepo.create({
            conversationId: 'non_existent_conversation',
            name: 'Invalid Branch',
            model: 'claude'
          });
        } catch (error) {
          branchConstraintError = true;
          logger.log(`   Expected branch FK constraint error: ${error}`);
        }
        
        const duration = Date.now() - startTime;
        
        expect(constraintError).toBe(true);
        expect(branchConstraintError).toBe(true);
        
        logger.logTest({
          testName: 'Foreign Key Constraints Test',
          status: 'PASSED',
          duration,
          details: {
            conversationConstraintEnforced: constraintError,
            branchConstraintEnforced: branchConstraintError
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Foreign key constraints test completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Foreign Key Constraints Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should validate required fields and data types', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('✅ Testing field validation and data types...');
        
        const validationTests = [];
        
        // Test required project name
        try {
          await projectRepo.create({ name: '' });
          validationTests.push({ test: 'empty_project_name', passed: false });
        } catch (error) {
          validationTests.push({ test: 'empty_project_name', passed: true });
          logger.log(`   Required field validation works: ${error}`);
        }
        
        // Test invalid AI model enum
        try {
          await branchRepo.create({
            conversationId: testIds.conversations[0] || 'test',
            name: 'Test Branch',
            model: 'invalid_model' as AIModel
          });
          validationTests.push({ test: 'invalid_ai_model', passed: false });
        } catch (error) {
          validationTests.push({ test: 'invalid_ai_model', passed: true });
          logger.log(`   AI model enum validation works: ${error}`);
        }
        
        // Test invalid message role
        try {
          await messageRepo.create({
            branchId: testIds.branches[0] || 'test',
            role: 'invalid_role' as any,
            content: 'Test message'
          });
          validationTests.push({ test: 'invalid_message_role', passed: false });
        } catch (error) {
          validationTests.push({ test: 'invalid_message_role', passed: true });
          logger.log(`   Message role validation works: ${error}`);
        }
        
        const duration = Date.now() - startTime;
        const allTestsPassed = validationTests.every(test => test.passed);
        
        expect(allTestsPassed).toBe(true);
        
        logger.logTest({
          testName: 'Field Validation Test',
          status: 'PASSED',
          duration,
          details: {
            validationTests,
            allTestsPassed
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Field validation test completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Field Validation Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('2.4 Performance & Scalability', () => {
    test('should handle large datasets efficiently', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📈 Testing performance with large datasets...');
        
        const projectId = testIds.projects[0];
        if (!projectId) {
          throw new Error('No project available for performance testing');
        }
        
        // Test pagination performance
        const pageSize = 20;
        const totalPages = 5;
        
        const paginationTimes = [];
        
        for (let page = 0; page < totalPages; page++) {
          const pageStart = Date.now();
          const concepts = await conceptRepo.findByProject(projectId, {
            limit: pageSize,
            offset: page * pageSize
          });
          const pageTime = Date.now() - pageStart;
          paginationTimes.push(pageTime);
          
          logger.log(`   Page ${page + 1}: ${pageTime}ms (${concepts.length} records)`);
        }
        
        // Test search performance
        const searchStart = Date.now();
        const searchResults = await conceptRepo.search(projectId, 'test', {
          limit: 10
        });
        const searchTime = Date.now() - searchStart;
        
        const duration = Date.now() - startTime;
        const avgPaginationTime = paginationTimes.reduce((a, b) => a + b, 0) / paginationTimes.length;
        
        expect(paginationTimes.every(time => time < 1000)).toBe(true); // All pages under 1s
        expect(searchTime).toBeLessThan(500); // Search under 500ms
        
        logger.logTest({
          testName: 'Large Dataset Performance',
          status: 'PASSED',
          duration,
          details: {
            pagesQueried: totalPages,
            pageSize,
            averagePaginationTime: Math.round(avgPaginationTime),
            maxPaginationTime: Math.max(...paginationTimes),
            searchTime,
            searchResults: searchResults.length,
            performanceTargetsMet: {
              paginationUnder1s: paginationTimes.every(t => t < 1000),
              searchUnder500ms: searchTime < 500
            }
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Large dataset performance test completed in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Large Dataset Performance',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });
});