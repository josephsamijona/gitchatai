/**
 * Base repository class with common database operations
 * Provides standardized CRUD operations and error handling
 */

import { tidbClient, type QueryResult, TiDBError, TiDBErrorType } from '../tidb/client';
import type { PaginationParams, PaginatedResponse, ValidationResult } from '../../types';
import { v4 as uuidv4 } from 'uuid';

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected abstract tableName: string;
  protected abstract validateCreate: (data: unknown) => ValidationResult;
  protected abstract validateUpdate: (data: unknown) => ValidationResult;
  protected abstract mapRowToEntity: (row: any) => T;

  /**
   * Create a new entity
   */
  async create(input: CreateInput): Promise<T> {
    // Validate input
    const validation = this.validateCreate(input);
    if (!validation.isValid) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Validation failed: ${validation.errors.join(', ')}`
      );
    }

    const id = uuidv4();
    const now = new Date();
    
    try {
      // Build insert query dynamically
      const fields = this.getCreateFields(input, id, now);
      const placeholders = Object.keys(fields).map(() => '?').join(', ');
      const fieldNames = Object.keys(fields).join(', ');
      const values = Object.values(fields);

      const sql = `INSERT INTO ${this.tableName} (${fieldNames}) VALUES (${placeholders})`;
      await tidbClient.query(sql, values);

      // Return the created entity
      return await this.findById(id);
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to create ${this.tableName}`,
        error
      );
    }
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<T> {
    try {
      const sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
      const result = await tidbClient.query(sql, [id]);
      
      if (result.rows.length === 0) {
        throw new TiDBError(
          TiDBErrorType.QUERY_ERROR,
          `${this.tableName} with id ${id} not found`
        );
      }

      return this.mapRowToEntity(result.rows[0]);
    } catch (error) {
      if (error instanceof TiDBError) throw error;
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to find ${this.tableName} by id`,
        error
      );
    }
  }

  /**
   * Update entity by ID
   */
  async update(id: string, input: UpdateInput): Promise<T> {
    // Validate input
    const validation = this.validateUpdate(input);
    if (!validation.isValid) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Validation failed: ${validation.errors.join(', ')}`
      );
    }

    try {
      // Check if entity exists
      await this.findById(id);

      // Build update query dynamically
      const fields = this.getUpdateFields(input);
      if (Object.keys(fields).length === 0) {
        throw new TiDBError(
          TiDBErrorType.QUERY_ERROR,
          'No fields to update'
        );
      }

      const setClause = Object.keys(fields).map(field => `${field} = ?`).join(', ');
      const values = [...Object.values(fields), id];

      const sql = `UPDATE ${this.tableName} SET ${setClause}, updated_at = NOW() WHERE id = ?`;
      await tidbClient.query(sql, values);

      // Return the updated entity
      return await this.findById(id);
    } catch (error) {
      if (error instanceof TiDBError) throw error;
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to update ${this.tableName}`,
        error
      );
    }
  }

  /**
   * Delete entity by ID
   */
  async delete(id: string): Promise<void> {
    try {
      // Check if entity exists
      await this.findById(id);

      const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
      const result = await tidbClient.query(sql, [id]);

      if (result.affectedRows === 0) {
        throw new TiDBError(
          TiDBErrorType.QUERY_ERROR,
          `Failed to delete ${this.tableName} with id ${id}`
        );
      }
    } catch (error) {
      if (error instanceof TiDBError) throw error;
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to delete ${this.tableName}`,
        error
      );
    }
  }

  /**
   * Find all entities with pagination
   */
  async findAll(params: PaginationParams = { page: 1, limit: 20 }): Promise<PaginatedResponse<T>> {
    try {
      const offset = (params.page - 1) * params.limit;
      const orderBy = params.sortBy ? `${params.sortBy} ${params.sortOrder || 'ASC'}` : 'created_at DESC';

      // Get total count
      const countSql = `SELECT COUNT(*) as total FROM ${this.tableName}`;
      const countResult = await tidbClient.query(countSql);
      const total = countResult.rows[0].total;

      // Get paginated data
      const dataSql = `SELECT * FROM ${this.tableName} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
      const dataResult = await tidbClient.query(dataSql, [params.limit, offset]);

      const data = dataResult.rows.map(row => this.mapRowToEntity(row));
      const totalPages = Math.ceil(total / params.limit);

      return {
        data,
        pagination: {
          page: params.page,
          limit: params.limit,
          total,
          totalPages,
          hasNext: params.page < totalPages,
          hasPrev: params.page > 1
        }
      };
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to find all ${this.tableName}`,
        error
      );
    }
  }

  /**
   * Find entities by field value
   */
  async findBy(field: string, value: any): Promise<T[]> {
    try {
      const sql = `SELECT * FROM ${this.tableName} WHERE ${field} = ? ORDER BY created_at DESC`;
      const result = await tidbClient.query(sql, [value]);
      
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to find ${this.tableName} by ${field}`,
        error
      );
    }
  }

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const sql = `SELECT 1 FROM ${this.tableName} WHERE id = ? LIMIT 1`;
      const result = await tidbClient.query(sql, [id]);
      return result.rows.length > 0;
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to check if ${this.tableName} exists`,
        error
      );
    }
  }

  /**
   * Count entities
   */
  async count(whereClause?: string, params?: any[]): Promise<number> {
    try {
      const sql = whereClause 
        ? `SELECT COUNT(*) as total FROM ${this.tableName} WHERE ${whereClause}`
        : `SELECT COUNT(*) as total FROM ${this.tableName}`;
      
      const result = await tidbClient.query(sql, params || []);
      return result.rows[0].total;
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Failed to count ${this.tableName}`,
        error
      );
    }
  }

  /**
   * Execute raw SQL query
   */
  protected async executeQuery<R = any>(sql: string, params: any[] = []): Promise<QueryResult<R>> {
    try {
      return await tidbClient.query<R>(sql, params);
    } catch (error) {
      throw new TiDBError(
        TiDBErrorType.QUERY_ERROR,
        `Query execution failed: ${sql}`,
        error
      );
    }
  }

  /**
   * Abstract methods to be implemented by subclasses
   */
  protected abstract getCreateFields(input: CreateInput, id: string, now: Date): Record<string, any>;
  protected abstract getUpdateFields(input: UpdateInput): Record<string, any>;

  /**
   * Helper method to convert database row to Date objects
   */
  protected parseDate(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    if (typeof value === 'number') return new Date(value);
    return new Date();
  }

  /**
   * Helper method to convert embedding array to JSON string for database
   */
  protected serializeEmbedding(embedding: number[]): string {
    return JSON.stringify(embedding);
  }

  /**
   * Helper method to parse embedding from database JSON string
   */
  protected parseEmbedding(value: any): number[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Helper method to safely parse JSON from database
   */
  protected parseJSON(value: any): any {
    if (typeof value === 'object' && value !== null) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return {};
  }
}