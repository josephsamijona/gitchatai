/**
 * Task 1: TiDB Serverless Integration Tests
 * Created by: Joseph Samuel Jonathan
 * Date: 2024-08-26T14:32:18
 * 
 * Tests TiDB client, connection pooling, error handling, vector operations, 
 * HTAP analytics, and performance monitoring as specified in CLAUDE.md
 */

import { TiDBClient } from '../../lib/tidb/client';
import { VectorSearchService } from '../../lib/workflows/vector-search';
import { EmbeddingService } from '../../lib/ai/embeddings';
import TestLogger from '../utils/test-logger';

const logger = new TestLogger();

describe('Task 1: TiDB Serverless Integration', () => {
  let tidbClient: TiDBClient;
  let vectorSearch: VectorSearchService;
  let embeddingService: EmbeddingService;

  beforeAll(async () => {
    logger.startSuite('TiDB Serverless Integration');
    logger.log('🔧 Initializing TiDB integration test suite...');
    
    // Verify environment variables
    const requiredEnvVars = ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        logger.log(`❌ Missing required environment variable: ${envVar}`);
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    logger.log('✅ Environment variables validated');

    // Initialize services
    tidbClient = new TiDBClient({
      host: process.env.TIDB_HOST!,
      port: parseInt(process.env.TIDB_PORT || '4000'),
      user: process.env.TIDB_USER!,
      password: process.env.TIDB_PASSWORD!,
      database: process.env.TIDB_DATABASE!,
      ssl: process.env.TIDB_SSL === 'true'
    });

    embeddingService = new EmbeddingService({
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      enabled: !!process.env.OPENAI_API_KEY
    });

    vectorSearch = new VectorSearchService({
      tidbClient,
      embeddingService,
      performanceTracking: true,
      caching: {
        enabled: true,
        ttl: 300
      },
      defaultWeights: {
        vector: 0.7,
        fulltext: 0.3
      }
    });

    logger.log('✅ Services initialized successfully');
  });

  afterAll(async () => {
    logger.log('🧹 Cleaning up test resources...');
    
    try {
      await tidbClient.close();
      logger.log('✅ TiDB client closed successfully');
    } catch (error) {
      logger.log(`❌ Error closing TiDB client: ${error}`);
    }

    logger.endSuite();
    
    // Generate and save test reports
    const report = logger.generateReport();
    logger.saveJsonReport();
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST REPORT SUMMARY');
    console.log('='.repeat(80));
    console.log(report);
  });

  describe('1.1 TiDB Client Connection & Pooling', () => {
    test('should establish connection to TiDB Serverless', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔌 Testing TiDB connection...');
        const isConnected = await tidbClient.testConnection();
        
        const duration = Date.now() - startTime;
        
        expect(isConnected).toBe(true);
        
        logger.logTest({
          testName: 'TiDB Connection Test',
          status: 'PASSED',
          duration,
          details: { connectionTime: duration },
          timestamp: new Date()
        });
        
        logger.log(`✅ TiDB connection established in ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'TiDB Connection Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should handle connection pooling correctly', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🏊 Testing connection pooling...');
        
        // Test multiple concurrent connections
        const connectionPromises = Array.from({ length: 10 }, async (_, i) => {
          logger.log(`   Creating connection ${i + 1}/10`);
          return await tidbClient.query('SELECT CONNECTION_ID() as conn_id');
        });

        const results = await Promise.all(connectionPromises);
        const duration = Date.now() - startTime;
        
        // Verify all connections returned results
        expect(results).toHaveLength(10);
        results.forEach((result, i) => {
          expect(result.rows).toHaveLength(1);
          logger.log(`   Connection ${i + 1} ID: ${result.rows[0].conn_id}`);
        });

        logger.logTest({
          testName: 'Connection Pooling Test',
          status: 'PASSED',
          duration,
          details: { 
            connectionsCreated: 10,
            averageConnectionTime: duration / 10,
            connectionIds: results.map(r => r.rows[0].conn_id)
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Connection pooling test completed in ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Connection Pooling Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should handle connection errors gracefully', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🚫 Testing error handling with invalid connection...');
        
        // Create client with invalid credentials
        const invalidClient = new TiDBClient({
          host: process.env.TIDB_HOST!,
          port: parseInt(process.env.TIDB_PORT || '4000'),
          user: 'invalid_user',
          password: 'invalid_password',
          database: 'invalid_db',
          ssl: false
        });

        let errorCaught = false;
        try {
          await invalidClient.testConnection();
        } catch (error) {
          errorCaught = true;
          logger.log(`   Expected error caught: ${error}`);
        }

        const duration = Date.now() - startTime;
        
        expect(errorCaught).toBe(true);
        
        logger.logTest({
          testName: 'Error Handling Test',
          status: 'PASSED',
          duration,
          details: { errorHandledCorrectly: true },
          timestamp: new Date()
        });
        
        logger.log(`✅ Error handling test completed in ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Error Handling Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('1.2 Database Schema & Vector Operations', () => {
    test('should create tables with vector columns', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📋 Testing table creation with vector columns...');
        
        // Test creating a simple table with vector column
        const testTableQuery = `
          CREATE TABLE IF NOT EXISTS test_vectors (
            id VARCHAR(36) PRIMARY KEY,
            content TEXT,
            embedding VECTOR(1536),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            VECTOR INDEX idx_test_embedding (embedding)
          )
        `;
        
        await tidbClient.query(testTableQuery);
        
        // Verify table exists
        const tableCheck = await tidbClient.query(`
          SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'test_vectors' 
          AND TABLE_SCHEMA = DATABASE()
        `);
        
        const duration = Date.now() - startTime;
        
        expect(tableCheck.rows.length).toBeGreaterThan(0);
        
        const vectorColumn = tableCheck.rows.find(row => row.COLUMN_NAME === 'embedding');
        expect(vectorColumn).toBeDefined();
        expect(vectorColumn.DATA_TYPE).toContain('VECTOR');
        
        logger.logTest({
          testName: 'Vector Table Creation Test',
          status: 'PASSED',
          duration,
          details: { 
            tableCreated: 'test_vectors',
            columnsFound: tableCheck.rows.length,
            vectorColumnType: vectorColumn?.DATA_TYPE
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Vector table created and verified in ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Vector Table Creation Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should perform vector operations with VEC_COSINE_DISTANCE', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔍 Testing vector operations...');
        
        if (!embeddingService.isEnabled) {
          logger.logTest({
            testName: 'Vector Operations Test',
            status: 'SKIPPED',
            duration: Date.now() - startTime,
            error: 'OpenAI API key not configured',
            timestamp: new Date()
          });
          return;
        }
        
        // Generate test embeddings
        const testTexts = [
          'Machine learning and artificial intelligence',
          'Deep learning neural networks',
          'Natural language processing tasks'
        ];
        
        logger.log('   Generating embeddings...');
        const embeddings = await embeddingService.generateBatchEmbeddings(testTexts);
        
        // Insert test data
        for (let i = 0; i < testTexts.length; i++) {
          const embeddingStr = `[${embeddings[i].join(',')}]`;
          await tidbClient.query(`
            INSERT INTO test_vectors (id, content, embedding) 
            VALUES (?, ?, VEC_FROM_TEXT(?))
          `, [`test_${i}`, testTexts[i], embeddingStr]);
        }
        
        logger.log('   Inserted test vectors, performing similarity search...');
        
        // Test vector similarity search
        const queryEmbedding = embeddings[0];
        const queryEmbeddingStr = `[${queryEmbedding.join(',')}]`;
        
        const similarityResults = await tidbClient.query(`
          SELECT id, content, 
                 VEC_COSINE_DISTANCE(embedding, VEC_FROM_TEXT(?)) as distance
          FROM test_vectors
          ORDER BY distance ASC
          LIMIT 3
        `, [queryEmbeddingStr]);
        
        const duration = Date.now() - startTime;
        
        expect(similarityResults.rows).toHaveLength(3);
        expect(similarityResults.rows[0].distance).toBeLessThan(0.1); // Should be very similar to itself
        
        logger.logTest({
          testName: 'Vector Operations Test',
          status: 'PASSED',
          duration,
          details: {
            vectorsInserted: testTexts.length,
            embeddingDimensions: embeddings[0].length,
            topSimilarityDistance: similarityResults.rows[0].distance,
            resultsReturned: similarityResults.rows.length
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Vector operations completed in ${duration}ms`);
        logger.log(`   Top result: "${similarityResults.rows[0].content}" (distance: ${similarityResults.rows[0].distance})`);
        
        // Cleanup
        await tidbClient.query('DELETE FROM test_vectors');
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Vector Operations Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('1.3 Performance Monitoring & HTAP Analytics', () => {
    test('should achieve vector search under 200ms (CLAUDE.md requirement)', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('⚡ Testing vector search performance (<200ms requirement)...');
        
        if (!embeddingService.isEnabled) {
          logger.logTest({
            testName: 'Vector Search Performance Test',
            status: 'SKIPPED',
            duration: Date.now() - startTime,
            error: 'OpenAI API key not configured',
            timestamp: new Date()
          });
          return;
        }
        
        // Setup test data
        const testData = Array.from({ length: 100 }, (_, i) => ({
          id: `perf_test_${i}`,
          content: `Test content item ${i} for performance testing with various keywords and phrases to simulate real content`,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 2 - 1) // Random embeddings for speed
        }));
        
        logger.log(`   Inserting ${testData.length} test records...`);
        for (const item of testData) {
          const embeddingStr = `[${item.embedding.join(',')}]`;
          await tidbClient.query(`
            INSERT INTO test_vectors (id, content, embedding) 
            VALUES (?, ?, VEC_FROM_TEXT(?))
          `, [item.id, item.content, embeddingStr]);
        }
        
        // Perform performance test
        const searchTimes: number[] = [];
        const numSearches = 10;
        
        logger.log(`   Performing ${numSearches} search operations...`);
        
        for (let i = 0; i < numSearches; i++) {
          const searchStart = Date.now();
          const queryEmbedding = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
          const queryEmbeddingStr = `[${queryEmbedding.join(',')}]`;
          
          const results = await tidbClient.query(`
            SELECT id, content, 
                   VEC_COSINE_DISTANCE(embedding, VEC_FROM_TEXT(?)) as distance
            FROM test_vectors
            ORDER BY distance ASC
            LIMIT 10
          `, [queryEmbeddingStr]);
          
          const searchTime = Date.now() - searchStart;
          searchTimes.push(searchTime);
          
          logger.log(`   Search ${i + 1}: ${searchTime}ms (${results.rows.length} results)`);
          
          expect(results.rows.length).toBe(10);
          expect(searchTime).toBeLessThan(200); // CLAUDE.md requirement
        }
        
        const duration = Date.now() - startTime;
        const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
        const maxSearchTime = Math.max(...searchTimes);
        const minSearchTime = Math.min(...searchTimes);
        
        logger.logTest({
          testName: 'Vector Search Performance Test',
          status: 'PASSED',
          duration,
          details: {
            testRecords: testData.length,
            searchesPerformed: numSearches,
            averageSearchTime: Math.round(avgSearchTime),
            maxSearchTime,
            minSearchTime,
            requirementMet: maxSearchTime < 200,
            requirement: '<200ms'
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Performance test completed in ${duration}ms`);
        logger.log(`   Average search time: ${Math.round(avgSearchTime)}ms`);
        logger.log(`   Max search time: ${maxSearchTime}ms (requirement: <200ms)`);
        
        // Cleanup
        await tidbClient.query('DELETE FROM test_vectors WHERE id LIKE "perf_test_%"');
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Vector Search Performance Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });

    test('should demonstrate HTAP analytics capabilities', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('📊 Testing HTAP analytics capabilities...');
        
        // Insert sample data for analytics
        const sampleData = [
          { model: 'claude', processing_time: 150, token_count: 500 },
          { model: 'gpt4', processing_time: 200, token_count: 600 },
          { model: 'gemini', processing_time: 120, token_count: 450 },
          { model: 'claude', processing_time: 180, token_count: 520 },
          { model: 'gpt4', processing_time: 220, token_count: 650 }
        ];
        
        // Create analytics test table
        await tidbClient.query(`
          CREATE TABLE IF NOT EXISTS test_analytics (
            id INT AUTO_INCREMENT PRIMARY KEY,
            model VARCHAR(50),
            processing_time INT,
            token_count INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        logger.log('   Inserting analytics test data...');
        for (const data of sampleData) {
          await tidbClient.query(`
            INSERT INTO test_analytics (model, processing_time, token_count)
            VALUES (?, ?, ?)
          `, [data.model, data.processing_time, data.token_count]);
        }
        
        // Perform HTAP analytics queries
        logger.log('   Executing analytical queries...');
        
        const analyticsQueries = [
          {
            name: 'Average processing time by model',
            query: `
              SELECT model, 
                     AVG(processing_time) as avg_time,
                     COUNT(*) as count,
                     MIN(processing_time) as min_time,
                     MAX(processing_time) as max_time
              FROM test_analytics 
              GROUP BY model
              ORDER BY avg_time ASC
            `
          },
          {
            name: 'Performance trends',
            query: `
              SELECT 
                COUNT(*) as total_requests,
                AVG(processing_time) as overall_avg_time,
                AVG(token_count) as avg_tokens,
                SUM(CASE WHEN processing_time < 200 THEN 1 ELSE 0 END) as fast_requests
              FROM test_analytics
            `
          }
        ];
        
        const analyticsResults: any[] = [];
        
        for (const query of analyticsQueries) {
          const queryStart = Date.now();
          const result = await tidbClient.query(query.query);
          const queryTime = Date.now() - queryStart;
          
          analyticsResults.push({
            name: query.name,
            queryTime,
            rowsReturned: result.rows.length,
            data: result.rows
          });
          
          logger.log(`   ${query.name}: ${queryTime}ms (${result.rows.length} rows)`);
        }
        
        const duration = Date.now() - startTime;
        
        expect(analyticsResults).toHaveLength(2);
        expect(analyticsResults[0].rowsReturned).toBeGreaterThan(0);
        
        logger.logTest({
          testName: 'HTAP Analytics Test',
          status: 'PASSED',
          duration,
          details: {
            testDataRows: sampleData.length,
            analyticsQueries: analyticsQueries.length,
            results: analyticsResults.map(r => ({
              name: r.name,
              queryTime: r.queryTime,
              rows: r.rowsReturned
            }))
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ HTAP analytics test completed in ${duration}ms`);
        
        // Cleanup
        await tidbClient.query('DROP TABLE IF EXISTS test_analytics');
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'HTAP Analytics Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('1.4 Migration Scripts & Production Readiness', () => {
    test('should execute migration scripts successfully', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🔄 Testing migration script execution...');
        
        // Test schema migration
        const migrationQueries = [
          `CREATE TABLE IF NOT EXISTS migration_test (
            id VARCHAR(36) PRIMARY KEY,
            version INT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`,
          `INSERT INTO migration_test (id, version) VALUES ('test_migration_1', 1)`,
          `ALTER TABLE migration_test ADD COLUMN description TEXT`,
          `UPDATE migration_test SET description = 'Test migration' WHERE id = 'test_migration_1'`
        ];
        
        for (let i = 0; i < migrationQueries.length; i++) {
          const migrationStart = Date.now();
          await tidbClient.query(migrationQueries[i]);
          const migrationTime = Date.now() - migrationStart;
          
          logger.log(`   Migration step ${i + 1}: ${migrationTime}ms`);
        }
        
        // Verify migration results
        const verifyResult = await tidbClient.query(`
          SELECT * FROM migration_test WHERE id = 'test_migration_1'
        `);
        
        const duration = Date.now() - startTime;
        
        expect(verifyResult.rows).toHaveLength(1);
        expect(verifyResult.rows[0].version).toBe(1);
        expect(verifyResult.rows[0].description).toBe('Test migration');
        
        logger.logTest({
          testName: 'Migration Scripts Test',
          status: 'PASSED',
          duration,
          details: {
            migrationSteps: migrationQueries.length,
            finalRecord: verifyResult.rows[0]
          },
          timestamp: new Date()
        });
        
        logger.log(`✅ Migration scripts test completed in ${duration}ms`);
        
        // Cleanup
        await tidbClient.query('DROP TABLE IF EXISTS migration_test');
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Migration Scripts Test',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
        throw error;
      }
    });
  });

  describe('1.5 Cleanup Test Resources', () => {
    test('should cleanup all test tables', async () => {
      const startTime = Date.now();
      
      try {
        logger.log('🧹 Cleaning up test resources...');
        
        const cleanupQueries = [
          'DROP TABLE IF EXISTS test_vectors',
          'DROP TABLE IF EXISTS test_analytics',
          'DROP TABLE IF EXISTS migration_test'
        ];
        
        for (const query of cleanupQueries) {
          await tidbClient.query(query);
        }
        
        const duration = Date.now() - startTime;
        
        logger.logTest({
          testName: 'Cleanup Test Resources',
          status: 'PASSED',
          duration,
          details: { tablesDropped: cleanupQueries.length },
          timestamp: new Date()
        });
        
        logger.log(`✅ Test resources cleaned up in ${duration}ms`);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.logTest({
          testName: 'Cleanup Test Resources',
          status: 'FAILED',
          duration,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });
      }
    });
  });
});