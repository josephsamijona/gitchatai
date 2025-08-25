/**
 * Document repository for file management and vector indexing
 * Handles document upload, processing, and vector search
 */

import { BaseRepository } from './base';
import { tidbClient } from '../tidb/client';
import { validateCreateDocumentInput } from '../utils/validation';
import type { 
  Document, 
  CreateDocumentInput, 
  UpdateDocumentInput,
  DocumentProcessingStatus,
  DocumentChunk,
  ValidationResult,
  VectorSearchResult,
  PaginatedResponse,
  PaginationParams
} from '../../types';

export class DocumentRepository extends BaseRepository<Document, CreateDocumentInput, UpdateDocumentInput> {
  protected tableName = 'documents';

  protected validateCreate = validateCreateDocumentInput;
  protected validateUpdate = (data: unknown): ValidationResult => {
    // Documents typically aren't updated after creation, but we can validate filename changes
    return { isValid: true, errors: [], warnings: [] };
  };

  protected mapRowToEntity = (row: any): Document => {
    return {
      id: row.id,
      projectId: row.project_id,
      filename: row.filename,
      content: row.content,
      contentEmbedding: this.parseEmbedding(row.content_embedding),
      metadata: this.parseJSON(row.metadata),
      s3Key: row.s3_key || undefined,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      processedAt: this.parseDate(row.processed_at)
    };
  };

  protected getCreateFields(input: CreateDocumentInput, id: string, now: Date): Record<string, any> {
    return {
      id,
      project_id: input.projectId,
      filename: input.filename,
      content: input.content,
      content_embedding: this.serializeEmbedding([]), // Will be updated with actual embedding
      metadata: JSON.stringify(input.metadata || {}),
      s3_key: input.s3Key || null,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      processed_at: now
    };
  };

  protected getUpdateFields(input: UpdateDocumentInput): Record<string, any> {
    const fields: Record<string, any> = {};
    
    // Documents are typically immutable after creation, but allow metadata updates
    if (input.metadata !== undefined) {
      fields.metadata = JSON.stringify(input.metadata);
    }
    
    return fields;
  };

  /**
   * Update document content embedding
   */
  async updateContentEmbedding(id: string, embedding: number[]): Promise<void> {
    const sql = `UPDATE ${this.tableName} SET content_embedding = ? WHERE id = ?`;
    await this.executeQuery(sql, [this.serializeEmbedding(embedding), id]);
  }

  /**
   * Find documents by project
   */
  async findByProject(projectId: string, params?: PaginationParams): Promise<PaginatedResponse<Document>> {
    try {
      const pagination = params || { page: 1, limit: 20 };
      const offset = (pagination.page - 1) * pagination.limit;
      const orderBy = pagination.sortBy ? `${pagination.sortBy} ${pagination.sortOrder || 'DESC'}` : 'processed_at DESC';

      // Get total count
      const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} WHERE project_id = ?`;
      const countResult = await this.executeQuery(countSql, [projectId]);
      const total = countResult.rows[0].total;

      // Get paginated data
      const dataSql = `
        SELECT * FROM ${this.tableName} 
        WHERE project_id = ? 
        ORDER BY ${orderBy} 
        LIMIT ? OFFSET ?
      `;
      const dataResult = await this.executeQuery(dataSql, [projectId, pagination.limit, offset]);

      const data = dataResult.rows.map(row => this.mapRowToEntity(row));
      const totalPages = Math.ceil(total / pagination.limit);

      return {
        data,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages,
          hasNext: pagination.page < totalPages,
          hasPrev: pagination.page > 1
        }
      };
    } catch (error) {
      throw new Error(`Failed to find documents by project: ${error}`);
    }
  }

  /**
   * Search documents by content similarity
   */
  async searchByContent(
    embedding: number[], 
    projectId?: string, 
    limit = 20, 
    threshold = 0.3
  ): Promise<VectorSearchResult[]> {
    const filters = projectId ? { project_id: projectId } : {};
    
    return await tidbClient.vectorSearch(
      embedding,
      this.tableName,
      'content_embedding',
      'content',
      filters,
      limit,
      threshold
    );
  }

  /**
   * Hybrid search combining vector and full-text search
   */
  async hybridSearch(
    query: string,
    embedding: number[],
    projectId?: string,
    limit = 20,
    vectorWeight = 0.7,
    textWeight = 0.3
  ): Promise<VectorSearchResult[]> {
    const filters = projectId ? { project_id: projectId } : {};
    
    return await tidbClient.hybridSearch(
      query,
      embedding,
      this.tableName,
      'content_embedding',
      'content',
      vectorWeight,
      textWeight,
      filters,
      limit
    );
  }

  /**
   * Find documents by mime type
   */
  async findByMimeType(mimeType: string, projectId?: string): Promise<Document[]> {
    try {
      const whereClause = projectId 
        ? 'WHERE mime_type = ? AND project_id = ?'
        : 'WHERE mime_type = ?';
      const params = projectId ? [mimeType, projectId] : [mimeType];

      const sql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY processed_at DESC`;
      const result = await this.executeQuery(sql, params);
      
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find documents by mime type: ${error}`);
    }
  }

  /**
   * Find documents by size range
   */
  async findBySizeRange(
    minSize: number, 
    maxSize: number, 
    projectId?: string
  ): Promise<Document[]> {
    try {
      const whereClause = projectId 
        ? 'WHERE file_size BETWEEN ? AND ? AND project_id = ?'
        : 'WHERE file_size BETWEEN ? AND ?';
      const params = projectId ? [minSize, maxSize, projectId] : [minSize, maxSize];

      const sql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY file_size DESC`;
      const result = await this.executeQuery(sql, params);
      
      return result.rows.map(row => this.mapRowToEntity(row));
    } catch (error) {
      throw new Error(`Failed to find documents by size range: ${error}`);
    }
  }

  /**
   * Get document processing statistics
   */
  async getProcessingStatistics(projectId?: string): Promise<{
    totalDocuments: number;
    totalSizeBytes: number;
    averageSizeBytes: number;
    mimeTypeDistribution: Record<string, number>;
    processingByDay: Array<{ date: string; count: number; size: number }>;
    largestDocument: { id: string; filename: string; size: number } | null;
  }> {
    try {
      const whereClause = projectId ? 'WHERE project_id = ?' : '';
      const params = projectId ? [projectId] : [];

      // Basic statistics
      const basicStatsSql = `
        SELECT 
          COUNT(*) as total_documents,
          COALESCE(SUM(file_size), 0) as total_size,
          COALESCE(AVG(file_size), 0) as avg_size
        FROM ${this.tableName} 
        ${whereClause}
      `;
      
      const basicStatsResult = await this.executeQuery(basicStatsSql, params);
      const basicStats = basicStatsResult.rows[0];

      // MIME type distribution
      const mimeDistSql = `
        SELECT mime_type, COUNT(*) as count 
        FROM ${this.tableName} 
        ${whereClause}
        GROUP BY mime_type
        ORDER BY count DESC
      `;
      
      const mimeDistResult = await this.executeQuery(mimeDistSql, params);
      const mimeTypeDistribution = mimeDistResult.rows.reduce((acc, row) => {
        acc[row.mime_type] = row.count;
        return acc;
      }, {} as Record<string, number>);

      // Processing by day (last 30 days)
      const dailyStatsSql = `
        SELECT 
          DATE(processed_at) as date,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size
        FROM ${this.tableName}
        WHERE processed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ${projectId ? 'AND project_id = ?' : ''}
        GROUP BY DATE(processed_at)
        ORDER BY date DESC
      `;
      
      const dailyParams = projectId ? [...params] : [];
      const dailyStatsResult = await this.executeQuery(dailyStatsSql, dailyParams);
      const processingByDay = dailyStatsResult.rows.map(row => ({
        date: row.date,
        count: row.count,
        size: row.size
      }));

      // Largest document
      const largestSql = `
        SELECT id, filename, file_size as size
        FROM ${this.tableName}
        ${whereClause}
        ORDER BY file_size DESC
        LIMIT 1
      `;
      
      const largestResult = await this.executeQuery(largestSql, params);
      const largestDocument = largestResult.rows.length > 0 ? {
        id: largestResult.rows[0].id,
        filename: largestResult.rows[0].filename,
        size: largestResult.rows[0].size
      } : null;

      return {
        totalDocuments: basicStats.total_documents,
        totalSizeBytes: basicStats.total_size,
        averageSizeBytes: Math.round(basicStats.avg_size),
        mimeTypeDistribution,
        processingByDay,
        largestDocument
      };
    } catch (error) {
      throw new Error(`Failed to get processing statistics: ${error}`);
    }
  }

  /**
   * Create document chunks for better vector search
   */
  async createChunks(documentId: string, chunks: Omit<DocumentChunk, 'id' | 'documentId'>[]): Promise<DocumentChunk[]> {
    try {
      const createdChunks: DocumentChunk[] = [];
      
      for (const chunk of chunks) {
        const chunkId = crypto.randomUUID();
        const sql = `
          INSERT INTO document_chunks (
            id, document_id, content, content_embedding, 
            chunk_index, start_char, end_char, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await this.executeQuery(sql, [
          chunkId,
          documentId,
          chunk.content,
          this.serializeEmbedding(chunk.contentEmbedding),
          chunk.chunkIndex,
          chunk.startChar,
          chunk.endChar,
          JSON.stringify(chunk.metadata || {})
        ]);

        createdChunks.push({
          id: chunkId,
          documentId,
          ...chunk
        });
      }
      
      return createdChunks;
    } catch (error) {
      throw new Error(`Failed to create document chunks: ${error}`);
    }
  }

  /**
   * Get document chunks
   */
  async getChunks(documentId: string): Promise<DocumentChunk[]> {
    try {
      const sql = `
        SELECT * FROM document_chunks 
        WHERE document_id = ? 
        ORDER BY chunk_index ASC
      `;
      
      const result = await this.executeQuery(sql, [documentId]);
      
      return result.rows.map(row => ({
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        contentEmbedding: this.parseEmbedding(row.content_embedding),
        chunkIndex: row.chunk_index,
        startChar: row.start_char,
        endChar: row.end_char,
        metadata: this.parseJSON(row.metadata)
      }));
    } catch (error) {
      throw new Error(`Failed to get document chunks: ${error}`);
    }
  }

  /**
   * Search document chunks by vector similarity
   */
  async searchChunks(
    embedding: number[],
    projectId?: string,
    documentId?: string,
    limit = 20,
    threshold = 0.3
  ): Promise<Array<DocumentChunk & { similarity: number; document: { filename: string; id: string } }>> {
    try {
      let whereConditions = [];
      let params = [...embedding];

      if (documentId) {
        whereConditions.push('dc.document_id = ?');
        params.push(documentId);
      } else if (projectId) {
        whereConditions.push('d.project_id = ?');
        params.push(projectId);
      }

      params.push(threshold, limit);

      const whereClause = whereConditions.length > 0 
        ? `WHERE ${whereConditions.join(' AND ')}` 
        : '';

      const sql = `
        SELECT 
          dc.*,
          d.filename,
          d.id as doc_id,
          VEC_COSINE_DISTANCE(dc.content_embedding, ?) as similarity
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        ${whereClause}
        AND VEC_COSINE_DISTANCE(dc.content_embedding, ?) < ?
        ORDER BY similarity ASC
        LIMIT ?
      `;

      const result = await this.executeQuery(sql, [embedding, ...params.slice(embedding.length)]);

      return result.rows.map(row => ({
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        contentEmbedding: this.parseEmbedding(row.content_embedding),
        chunkIndex: row.chunk_index,
        startChar: row.start_char,
        endChar: row.end_char,
        metadata: this.parseJSON(row.metadata),
        similarity: parseFloat(row.similarity),
        document: {
          id: row.doc_id,
          filename: row.filename
        }
      }));
    } catch (error) {
      throw new Error(`Failed to search document chunks: ${error}`);
    }
  }

  /**
   * Delete document and all its chunks
   */
  async deleteWithChunks(id: string): Promise<void> {
    try {
      // Delete chunks first (due to foreign key constraint)
      await this.executeQuery('DELETE FROM document_chunks WHERE document_id = ?', [id]);
      
      // Delete document
      await this.delete(id);
    } catch (error) {
      throw new Error(`Failed to delete document with chunks: ${error}`);
    }
  }

  /**
   * Update document processing status
   */
  async updateProcessingStatus(
    id: string, 
    status: DocumentProcessingStatus, 
    errorMessage?: string
  ): Promise<void> {
    try {
      const fields: Record<string, any> = {
        processing_status: status,
        updated_at: new Date()
      };

      if (errorMessage) {
        fields.processing_error = errorMessage;
      }

      const setClause = Object.keys(fields).map(field => `${field} = ?`).join(', ');
      const values = [...Object.values(fields), id];

      const sql = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
      await this.executeQuery(sql, values);
    } catch (error) {
      throw new Error(`Failed to update processing status: ${error}`);
    }
  }
}