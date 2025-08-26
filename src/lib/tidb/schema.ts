import { tidbClient } from './client';

/**
 * Complete TiDB schema for SYNAPSE platform
 * Includes vector columns, full-text indexes, and HTAP analytics tables
 */

export const SCHEMA_QUERIES = {
  // Conversations with title embeddings for semantic search
  conversations: `
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36),
      title TEXT NOT NULL,
      title_embedding VECTOR(1536),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      INDEX idx_project (project_id),
      INDEX idx_created (created_at),
      FULLTEXT(title),
      VECTOR INDEX idx_title_vec (title_embedding)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Branches with context embeddings for model switching
  branches: `
    CREATE TABLE IF NOT EXISTS branches (
      id VARCHAR(36) PRIMARY KEY,
      conversation_id VARCHAR(36) NOT NULL,
      parent_branch_id VARCHAR(36),
      name VARCHAR(255) NOT NULL,
      model ENUM('claude', 'gpt4', 'kimi', 'grok') NOT NULL,
      context_summary TEXT,
      context_embedding VECTOR(1536),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      INDEX idx_conversation (conversation_id),
      INDEX idx_parent (parent_branch_id),
      INDEX idx_model (model),
      INDEX idx_created (created_at),
      FULLTEXT(name, context_summary),
      VECTOR INDEX idx_context_vec (context_embedding)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Messages with content embeddings for semantic search
  messages: `
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) PRIMARY KEY,
      branch_id VARCHAR(36) NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      content TEXT NOT NULL,
      content_embedding VECTOR(1536),
      model VARCHAR(50),
      token_count INT DEFAULT 0,
      processing_time_ms INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      INDEX idx_branch (branch_id),
      INDEX idx_role (role),
      INDEX idx_model (model),
      INDEX idx_created (created_at),
      INDEX idx_processing_time (processing_time_ms),
      FULLTEXT(content),
      VECTOR INDEX idx_content_vec (content_embedding)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Projects for workspace isolation
  projects: `
    CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      custom_instructions TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      INDEX idx_name (name),
      INDEX idx_created (created_at),
      FULLTEXT(name, description, custom_instructions)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Documents with content embeddings for knowledge base
  documents: `
    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      content LONGTEXT NOT NULL,
      content_embedding VECTOR(1536),
      metadata JSON,
      s3_key VARCHAR(500),
      file_size BIGINT DEFAULT 0,
      mime_type VARCHAR(100),
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project (project_id),
      INDEX idx_filename (filename),
      INDEX idx_mime_type (mime_type),
      INDEX idx_processed (processed_at),
      FULLTEXT(filename, content),
      VECTOR INDEX idx_doc_vec (content_embedding)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Concepts for knowledge graph generation
  concepts: `
    CREATE TABLE IF NOT EXISTS concepts (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      concept_embedding VECTOR(1536),
      mention_count INT DEFAULT 0,
      confidence_score DECIMAL(3,2) DEFAULT 0.5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project (project_id),
      INDEX idx_name (name),
      INDEX idx_mentions (mention_count),
      INDEX idx_confidence (confidence_score),
      INDEX idx_created (created_at),
      FULLTEXT(name, description),
      VECTOR INDEX idx_concept_vec (concept_embedding)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Concept relationships for knowledge graph
  conceptRelationships: `
    CREATE TABLE IF NOT EXISTS concept_relationships (
      id VARCHAR(36) PRIMARY KEY,
      source_concept_id VARCHAR(36) NOT NULL,
      target_concept_id VARCHAR(36) NOT NULL,
      relationship_type ENUM('related', 'parent', 'child', 'similar', 'opposite', 'causes', 'enables') NOT NULL,
      strength DECIMAL(3,2) DEFAULT 0.5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (source_concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
      FOREIGN KEY (target_concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
      INDEX idx_source (source_concept_id),
      INDEX idx_target (target_concept_id),
      INDEX idx_type (relationship_type),
      INDEX idx_strength (strength),
      INDEX idx_created (created_at),
      UNIQUE KEY unique_relationship (source_concept_id, target_concept_id, relationship_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Team members for collaboration
  teamMembers: `
    CREATE TABLE IF NOT EXISTS team_members (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
      role ENUM('owner', 'editor', 'viewer') NOT NULL,
      permissions JSON,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project (project_id),
      INDEX idx_user (user_id),
      INDEX idx_email (email),
      INDEX idx_role (role),
      INDEX idx_joined (joined_at),
      UNIQUE KEY unique_member (project_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Performance metrics for HTAP analytics
  performanceMetrics: `
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id VARCHAR(36) PRIMARY KEY,
      operation_type ENUM('vector_search', 'full_text_search', 'hybrid_search', 'llm_call', 'embedding_generation', 'select', 'insert', 'update', 'delete') NOT NULL,
      execution_time_ms INT NOT NULL,
      result_count INT DEFAULT 0,
      model VARCHAR(50),
      query_hash VARCHAR(64),
      success BOOLEAN DEFAULT TRUE,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      INDEX idx_operation (operation_type),
      INDEX idx_time (execution_time_ms),
      INDEX idx_model (model),
      INDEX idx_success (success),
      INDEX idx_created (created_at),
      INDEX idx_query_hash (query_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // External API integrations tracking
  externalIntegrations: `
    CREATE TABLE IF NOT EXISTS external_integrations (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      integration_type ENUM('slack', 'email', 'webhook', 'api') NOT NULL,
      endpoint_url VARCHAR(500),
      configuration JSON,
      is_active BOOLEAN DEFAULT TRUE,
      last_used TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project (project_id),
      INDEX idx_type (integration_type),
      INDEX idx_active (is_active),
      INDEX idx_last_used (last_used)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,

  // Workflow execution tracking for multi-step AI workflows
  workflowExecutions: `
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36),
      conversation_id VARCHAR(36),
      branch_id VARCHAR(36),
      workflow_type ENUM('ingestion', 'search', 'llm', 'external_api', 'synthesis') NOT NULL,
      status ENUM('pending', 'running', 'completed', 'failed') NOT NULL,
      input_data JSON,
      output_data JSON,
      execution_time_ms INT,
      error_message TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      INDEX idx_project (project_id),
      INDEX idx_conversation (conversation_id),
      INDEX idx_branch (branch_id),
      INDEX idx_workflow_type (workflow_type),
      INDEX idx_status (status),
      INDEX idx_started (started_at),
      INDEX idx_completed (completed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `
};

/**
 * Initialize database schema
 */
export async function initializeSchema(): Promise<void> {
  console.log('Initializing TiDB schema...');

  try {
    // Create tables in dependency order
    const tableOrder = [
      'projects',
      'conversations',
      'branches',
      'messages',
      'documents',
      'concepts',
      'conceptRelationships',
      'teamMembers',
      'performanceMetrics',
      'externalIntegrations',
      'workflowExecutions'
    ];

    for (const tableName of tableOrder) {
      console.log(`Creating table: ${tableName}`);
      await tidbClient.query(SCHEMA_QUERIES[tableName as keyof typeof SCHEMA_QUERIES]);
    }

    // Create real-time updates table for WebSocket collaboration
    await createRealtimeUpdatesTable();

    console.log('Schema initialization completed successfully');
  } catch (error) {
    console.error('Schema initialization failed:', error);
    throw error;
  }
}

/**
 * Drop all tables (for development/testing)
 */
export async function dropSchema(): Promise<void> {
  console.log('Dropping TiDB schema...');

  const tables = [
    'realtime_updates',
    'workflow_executions',
    'external_integrations',
    'performance_metrics',
    'team_members',
    'concept_relationships',
    'concepts',
    'documents',
    'messages',
    'branches',
    'conversations',
    'projects'
  ];

  try {
    // Disable foreign key checks
    await tidbClient.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tables) {
      console.log(`Dropping table: ${table}`);
      await tidbClient.query(`DROP TABLE IF EXISTS ${table}`);
    }

    // Re-enable foreign key checks
    await tidbClient.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('Schema dropped successfully');
  } catch (error) {
    console.error('Schema drop failed:', error);
    throw error;
  }
}

/**
 * Check if schema is initialized
 */
export async function checkSchema(): Promise<boolean> {
  try {
    const result = await tidbClient.query(`
      SELECT COUNT(*) as table_count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
      AND table_name IN ('conversations', 'branches', 'messages', 'projects', 'documents', 'concepts')
    `);

    return result.rows[0].table_count === 6;
  } catch (error) {
    console.error('Schema check failed:', error);
    return false;
  }
}

/**
 * Get schema statistics for monitoring
 */
export async function getSchemaStats(): Promise<Record<string, any>> {
  try {
    const result = await tidbClient.query(`
      SELECT 
        table_name,
        table_rows,
        data_length,
        index_length,
        (data_length + index_length) as total_size
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
      ORDER BY total_size DESC
    `);

    return result.rows.reduce((acc, row) => {
      acc[row.table_name] = {
        rows: row.table_rows,
        dataSize: row.data_length,
        indexSize: row.index_length,
        totalSize: row.total_size
      };
      return acc;
    }, {});
  } catch (error) {
    console.error('Failed to get schema stats:', error);
    return {};
  }
}

/**
 * Create real-time updates table for WebSocket collaboration
 */
export async function createRealtimeUpdatesTable(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS realtime_updates (
      id VARCHAR(36) PRIMARY KEY,
      project_id VARCHAR(36) NOT NULL,
      type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(36) NOT NULL,
      entity_type VARCHAR(20) NOT NULL,
      data JSON NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      metadata JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      INDEX idx_project_created (project_id, created_at DESC),
      INDEX idx_entity (entity_type, entity_id),
      INDEX idx_user_activity (user_id, created_at DESC),
      INDEX idx_type_created (type, created_at DESC),
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await client.executeQuery(createTableQuery);
  console.log('Real-time updates table created successfully');
}