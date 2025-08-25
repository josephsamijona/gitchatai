/**
 * Unit tests for BaseRepository
 * Tests common CRUD operations and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseRepository } from '../../src/lib/repositories/base';
import { tidbClient } from '../../src/lib/tidb/client';
import type { ValidationResult } from '../../src/types';

// Mock TiDB client
vi.mock('../../src/lib/tidb/client', () => ({
  tidbClient: {
    query: vi.fn()
  }
}));

// Test implementation of BaseRepository
class TestRepository extends BaseRepository<any, any, any> {
  protected tableName = 'test_table';

  protected validateCreate = (data: unknown): ValidationResult => ({
    isValid: true,
    errors: [],
    warnings: []
  });

  protected validateUpdate = (data: unknown): ValidationResult => ({
    isValid: true,
    errors: [],
    warnings: []
  });

  protected mapRowToEntity = (row: any) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
  });

  protected getCreateFields(input: any, id: string, now: Date) {
    return {
      id,
      name: input.name,
      created_at: now,
      updated_at: now
    };
  }

  protected getUpdateFields(input: any) {
    const fields: any = {};
    if (input.name) fields.name = input.name;
    return fields;
  }
}

describe('BaseRepository', () => {
  let repository: TestRepository;
  const mockQuery = vi.mocked(tidbClient.query);

  beforeEach(() => {
    repository = new TestRepository();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a new entity successfully', async () => {
      const input = { name: 'Test Entity' };
      const mockId = 'test-uuid';
      const mockCreatedEntity = {
        id: mockId,
        name: 'Test Entity',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Mock insert query
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 1,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      // Mock findById for returning created entity
      mockQuery.mockResolvedValueOnce({
        rows: [mockCreatedEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      const result = await repository.create(input);

      expect(result).toEqual({
        id: mockCreatedEntity.id,
        name: mockCreatedEntity.name,
        createdAt: mockCreatedEntity.created_at,
        updatedAt: mockCreatedEntity.updated_at
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 
        expect.stringContaining('INSERT INTO test_table'),
        expect.arrayContaining([expect.any(String), input.name, expect.any(Date), expect.any(Date)])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        'SELECT * FROM test_table WHERE id = ?',
        [expect.any(String)]
      );
    });

    it('should throw error on validation failure', async () => {
      const invalidRepository = new (class extends TestRepository {
        protected validateCreate = (): ValidationResult => ({
          isValid: false,
          errors: ['Invalid data'],
          warnings: []
        });
      })();

      await expect(invalidRepository.create({})).rejects.toThrow('Validation failed: Invalid data');
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find entity by ID successfully', async () => {
      const mockEntity = {
        id: 'test-id',
        name: 'Test Entity',
        created_at: new Date(),
        updated_at: new Date()
      };

      mockQuery.mockResolvedValueOnce({
        rows: [mockEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      const result = await repository.findById('test-id');

      expect(result).toEqual({
        id: mockEntity.id,
        name: mockEntity.name,
        createdAt: mockEntity.created_at,
        updatedAt: mockEntity.updated_at
      });

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM test_table WHERE id = ?',
        ['test-id']
      );
    });

    it('should throw error when entity not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      await expect(repository.findById('nonexistent-id')).rejects.toThrow(
        'test_table with id nonexistent-id not found'
      );
    });
  });

  describe('update', () => {
    it('should update entity successfully', async () => {
      const updateInput = { name: 'Updated Name' };
      const existingEntity = {
        id: 'test-id',
        name: 'Old Name',
        created_at: new Date(),
        updated_at: new Date()
      };
      const updatedEntity = {
        ...existingEntity,
        name: 'Updated Name',
        updated_at: new Date()
      };

      // Mock findById for existence check
      mockQuery.mockResolvedValueOnce({
        rows: [existingEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      // Mock update query
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 1,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      // Mock findById for returning updated entity
      mockQuery.mockResolvedValueOnce({
        rows: [updatedEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      const result = await repository.update('test-id', updateInput);

      expect(result.name).toBe('Updated Name');
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE test_table SET'),
        expect.arrayContaining(['Updated Name', 'test-id'])
      );
    });

    it('should throw error when no fields to update', async () => {
      const existingEntity = {
        id: 'test-id',
        name: 'Test Name',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Mock findById
      mockQuery.mockResolvedValueOnce({
        rows: [existingEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      await expect(repository.update('test-id', {})).rejects.toThrow('No fields to update');
    });
  });

  describe('delete', () => {
    it('should delete entity successfully', async () => {
      const existingEntity = {
        id: 'test-id',
        name: 'Test Entity',
        created_at: new Date(),
        updated_at: new Date()
      };

      // Mock findById for existence check
      mockQuery.mockResolvedValueOnce({
        rows: [existingEntity],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      // Mock delete query
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 1,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      await repository.delete('test-id');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        'DELETE FROM test_table WHERE id = ?',
        ['test-id']
      );
    });

    it('should throw error when entity not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      await expect(repository.delete('nonexistent-id')).rejects.toThrow(
        'test_table with id nonexistent-id not found'
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockEntities = [
        { id: '1', name: 'Entity 1', created_at: new Date(), updated_at: new Date() },
        { id: '2', name: 'Entity 2', created_at: new Date(), updated_at: new Date() }
      ];

      // Mock count query
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: 10 }],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 1,
        warningCount: 0
      });

      // Mock data query
      mockQuery.mockResolvedValueOnce({
        rows: mockEntities,
        affectedRows: 0,
        insertId: 0,
        fieldCount: 4,
        warningCount: 0
      });

      const result = await repository.findAll({ page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 10,
        totalPages: 5,
        hasNext: true,
        hasPrev: false
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1,
        'SELECT COUNT(*) as total FROM test_table'
      );
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        'SELECT * FROM test_table ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [2, 0]
      );
    });
  });

  describe('exists', () => {
    it('should return true when entity exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ '1': 1 }],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 1,
        warningCount: 0
      });

      const result = await repository.exists('test-id');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT 1 FROM test_table WHERE id = ? LIMIT 1',
        ['test-id']
      );
    });

    it('should return false when entity does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 0,
        warningCount: 0
      });

      const result = await repository.exists('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('count', () => {
    it('should return total count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: 42 }],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 1,
        warningCount: 0
      });

      const result = await repository.count();

      expect(result).toBe(42);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as total FROM test_table',
        []
      );
    });

    it('should return count with where clause', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: 5 }],
        affectedRows: 0,
        insertId: 0,
        fieldCount: 1,
        warningCount: 0
      });

      const result = await repository.count('name = ?', ['Test']);

      expect(result).toBe(5);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as total FROM test_table WHERE name = ?',
        ['Test']
      );
    });
  });

  describe('helper methods', () => {
    it('should parse dates correctly', () => {
      const dateString = '2023-01-01T00:00:00Z';
      const dateObj = new Date(dateString);
      const timestamp = Date.now();

      expect(repository['parseDate'](dateString)).toEqual(new Date(dateString));
      expect(repository['parseDate'](dateObj)).toEqual(dateObj);
      expect(repository['parseDate'](timestamp)).toEqual(new Date(timestamp));
    });

    it('should serialize and parse embeddings', () => {
      const embedding = [0.1, 0.2, 0.3];
      const serialized = repository['serializeEmbedding'](embedding);
      const parsed = repository['parseEmbedding'](serialized);

      expect(serialized).toBe(JSON.stringify(embedding));
      expect(parsed).toEqual(embedding);
    });

    it('should parse JSON safely', () => {
      const obj = { key: 'value' };
      const jsonString = JSON.stringify(obj);

      expect(repository['parseJSON'](obj)).toEqual(obj);
      expect(repository['parseJSON'](jsonString)).toEqual(obj);
      expect(repository['parseJSON']('invalid json')).toEqual({});
      expect(repository['parseJSON'](null)).toEqual({});
    });
  });
});