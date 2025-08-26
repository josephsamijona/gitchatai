/**
 * Document Processing Service - Complete pipeline with real-time status
 * Handles file upload → text extraction → chunking → embedding → TiDB storage
 */

import { tidbClient } from '../tidb/client';
import { embeddings } from '../ai/embeddings';
import { workspaceService } from './workspace';
// Real-time collaboration - lazy import to avoid circular dependencies
let realtimeCollaborationService: any = null;
const getRealtimeService = async () => {
  if (!realtimeCollaborationService) {
    const { realtimeCollaborationService: service } = await import('./realtime-collaboration');
    realtimeCollaborationService = service;
  }
  return realtimeCollaborationService;
};
import type {
  Document,
  CreateDocumentInput,
  DocumentProcessingStatus,
  DocumentChunk,
  DocumentMimeType
} from '../../types';

export class DocumentProcessingService {
  private processingQueue = new Map<string, DocumentProcessingStatus>();
  private readonly CHUNK_SIZE = 1000;
  private readonly CHUNK_OVERLAP = 200;

  /**
   * Process uploaded document through complete pipeline
   */
  async processDocument(
    file: File,
    projectId: string,
    userId: string,
    options: {
      chunkSize?: number;
      chunkOverlap?: number;
      extractConcepts?: boolean;
      enableOCR?: boolean;
    } = {}
  ): Promise<string> {
    const documentId = this.generateId();
    const {
      chunkSize = this.CHUNK_SIZE,
      chunkOverlap = this.CHUNK_OVERLAP,
      extractConcepts = true,
      enableOCR = false
    } = options;

    try {
      // Initialize processing status
      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'uploading',
        progress: 0,
        currentStep: 'Uploading file to storage',
        estimatedTimeRemaining: 120
      });

      // Step 1: Upload to S3 and get URL
      const s3Key = await this.uploadToS3(file, projectId, documentId);
      
      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'extracting',
        progress: 20,
        currentStep: 'Extracting text content',
        estimatedTimeRemaining: 90
      });

      // Step 2: Extract text content
      const textContent = await this.extractTextContent(file, enableOCR);

      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'chunking',
        progress: 40,
        currentStep: 'Creating semantic chunks',
        estimatedTimeRemaining: 60
      });

      // Step 3: Create semantic chunks
      const chunks = await this.createSemanticChunks(
        textContent,
        documentId,
        chunkSize,
        chunkOverlap
      );

      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'embedding',
        progress: 60,
        currentStep: 'Generating vector embeddings',
        estimatedTimeRemaining: 45
      });

      // Step 4: Generate embeddings
      const documentEmbedding = await embeddings.generateEmbedding(textContent.substring(0, 8000));
      
      // Generate embeddings for chunks in batches
      const chunkEmbeddings = await this.generateChunkEmbeddings(chunks);

      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'indexing',
        progress: 80,
        currentStep: 'Storing in database with indexes',
        estimatedTimeRemaining: 20
      });

      // Step 5: Store document in TiDB
      const document = await this.storeDocument({
        projectId,
        filename: file.name,
        content: textContent,
        metadata: {
          fileSize: file.size,
          mimeType: file.type,
          chunksCount: chunks.length,
          uploadedBy: userId,
          processingOptions: { chunkSize, chunkOverlap, extractConcepts, enableOCR }
        },
        s3Key,
        fileSize: file.size,
        mimeType: file.type as DocumentMimeType
      }, documentEmbedding);

      // Step 6: Store chunks with embeddings
      await this.storeDocumentChunks(chunks, chunkEmbeddings);

      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'completed',
        progress: 100,
        currentStep: 'Processing completed successfully',
        estimatedTimeRemaining: 0
      });

      // Step 7: Extract concepts if enabled
      if (extractConcepts) {
        // Run concept extraction in background
        this.extractConcepts(document.id, textContent, projectId, userId)
          .catch(error => {
            console.error('Concept extraction failed:', error);
          });
      }

      // Log activity
      await workspaceService.logActivity(
        projectId,
        userId,
        'document_uploaded',
        {
          documentId: document.id,
          filename: file.name,
          fileSize: file.size,
          chunksGenerated: chunks.length
        }
      );

      return document.id;

    } catch (error) {
      console.error('Document processing failed:', error);
      
      this.updateProcessingStatus(documentId, {
        documentId,
        status: 'failed',
        progress: 0,
        currentStep: 'Processing failed',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });

      throw new Error('Document processing failed');
    }
  }

  /**
   * Get document processing status
   */
  getProcessingStatus(documentId: string): DocumentProcessingStatus | null {
    return this.processingQueue.get(documentId) || null;
  }

  /**
   * Get all processing statuses for a project
   */
  getProjectProcessingStatuses(projectId: string): DocumentProcessingStatus[] {
    // In a real implementation, this would query the database
    // For now, return from memory queue
    return Array.from(this.processingQueue.values());
  }

  /**
   * Update processing status and notify subscribers
   */
  private updateProcessingStatus(documentId: string, status: DocumentProcessingStatus): void {
    this.processingQueue.set(documentId, status);
    
    // Trigger real-time collaboration notifications (non-blocking)
    this.notifyStatusUpdate(documentId, status).catch(error => {
      console.error('Failed to notify status update:', error);
    });
  }

  /**
   * Upload file to S3 storage
   */
  private async uploadToS3(file: File, projectId: string, documentId: string): Promise<string> {
    // Simulate S3 upload with delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const s3Key = `projects/${projectId}/documents/${documentId}/${file.name}`;
    
    // In a real implementation, this would:
    // 1. Create presigned URL for S3 upload
    // 2. Upload file to S3
    // 3. Return S3 object key
    
    console.log(`Simulated upload to S3: ${s3Key}`);
    return s3Key;
  }

  /**
   * Extract text content from file
   */
  private async extractTextContent(file: File, enableOCR: boolean = false): Promise<string> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (file.type === 'text/plain' || file.type === 'text/markdown') {
      return await this.readTextFile(file);
    }

    if (file.type === 'application/pdf') {
      return await this.extractPDFText(file, enableOCR);
    }

    if (file.type.startsWith('application/vnd.openxmlformats-officedocument')) {
      return await this.extractOfficeText(file);
    }

    // For other file types, try to read as text
    return await this.readTextFile(file);
  }

  /**
   * Read plain text file
   */
  private async readTextFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target?.result as string || '');
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  /**
   * Extract text from PDF (placeholder implementation)
   */
  private async extractPDFText(file: File, enableOCR: boolean): Promise<string> {
    // This would use a PDF parsing library like pdf-parse or pdf2pic + OCR
    // For now, return placeholder text
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return `[PDF Content Extracted from ${file.name}]
    
    This is a placeholder for PDF text extraction. 
    In a production implementation, this would use libraries like:
    - pdf-parse for text extraction
    - pdf2pic + tesseract for OCR if enableOCR is true
    
    File: ${file.name}
    Size: ${file.size} bytes
    OCR Enabled: ${enableOCR}
    
    The extracted text would contain the actual document content...`;
  }

  /**
   * Extract text from Office documents (placeholder implementation)
   */
  private async extractOfficeText(file: File): Promise<string> {
    // This would use libraries like mammoth (for .docx) or node-xlsx (for .xlsx)
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    return `[Office Document Content Extracted from ${file.name}]
    
    This is a placeholder for Office document text extraction.
    Production implementation would use libraries like:
    - mammoth for .docx files
    - node-xlsx for .xlsx files
    - Other Office format parsers
    
    The extracted text would contain the actual document content...`;
  }

  /**
   * Create semantic chunks from text content
   */
  private async createSemanticChunks(
    text: string,
    documentId: string,
    chunkSize: number,
    overlap: number
  ): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const sentences = this.splitIntoSentences(text);
    
    let currentChunk = '';
    let currentPosition = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        // Create chunk
        chunks.push({
          id: this.generateId(),
          documentId,
          content: currentChunk.trim(),
          contentEmbedding: [], // Will be filled later
          chunkIndex: chunkIndex++,
          startPosition: currentPosition - currentChunk.length,
          endPosition: currentPosition,
          metadata: {
            sentenceCount: currentChunk.split('.').length - 1,
            wordCount: currentChunk.split(/\s+/).length
          }
        });

        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, overlap);
        currentChunk = overlapText + sentence;
        currentPosition += sentence.length;
      } else {
        currentChunk += sentence;
        currentPosition += sentence.length;
      }
    }

    // Add final chunk if not empty
    if (currentChunk.trim()) {
      chunks.push({
        id: this.generateId(),
        documentId,
        content: currentChunk.trim(),
        contentEmbedding: [],
        chunkIndex: chunkIndex,
        startPosition: currentPosition - currentChunk.length,
        endPosition: currentPosition,
        metadata: {
          sentenceCount: currentChunk.split('.').length - 1,
          wordCount: currentChunk.split(/\s+/).length
        }
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - in production, use a proper NLP library
    return text.split(/[.!?]+\s+/).filter(s => s.trim().length > 0);
  }

  /**
   * Get overlap text from end of chunk
   */
  private getOverlapText(chunk: string, overlapSize: number): string {
    if (chunk.length <= overlapSize) return chunk + ' ';
    
    const overlap = chunk.slice(-overlapSize);
    const lastSpaceIndex = overlap.lastIndexOf(' ');
    
    return lastSpaceIndex > 0 ? overlap.slice(lastSpaceIndex + 1) + ' ' : '';
  }

  /**
   * Generate embeddings for chunks in batches
   */
  private async generateChunkEmbeddings(chunks: DocumentChunk[]): Promise<number[][]> {
    const batchSize = 10;
    const embeddings_array: number[][] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(chunk => chunk.content);
      
      const batchEmbeddings = await embeddings.generateBatchEmbeddings(texts);
      embeddings_array.push(...batchEmbeddings);
    }

    return embeddings_array;
  }

  /**
   * Store document in TiDB
   */
  private async storeDocument(
    input: CreateDocumentInput,
    documentEmbedding: number[]
  ): Promise<Document> {
    const query = `
      INSERT INTO documents (
        id, project_id, filename, content, content_embedding, 
        metadata, s3_key, file_size, mime_type, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const documentId = this.generateId();

    await tidbClient.executeQuery(query, [
      documentId,
      input.projectId,
      input.filename,
      input.content,
      JSON.stringify(documentEmbedding),
      JSON.stringify(input.metadata),
      input.s3Key,
      input.fileSize,
      input.mimeType
    ]);

    return {
      id: documentId,
      projectId: input.projectId,
      filename: input.filename,
      content: input.content,
      contentEmbedding: documentEmbedding,
      metadata: input.metadata || {},
      s3Key: input.s3Key,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      processedAt: new Date()
    };
  }

  /**
   * Store document chunks with embeddings
   */
  private async storeDocumentChunks(
    chunks: DocumentChunk[],
    chunkEmbeddings: number[][]
  ): Promise<void> {
    const query = `
      INSERT INTO document_chunks (
        id, document_id, content, content_embedding, chunk_index,
        start_position, end_position, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = chunkEmbeddings[i];

      await tidbClient.executeQuery(query, [
        chunk.id,
        chunk.documentId,
        chunk.content,
        JSON.stringify(embedding),
        chunk.chunkIndex,
        chunk.startPosition,
        chunk.endPosition,
        JSON.stringify(chunk.metadata)
      ]);
    }
  }

  /**
   * Extract concepts from document content (background process)
   */
  private async extractConcepts(
    documentId: string,
    content: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    try {
      // This would use an LLM to extract concepts from the document
      // For now, simulate the process
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Simulate concept extraction
      const concepts = [
        { name: 'Key Concept 1', description: 'Important concept from document' },
        { name: 'Key Concept 2', description: 'Another significant concept' },
        { name: 'Key Concept 3', description: 'Third extracted concept' }
      ];

      // In production, this would:
      // 1. Send content to LLM for concept extraction
      // 2. Generate embeddings for extracted concepts
      // 3. Store concepts in TiDB
      // 4. Create relationships between concepts
      // 5. Update knowledge graph

      console.log(`Extracted ${concepts.length} concepts from document ${documentId}`);

      // Log concept extraction activity
      await workspaceService.logActivity(
        projectId,
        userId,
        'concepts_extracted',
        {
          documentId,
          conceptsCount: concepts.length,
          concepts: concepts.map(c => c.name)
        }
      );

    } catch (error) {
      console.error('Concept extraction failed:', error);
    }
  }

  /**
   * Notify clients about status updates via WebSocket
   */
  private async notifyStatusUpdate(documentId: string, status: DocumentProcessingStatus): Promise<void> {
    console.log(`Status update for document ${documentId}:`, status);
    
    // Integrate with real-time collaboration service
    try {
      const rtService = await getRealtimeService();
      const document = { 
        id: documentId, 
        filename: status.filename,
        uploadedBy: status.userId
      } as any; // Mock document object
      
      await rtService.onDocumentProcessed(
        status.projectId,
        document,
        status.status,
        Math.round(status.progress * 100)
      );
    } catch (error) {
      console.error('Failed to send real-time document processing notification:', error);
      // Don't fail the processing if real-time notification fails
    }
  }

  /**
   * Search within document chunks
   */
  async searchDocumentChunks(
    query: string,
    projectId?: string,
    documentId?: string,
    limit: number = 10
  ): Promise<{
    chunks: (DocumentChunk & { relevanceScore: number; documentName: string })[];
    totalResults: number;
  }> {
    try {
      const queryEmbedding = await embeddings.generateEmbedding(query);

      let searchQuery = `
        SELECT 
          dc.*,
          d.filename as document_name,
          VEC_COSINE_DISTANCE(dc.content_embedding, ?) as relevance_score
        FROM document_chunks dc
        JOIN documents d ON dc.document_id = d.id
        WHERE 1=1
      `;

      const params: any[] = [queryEmbedding];

      if (projectId) {
        searchQuery += ` AND d.project_id = ?`;
        params.push(projectId);
      }

      if (documentId) {
        searchQuery += ` AND dc.document_id = ?`;
        params.push(documentId);
      }

      searchQuery += `
        AND (
          MATCH(dc.content) AGAINST(? IN NATURAL LANGUAGE MODE)
          OR VEC_COSINE_DISTANCE(dc.content_embedding, ?) < 0.3
        )
        ORDER BY relevance_score ASC
        LIMIT ?
      `;

      params.push(query, queryEmbedding, limit);

      const result = await tidbClient.executeQuery(searchQuery, params);

      const chunks = result.rows.map(row => ({
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        contentEmbedding: JSON.parse(row.content_embedding),
        chunkIndex: row.chunk_index,
        startPosition: row.start_position,
        endPosition: row.end_position,
        metadata: JSON.parse(row.metadata || '{}'),
        relevanceScore: row.relevance_score,
        documentName: row.document_name
      }));

      return {
        chunks,
        totalResults: chunks.length
      };

    } catch (error) {
      console.error('Failed to search document chunks:', error);
      throw new Error('Failed to search document chunks');
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// Export singleton instance
export const documentProcessingService = new DocumentProcessingService();