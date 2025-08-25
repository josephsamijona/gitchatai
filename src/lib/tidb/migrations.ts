import { tidbClient, TiDBError, TiDBErrorType } from './client';
import { initializeSchema, dropSchema, checkSchema } from './schema';

/**
 * Database migration scripts for production deployment
 * Handles schema versioning, data migrations, and rollbacks
 */

export interface Migration {
  version: string;
  name: string;
  description: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
  createdAt: Date;
}

export interface MigrationRecord {
  version: string;
  name: string;
  executedAt: Date;
  executionTimeMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Migration Manager
 */
export class MigrationManager {
  private static migrations: Migration[] = [];

  /**
   * Register a migration
   */
  static registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Initialize migration tracking table
   */
  static async initializeMigrationTable(): Promise<void> {
    try {
      const sql = `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          execution_time_ms INT NOT NULL,
          success BOOLEAN NOT NULL,
          error_message TEXT,
          
          INDEX idx_executed_at (executed_at),
          INDEX idx_success (success)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `;

      await tidbClient.query(sql);
      console.log('Migration tracking table initialized');
    } catch (error) {
      throw new TiDBError(TiDBErrorType.SCHEMA_ERROR, 'Failed to initialize migration table', error);
    }
  }

  /**
   * Get executed migrations
   */
  static async getExecutedMigrations(): Promise<MigrationRecord[]> {
    try {
      const sql = `
        SELECT version, name, executed_at as executedAt, execution_time_ms as executionTimeMs, 
               success, error_message as errorMessage
        FROM schema_migrations
        ORDER BY version ASC
      `;

      const result = await tidbClient.query<MigrationRecord>(sql);
      return result.rows;
    } catch (error) {
      // If table doesn't exist, return empty array
      if (error.message?.includes('Table') && error.message?.includes("doesn't exist")) {
        return [];
      }
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get executed migrations', error);
    }
  }

  /**
   * Record migration execution
   */
  static async recordMigration(
    version: string,
    name: string,
    executionTimeMs: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      const sql = `
        INSERT INTO schema_migrations (version, name, execution_time_ms, success, error_message)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        executed_at = CURRENT_TIMESTAMP,
        execution_time_ms = VALUES(execution_time_ms),
        success = VALUES(success),
        error_message = VALUES(error_message)
      `;

      await tidbClient.query(sql, [version, name, executionTimeMs, success, errorMessage]);
    } catch (error) {
      console.error('Failed to record migration:', error);
      // Don't throw here to avoid masking the original migration error
    }
  }

  /**
   * Run pending migrations
   */
  static async migrate(): Promise<void> {
    console.log('Starting database migration...');
    
    try {
      // Initialize migration table
      await this.initializeMigrationTable();

      // Get executed migrations
      const executedMigrations = await this.getExecutedMigrations();
      const executedVersions = new Set(executedMigrations.map(m => m.version));

      // Find pending migrations
      const pendingMigrations = this.migrations.filter(m => !executedVersions.has(m.version));

      if (pendingMigrations.length === 0) {
        console.log('No pending migrations');
        return;
      }

      console.log(`Found ${pendingMigrations.length} pending migrations`);

      // Execute pending migrations
      for (const migration of pendingMigrations) {
        console.log(`Executing migration ${migration.version}: ${migration.name}`);
        const startTime = Date.now();
        
        try {
          await migration.up();
          const executionTime = Date.now() - startTime;
          
          await this.recordMigration(migration.version, migration.name, executionTime, true);
          console.log(`✓ Migration ${migration.version} completed in ${executionTime}ms`);
        } catch (error) {
          const executionTime = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          await this.recordMigration(migration.version, migration.name, executionTime, false, errorMessage);
          console.error(`✗ Migration ${migration.version} failed:`, error);
          throw new TiDBError(TiDBErrorType.SCHEMA_ERROR, `Migration ${migration.version} failed`, error);
        }
      }

      console.log('All migrations completed successfully');
    } catch (error) {
      console.error('Migration process failed:', error);
      throw error;
    }
  }

  /**
   * Rollback to a specific version
   */
  static async rollback(targetVersion: string): Promise<void> {
    console.log(`Rolling back to version ${targetVersion}...`);
    
    try {
      const executedMigrations = await this.getExecutedMigrations();
      const successfulMigrations = executedMigrations.filter(m => m.success);
      
      // Find migrations to rollback (in reverse order)
      const migrationsToRollback = successfulMigrations
        .filter(m => m.version > targetVersion)
        .sort((a, b) => b.version.localeCompare(a.version));

      if (migrationsToRollback.length === 0) {
        console.log('No migrations to rollback');
        return;
      }

      console.log(`Rolling back ${migrationsToRollback.length} migrations`);

      // Execute rollbacks
      for (const migrationRecord of migrationsToRollback) {
        const migration = this.migrations.find(m => m.version === migrationRecord.version);
        
        if (!migration) {
          console.warn(`Migration ${migrationRecord.version} not found in registered migrations, skipping rollback`);
          continue;
        }

        console.log(`Rolling back migration ${migration.version}: ${migration.name}`);
        const startTime = Date.now();
        
        try {
          await migration.down();
          const executionTime = Date.now() - startTime;
          
          // Remove migration record
          await tidbClient.query('DELETE FROM schema_migrations WHERE version = ?', [migration.version]);
          console.log(`✓ Migration ${migration.version} rolled back in ${executionTime}ms`);
        } catch (error) {
          console.error(`✗ Rollback of migration ${migration.version} failed:`, error);
          throw new TiDBError(TiDBErrorType.SCHEMA_ERROR, `Rollback of migration ${migration.version} failed`, error);
        }
      }

      console.log('Rollback completed successfully');
    } catch (error) {
      console.error('Rollback process failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  static async getStatus(): Promise<{
    totalMigrations: number;
    executedMigrations: number;
    pendingMigrations: number;
    lastMigration?: MigrationRecord;
    failedMigrations: MigrationRecord[];
  }> {
    try {
      const executedMigrations = await this.getExecutedMigrations();
      const executedVersions = new Set(executedMigrations.map(m => m.version));
      const pendingMigrations = this.migrations.filter(m => !executedVersions.has(m.version));
      const failedMigrations = executedMigrations.filter(m => !m.success);
      const lastMigration = executedMigrations
        .filter(m => m.success)
        .sort((a, b) => b.version.localeCompare(a.version))[0];

      return {
        totalMigrations: this.migrations.length,
        executedMigrations: executedMigrations.filter(m => m.success).length,
        pendingMigrations: pendingMigrations.length,
        lastMigration,
        failedMigrations
      };
    } catch (error) {
      throw new TiDBError(TiDBErrorType.QUERY_ERROR, 'Failed to get migration status', error);
    }
  }
}

// Register core migrations
MigrationManager.registerMigration({
  version: '001',
  name: 'initial_schema',
  description: 'Create initial database schema with vector support',
  up: async () => {
    await initializeSchema();
  },
  down: async () => {
    await dropSchema();
  },
  createdAt: new Date('2025-01-01')
});

MigrationManager.registerMigration({
  version: '002',
  name: 'add_performance_indexes',
  description: 'Add performance optimization indexes',
  up: async () => {
    const indexes = [
      'CREATE INDEX idx_messages_created_model ON messages(created_at, model)',
      'CREATE INDEX idx_branches_conversation_model ON branches(conversation_id, model)',
      'CREATE INDEX idx_documents_project_processed ON documents(project_id, processed_at)',
      'CREATE INDEX idx_concepts_project_mentions ON concepts(project_id, mention_count DESC)',
      'CREATE INDEX idx_performance_operation_time ON performance_metrics(operation_type, created_at)',
    ];

    for (const indexSql of indexes) {
      try {
        await tidbClient.query(indexSql);
      } catch (error) {
        // Ignore if index already exists
        if (!error.message?.includes('Duplicate key name')) {
          throw error;
        }
      }
    }
  },
  down: async () => {
    const indexes = [
      'DROP INDEX idx_messages_created_model ON messages',
      'DROP INDEX idx_branches_conversation_model ON branches',
      'DROP INDEX idx_documents_project_processed ON documents',
      'DROP INDEX idx_concepts_project_mentions ON concepts',
      'DROP INDEX idx_performance_operation_time ON performance_metrics',
    ];

    for (const indexSql of indexes) {
      try {
        await tidbClient.query(indexSql);
      } catch (error) {
        // Ignore if index doesn't exist
        if (!error.message?.includes("doesn't exist")) {
          throw error;
        }
      }
    }
  },
  createdAt: new Date('2025-01-02')
});

MigrationManager.registerMigration({
  version: '003',
  name: 'add_query_hash_column',
  description: 'Add query_hash column to performance_metrics for better analytics',
  up: async () => {
    try {
      await tidbClient.query(`
        ALTER TABLE performance_metrics 
        ADD COLUMN query_hash VARCHAR(64) AFTER model
      `);
      
      await tidbClient.query(`
        CREATE INDEX idx_query_hash ON performance_metrics(query_hash)
      `);
    } catch (error) {
      // Ignore if column already exists
      if (!error.message?.includes('Duplicate column name')) {
        throw error;
      }
    }
  },
  down: async () => {
    try {
      await tidbClient.query('DROP INDEX idx_query_hash ON performance_metrics');
      await tidbClient.query('ALTER TABLE performance_metrics DROP COLUMN query_hash');
    } catch (error) {
      // Ignore if column doesn't exist
      console.warn('Failed to drop query_hash column:', error.message);
    }
  },
  createdAt: new Date('2025-01-03')
});

MigrationManager.registerMigration({
  version: '004',
  name: 'add_workflow_tracking',
  description: 'Add workflow execution tracking for multi-step AI workflows',
  up: async () => {
    // This table is already defined in schema.ts, so just verify it exists
    const schemaExists = await checkSchema();
    if (!schemaExists) {
      throw new Error('Base schema must be initialized first');
    }
    
    // Add any additional workflow-specific indexes
    try {
      await tidbClient.query(`
        CREATE INDEX idx_workflow_project_type ON workflow_executions(project_id, workflow_type, status)
      `);
    } catch (error) {
      if (!error.message?.includes('Duplicate key name')) {
        throw error;
      }
    }
  },
  down: async () => {
    try {
      await tidbClient.query('DROP INDEX idx_workflow_project_type ON workflow_executions');
    } catch (error) {
      console.warn('Failed to drop workflow index:', error.message);
    }
  },
  createdAt: new Date('2025-01-04')
});

/**
 * Production deployment helper
 */
export async function deployToProduction(): Promise<void> {
  console.log('Starting production deployment...');
  
  try {
    // Check if database is accessible
    const poolStatus = tidbClient.getPoolStatus();
    if (!poolStatus.isConnected) {
      throw new Error('Database connection not established');
    }

    // Run migrations
    await MigrationManager.migrate();

    // Verify schema integrity
    const schemaExists = await checkSchema();
    if (!schemaExists) {
      throw new Error('Schema verification failed after migration');
    }

    // Get final status
    const status = await MigrationManager.getStatus();
    console.log('Deployment completed successfully:', status);

    if (status.failedMigrations.length > 0) {
      console.warn('Some migrations failed:', status.failedMigrations);
    }

  } catch (error) {
    console.error('Production deployment failed:', error);
    throw error;
  }
}

/**
 * Development environment setup
 */
export async function setupDevelopment(): Promise<void> {
  console.log('Setting up development environment...');
  
  try {
    // Initialize migration table
    await MigrationManager.initializeMigrationTable();

    // Run all migrations
    await MigrationManager.migrate();

    console.log('Development environment setup completed');
  } catch (error) {
    console.error('Development setup failed:', error);
    throw error;
  }
}

/**
 * Reset database (development only)
 */
export async function resetDatabase(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Database reset is not allowed in production');
  }

  console.log('Resetting database...');
  
  try {
    // Drop all tables
    await dropSchema();

    // Clear migration records
    try {
      await tidbClient.query('DROP TABLE IF EXISTS schema_migrations');
    } catch (error) {
      console.warn('Failed to drop migration table:', error.message);
    }

    // Reinitialize
    await setupDevelopment();

    console.log('Database reset completed');
  } catch (error) {
    console.error('Database reset failed:', error);
    throw error;
  }
}

export default MigrationManager;