/**
 * Data validation functions for SYNAPSE platform
 * Comprehensive validation for all data models with detailed error reporting
 */

import { z } from 'zod';
import type {
  ValidationResult,
  AIModel,
  MessageRole,
  TeamRole,
  ConceptRelationshipType,
  DocumentMimeType
} from '../../types';

// Common validation schemas
const uuidSchema = z.string().uuid('Invalid UUID format');
const embeddingSchema = z.array(z.number()).length(1536, 'Embedding must be exactly 1536 dimensions');
const positiveIntSchema = z.number().int().positive('Must be a positive integer');
const nonNegativeIntSchema = z.number().int().min(0, 'Must be non-negative');
const confidenceScoreSchema = z.number().min(0).max(1, 'Confidence score must be between 0 and 1');
const strengthSchema = z.number().min(0).max(1, 'Strength must be between 0 and 1');

// Enum schemas
const aiModelSchema = z.enum(['claude', 'gpt4', 'kimi', 'grok'] as const);
const messageRoleSchema = z.enum(['user', 'assistant'] as const);
const teamRoleSchema = z.enum(['owner', 'editor', 'viewer'] as const);
const relationshipTypeSchema = z.enum(['related', 'parent', 'child', 'similar', 'opposite', 'causes', 'enables'] as const);

/**
 * Validation helper function
 */
function validateWithSchema<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult {
  try {
    schema.parse(data);
    return {
      isValid: true,
      errors: [],
      warnings: []
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
        warnings: []
      };
    }
    return {
      isValid: false,
      errors: ['Unknown validation error'],
      warnings: []
    };
  }
}

/**
 * Message validation functions
 */
export function validateCreateMessageInput(data: unknown): ValidationResult {
  const schema = z.object({
    branchId: uuidSchema,
    role: messageRoleSchema,
    content: z.string().min(1, 'Content cannot be empty').max(50000, 'Content too long'),
    model: z.string().optional(),
    tokenCount: nonNegativeIntSchema.optional(),
    processingTimeMs: nonNegativeIntSchema.optional()
  });
  
  return validateWithSchema(schema, data);
}

export function validateUpdateMessageInput(data: unknown): ValidationResult {
  const schema = z.object({
    content: z.string().min(1, 'Content cannot be empty').max(50000, 'Content too long').optional(),
    tokenCount: nonNegativeIntSchema.optional(),
    processingTimeMs: nonNegativeIntSchema.optional()
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Branch validation functions
 */
export function validateCreateBranchInput(data: unknown): ValidationResult {
  const schema = z.object({
    conversationId: uuidSchema,
    parentBranchId: uuidSchema.optional(),
    name: z.string().min(1, 'Branch name cannot be empty').max(255, 'Branch name too long'),
    model: aiModelSchema,
    contextSummary: z.string().max(5000, 'Context summary too long').optional(),
    fromMessageId: uuidSchema.optional()
  });
  
  return validateWithSchema(schema, data);
}

export function validateUpdateBranchInput(data: unknown): ValidationResult {
  const schema = z.object({
    name: z.string().min(1, 'Branch name cannot be empty').max(255, 'Branch name too long').optional(),
    model: aiModelSchema.optional(),
    contextSummary: z.string().max(5000, 'Context summary too long').optional()
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Project validation functions
 */
export function validateCreateProjectInput(data: unknown): ValidationResult {
  const schema = z.object({
    name: z.string().min(1, 'Project name cannot be empty').max(255, 'Project name too long'),
    description: z.string().max(2000, 'Description too long').optional(),
    customInstructions: z.string().max(10000, 'Custom instructions too long').optional()
  });
  
  return validateWithSchema(schema, data);
}

export function validateUpdateProjectInput(data: unknown): ValidationResult {
  const schema = z.object({
    name: z.string().min(1, 'Project name cannot be empty').max(255, 'Project name too long').optional(),
    description: z.string().max(2000, 'Description too long').optional(),
    customInstructions: z.string().max(10000, 'Custom instructions too long').optional()
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Document validation functions
 */
export function validateCreateDocumentInput(data: unknown): ValidationResult {
  const documentMimeTypeSchema = z.enum([
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ] as const);

  const schema = z.object({
    projectId: uuidSchema,
    filename: z.string().min(1, 'Filename cannot be empty').max(255, 'Filename too long'),
    content: z.string().min(1, 'Document content cannot be empty'),
    metadata: z.record(z.any()).optional(),
    s3Key: z.string().max(500, 'S3 key too long').optional(),
    fileSize: positiveIntSchema,
    mimeType: documentMimeTypeSchema
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Concept validation functions
 */
export function validateCreateConceptInput(data: unknown): ValidationResult {
  const schema = z.object({
    projectId: uuidSchema,
    name: z.string().min(1, 'Concept name cannot be empty').max(255, 'Concept name too long'),
    description: z.string().max(2000, 'Description too long').optional(),
    confidenceScore: confidenceScoreSchema.optional()
  });
  
  return validateWithSchema(schema, data);
}

export function validateCreateConceptRelationshipInput(data: unknown): ValidationResult {
  const schema = z.object({
    sourceConceptId: uuidSchema,
    targetConceptId: uuidSchema,
    relationshipType: relationshipTypeSchema,
    strength: strengthSchema.optional()
  }).refine(data => data.sourceConceptId !== data.targetConceptId, {
    message: 'Source and target concepts cannot be the same',
    path: ['targetConceptId']
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Team member validation functions
 */
export function validateCreateTeamMemberInput(data: unknown): ValidationResult {
  const schema = z.object({
    projectId: uuidSchema,
    email: z.string().email('Invalid email format'),
    role: teamRoleSchema,
    permissions: z.object({
      canCreateBranches: z.boolean(),
      canUploadDocuments: z.boolean(),
      canInviteMembers: z.boolean(),
      canModifyProject: z.boolean(),
      canDeleteContent: z.boolean()
    }).optional()
  });
  
  return validateWithSchema(schema, data);
}

/**
 * Utility validation functions
 */
export function validateEmbedding(embedding: unknown): ValidationResult {
  return validateWithSchema(embeddingSchema, embedding);
}

export function validateUUID(uuid: unknown): ValidationResult {
  return validateWithSchema(uuidSchema, uuid);
}

export function validateEmail(email: unknown): ValidationResult {
  return validateWithSchema(z.string().email(), email);
}

/**
 * Content sanitization
 */
export function sanitizeContent(content: string): string {
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/**
 * File extension validation
 */
export function validateFileExtension(filename: string, allowedExtensions: string[]): ValidationResult {
  const extension = filename.toLowerCase().split('.').pop();
  
  if (!extension) {
    return {
      isValid: false,
      errors: ['File has no extension'],
      warnings: []
    };
  }
  
  if (!allowedExtensions.includes(extension)) {
    return {
      isValid: false,
      errors: [`File extension .${extension} is not allowed. Allowed: ${allowedExtensions.join(', ')}`],
      warnings: []
    };
  }
  
  return {
    isValid: true,
    errors: [],
    warnings: []
  };
}