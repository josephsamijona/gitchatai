/**
 * Unit tests for validation functions
 * Tests all data model validation functions
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateMessageInput,
  validateUpdateMessageInput,
  validateCreateBranchInput,
  validateUpdateBranchInput,
  validateCreateProjectInput,
  validateUpdateProjectInput,
  validateCreateDocumentInput,
  validateCreateConceptInput,
  validateCreateConceptRelationshipInput,
  validateCreateTeamMemberInput,
  validateEmbedding,
  validateUUID,
  validateEmail,
  sanitizeContent,
  validateFileExtension
} from '../../src/lib/utils/validation';

describe('Validation Functions', () => {
  describe('Message Validation', () => {
    describe('validateCreateMessageInput', () => {
      it('should validate valid message input', () => {
        const validInput = {
          branchId: '550e8400-e29b-41d4-a716-446655440000',
          role: 'user',
          content: 'Hello world',
          model: 'claude',
          tokenCount: 10,
          processingTimeMs: 500
        };

        const result = validateCreateMessageInput(validInput);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject invalid UUID for branchId', () => {
        const invalidInput = {
          branchId: 'invalid-uuid',
          role: 'user',
          content: 'Hello world'
        };

        const result = validateCreateMessageInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('branchId: Invalid UUID format');
      });

      it('should reject invalid role', () => {
        const invalidInput = {
          branchId: '550e8400-e29b-41d4-a716-446655440000',
          role: 'invalid-role',
          content: 'Hello world'
        };

        const result = validateCreateMessageInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid enum value'))).toBe(true);
      });

      it('should reject empty content', () => {
        const invalidInput = {
          branchId: '550e8400-e29b-41d4-a716-446655440000',
          role: 'user',
          content: ''
        };

        const result = validateCreateMessageInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('content: Content cannot be empty');
      });

      it('should reject content that is too long', () => {
        const longContent = 'a'.repeat(50001);
        const invalidInput = {
          branchId: '550e8400-e29b-41d4-a716-446655440000',
          role: 'user',
          content: longContent
        };

        const result = validateCreateMessageInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('content: Content too long');
      });

      it('should reject negative token count', () => {
        const invalidInput = {
          branchId: '550e8400-e29b-41d4-a716-446655440000',
          role: 'user',
          content: 'Hello world',
          tokenCount: -5
        };

        const result = validateCreateMessageInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('tokenCount: Must be non-negative');
      });
    });

    describe('validateUpdateMessageInput', () => {
      it('should validate optional updates', () => {
        const validInput = {
          content: 'Updated content',
          tokenCount: 15
        };

        const result = validateUpdateMessageInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should validate empty update object', () => {
        const result = validateUpdateMessageInput({});
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('Branch Validation', () => {
    describe('validateCreateBranchInput', () => {
      it('should validate valid branch input', () => {
        const validInput = {
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Main Branch',
          model: 'claude',
          contextSummary: 'Initial conversation context'
        };

        const result = validateCreateBranchInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should validate with parent branch', () => {
        const validInput = {
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
          parentBranchId: '660f9500-f30c-52e5-b827-557766551111',
          name: 'Child Branch',
          model: 'gpt4'
        };

        const result = validateCreateBranchInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid model', () => {
        const invalidInput = {
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Branch',
          model: 'invalid-model'
        };

        const result = validateCreateBranchInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid enum value'))).toBe(true);
      });

      it('should reject empty name', () => {
        const invalidInput = {
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
          name: '',
          model: 'claude'
        };

        const result = validateCreateBranchInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('name: Branch name cannot be empty');
      });
    });
  });

  describe('Project Validation', () => {
    describe('validateCreateProjectInput', () => {
      it('should validate valid project input', () => {
        const validInput = {
          name: 'My Project',
          description: 'A test project',
          customInstructions: 'Be helpful and concise'
        };

        const result = validateCreateProjectInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should validate minimal project input', () => {
        const validInput = {
          name: 'Minimal Project'
        };

        const result = validateCreateProjectInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject empty name', () => {
        const invalidInput = {
          name: ''
        };

        const result = validateCreateProjectInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('name: Project name cannot be empty');
      });

      it('should reject too long description', () => {
        const longDescription = 'a'.repeat(2001);
        const invalidInput = {
          name: 'Test Project',
          description: longDescription
        };

        const result = validateCreateProjectInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('description: Description too long');
      });
    });
  });

  describe('Document Validation', () => {
    describe('validateCreateDocumentInput', () => {
      it('should validate valid document input', () => {
        const validInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          filename: 'test.pdf',
          content: 'Document content here',
          fileSize: 1024,
          mimeType: 'application/pdf'
        };

        const result = validateCreateDocumentInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should validate with metadata', () => {
        const validInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          filename: 'document.docx',
          content: 'Document content',
          metadata: { author: 'John Doe', version: 1 },
          fileSize: 2048,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };

        const result = validateCreateDocumentInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid mime type', () => {
        const invalidInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          filename: 'test.exe',
          content: 'Some content',
          fileSize: 1024,
          mimeType: 'application/x-executable'
        };

        const result = validateCreateDocumentInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid enum value'))).toBe(true);
      });

      it('should reject zero or negative file size', () => {
        const invalidInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          filename: 'test.pdf',
          content: 'Document content',
          fileSize: 0,
          mimeType: 'application/pdf'
        };

        const result = validateCreateDocumentInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('fileSize: Must be a positive integer');
      });
    });
  });

  describe('Concept Validation', () => {
    describe('validateCreateConceptInput', () => {
      it('should validate valid concept input', () => {
        const validInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Machine Learning',
          description: 'A subset of artificial intelligence',
          confidenceScore: 0.8
        };

        const result = validateCreateConceptInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid confidence score', () => {
        const invalidInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Concept',
          confidenceScore: 1.5
        };

        const result = validateCreateConceptInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('confidenceScore: Confidence score must be between 0 and 1');
      });
    });

    describe('validateCreateConceptRelationshipInput', () => {
      it('should validate valid relationship input', () => {
        const validInput = {
          sourceConceptId: '550e8400-e29b-41d4-a716-446655440000',
          targetConceptId: '660f9500-f30c-52e5-b827-557766551111',
          relationshipType: 'related',
          strength: 0.7
        };

        const result = validateCreateConceptRelationshipInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject same source and target concept', () => {
        const invalidInput = {
          sourceConceptId: '550e8400-e29b-41d4-a716-446655440000',
          targetConceptId: '550e8400-e29b-41d4-a716-446655440000',
          relationshipType: 'related'
        };

        const result = validateCreateConceptRelationshipInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('targetConceptId: Source and target concepts cannot be the same');
      });

      it('should reject invalid relationship type', () => {
        const invalidInput = {
          sourceConceptId: '550e8400-e29b-41d4-a716-446655440000',
          targetConceptId: '660f9500-f30c-52e5-b827-557766551111',
          relationshipType: 'invalid-type'
        };

        const result = validateCreateConceptRelationshipInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid enum value'))).toBe(true);
      });
    });
  });

  describe('Team Member Validation', () => {
    describe('validateCreateTeamMemberInput', () => {
      it('should validate valid team member input', () => {
        const validInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          email: 'user@example.com',
          role: 'editor',
          permissions: {
            canCreateBranches: true,
            canUploadDocuments: true,
            canInviteMembers: false,
            canModifyProject: false,
            canDeleteContent: false
          }
        };

        const result = validateCreateTeamMemberInput(validInput);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid email', () => {
        const invalidInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          email: 'invalid-email',
          role: 'viewer'
        };

        const result = validateCreateTeamMemberInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('email: Invalid email format');
      });

      it('should reject invalid role', () => {
        const invalidInput = {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          email: 'user@example.com',
          role: 'invalid-role'
        };

        const result = validateCreateTeamMemberInput(invalidInput);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(error => error.includes('Invalid enum value'))).toBe(true);
      });
    });
  });

  describe('Utility Validations', () => {
    describe('validateEmbedding', () => {
      it('should validate correct embedding vector', () => {
        const embedding = new Array(1536).fill(0.1);
        const result = validateEmbedding(embedding);
        expect(result.isValid).toBe(true);
      });

      it('should reject wrong dimension embedding', () => {
        const embedding = new Array(512).fill(0.1);
        const result = validateEmbedding(embedding);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Embedding must be exactly 1536 dimensions');
      });

      it('should reject non-array embedding', () => {
        const result = validateEmbedding('not-an-array');
        expect(result.isValid).toBe(false);
      });
    });

    describe('validateUUID', () => {
      it('should validate correct UUID', () => {
        const result = validateUUID('550e8400-e29b-41d4-a716-446655440000');
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid UUID', () => {
        const result = validateUUID('invalid-uuid');
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid UUID format');
      });
    });

    describe('validateEmail', () => {
      it('should validate correct email', () => {
        const result = validateEmail('user@example.com');
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid email', () => {
        const result = validateEmail('invalid-email');
        expect(result.isValid).toBe(false);
      });
    });

    describe('sanitizeContent', () => {
      it('should remove script tags', () => {
        const maliciousContent = 'Hello <script>alert("xss")</script> world';
        const sanitized = sanitizeContent(maliciousContent);
        expect(sanitized).toBe('Hello  world');
      });

      it('should remove javascript: protocols', () => {
        const maliciousContent = 'Click <a href="javascript:alert()">here</a>';
        const sanitized = sanitizeContent(maliciousContent);
        expect(sanitized).not.toContain('javascript:');
      });

      it('should remove on* event handlers', () => {
        const maliciousContent = '<div onclick="alert()">Click me</div>';
        const sanitized = sanitizeContent(maliciousContent);
        expect(sanitized).not.toContain('onclick');
      });

      it('should preserve safe content', () => {
        const safeContent = 'This is <strong>safe</strong> content';
        const sanitized = sanitizeContent(safeContent);
        expect(sanitized).toContain('<strong>safe</strong>');
      });
    });

    describe('validateFileExtension', () => {
      it('should validate allowed extension', () => {
        const result = validateFileExtension('document.pdf', ['pdf', 'docx', 'txt']);
        expect(result.isValid).toBe(true);
      });

      it('should reject disallowed extension', () => {
        const result = validateFileExtension('malware.exe', ['pdf', 'docx', 'txt']);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('File extension .exe is not allowed. Allowed: pdf, docx, txt');
      });

      it('should reject file without extension', () => {
        const result = validateFileExtension('README', ['pdf', 'docx', 'txt']);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('File has no extension');
      });

      it('should handle case insensitive extensions', () => {
        const result = validateFileExtension('Document.PDF', ['pdf', 'docx', 'txt']);
        expect(result.isValid).toBe(true);
      });
    });
  });
});