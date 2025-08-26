/**
 * Project Wizard Service - Guided project creation and onboarding
 * Handles step-by-step project setup with templates and smart configuration
 */

import { workspaceService } from './workspace';
import { embeddings } from '../ai/embeddings';
import { tidbClient } from '../tidb/client';
import type {
  ProjectTemplate,
  WorkspaceWizardState,
  WorkspaceSettings,
  CreateProjectInput
} from '../../types';

export class ProjectWizardService {
  
  /**
   * Get available project templates
   */
  async getProjectTemplates(): Promise<ProjectTemplate[]> {
    return [
      {
        id: 'research',
        name: 'Academic Research',
        description: 'Perfect for academic research projects with literature review, hypothesis testing, and collaborative writing.',
        category: 'research',
        icon: '🔬',
        customInstructions: `You are an AI research assistant specializing in academic research. Help with:
- Literature review and source analysis
- Hypothesis formulation and testing
- Data analysis and interpretation
- Academic writing and citation formatting
- Collaborative research coordination

Always provide well-sourced, academically rigorous responses with proper citations.`,
        defaultSettings: {
          aiModelPreferences: {
            defaultModel: 'claude',
            allowModelSwitching: true,
            preferredModels: ['claude', 'gpt4'],
            customPrompts: {
              literature_review: 'Analyze this research paper and extract key findings, methodology, and relevance to the research question.',
              citation_format: 'Format these sources according to APA/MLA style guidelines.'
            }
          },
          documentProcessingSettings: {
            autoExtractConcepts: true,
            chunkSize: 1500,
            chunkOverlap: 300,
            enableOCR: true
          }
        },
        suggestedDocuments: [
          {
            name: 'Literature Review Papers',
            description: 'Academic papers and articles relevant to your research topic',
            required: true,
            category: 'research'
          },
          {
            name: 'Research Proposal',
            description: 'Your initial research proposal or grant application',
            required: false,
            category: 'planning'
          },
          {
            name: 'Data Collection Templates',
            description: 'Surveys, interview guides, or experimental protocols',
            required: false,
            category: 'methodology'
          }
        ],
        initialConcepts: [
          { name: 'Research Question', description: 'Main research question or hypothesis', category: 'core' },
          { name: 'Methodology', description: 'Research methods and approaches', category: 'process' },
          { name: 'Literature Review', description: 'Key papers and theoretical framework', category: 'knowledge' }
        ],
        teamRoleTemplates: [
          {
            role: 'owner',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: true,
              canDeleteContent: true
            },
            description: 'Principal Investigator - Full project control',
            isDefault: true
          },
          {
            role: 'editor',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: false,
              canModifyProject: false,
              canDeleteContent: false
            },
            description: 'Research Assistant - Can contribute content and analysis',
            isDefault: false
          }
        ],
        workflowSteps: [
          {
            step: 'setup',
            title: 'Project Setup',
            description: 'Define research question and upload initial literature',
            optional: false,
            estimatedTime: '30 minutes'
          },
          {
            step: 'literature',
            title: 'Literature Review',
            description: 'Upload and analyze relevant academic papers',
            optional: false,
            estimatedTime: '2-3 hours'
          },
          {
            step: 'methodology',
            title: 'Methodology Planning',
            description: 'Design research methodology and data collection approach',
            optional: false,
            estimatedTime: '1 hour'
          }
        ]
      },
      {
        id: 'education',
        name: 'Educational Learning',
        description: 'Designed for students and educators to explore topics with multi-perspective analysis.',
        category: 'education',
        icon: '📚',
        customInstructions: `You are an educational AI assistant focused on learning and teaching. Help with:
- Breaking down complex topics into understandable concepts
- Providing multiple perspectives on subjects
- Creating study materials and summaries
- Facilitating discussion and critical thinking
- Connecting concepts across disciplines

Use clear, engaging explanations suitable for the student's level.`,
        defaultSettings: {
          aiModelPreferences: {
            defaultModel: 'gpt4',
            allowModelSwitching: true,
            preferredModels: ['gpt4', 'claude', 'kimi']
          },
          collaborationSettings: {
            enableRealTimeUpdates: true,
            enableActivityNotifications: true,
            shareKnowledgeGraphs: true,
            allowGuestAccess: true,
            activityRetention: 90
          }
        },
        suggestedDocuments: [
          {
            name: 'Textbooks and Course Materials',
            description: 'Primary learning resources for the subject',
            required: true,
            category: 'learning'
          },
          {
            name: 'Lecture Notes',
            description: 'Class notes and supplementary materials',
            required: false,
            category: 'notes'
          },
          {
            name: 'Assignment Guidelines',
            description: 'Project requirements and rubrics',
            required: false,
            category: 'assignments'
          }
        ],
        initialConcepts: [
          { name: 'Learning Objectives', description: 'What you want to learn or achieve', category: 'goals' },
          { name: 'Key Topics', description: 'Main subjects and themes to explore', category: 'content' },
          { name: 'Study Methods', description: 'Learning strategies and techniques', category: 'process' }
        ],
        teamRoleTemplates: [
          {
            role: 'owner',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: true,
              canDeleteContent: true
            },
            description: 'Instructor/Study Group Leader',
            isDefault: true
          },
          {
            role: 'editor',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: false,
              canDeleteContent: false
            },
            description: 'Student/Collaborator - Can contribute and discuss',
            isDefault: false
          },
          {
            role: 'viewer',
            permissions: {
              canCreateBranches: false,
              canUploadDocuments: false,
              canInviteMembers: false,
              canModifyProject: false,
              canDeleteContent: false
            },
            description: 'Observer - Read-only access',
            isDefault: false
          }
        ],
        workflowSteps: [
          {
            step: 'setup',
            title: 'Learning Setup',
            description: 'Define learning goals and upload course materials',
            optional: false,
            estimatedTime: '20 minutes'
          },
          {
            step: 'exploration',
            title: 'Topic Exploration',
            description: 'Start conversations to explore key concepts',
            optional: false,
            estimatedTime: '1 hour'
          },
          {
            step: 'collaboration',
            title: 'Team Collaboration',
            description: 'Invite study partners and share insights',
            optional: true,
            estimatedTime: '15 minutes'
          }
        ]
      },
      {
        id: 'business',
        name: 'Business Strategy',
        description: 'Strategic business planning with market analysis, competitive intelligence, and decision support.',
        category: 'business',
        icon: '💼',
        customInstructions: `You are a business strategy AI assistant. Help with:
- Market analysis and competitive intelligence
- Business model development and validation
- Strategic planning and decision making
- Financial analysis and projections
- Risk assessment and mitigation strategies

Provide data-driven insights with actionable recommendations.`,
        defaultSettings: {
          aiModelPreferences: {
            defaultModel: 'gpt4',
            allowModelSwitching: true,
            preferredModels: ['gpt4', 'claude']
          },
          privacySettings: {
            encryptDocuments: true,
            retentionPeriod: 1095, // 3 years
            anonymizeExports: true
          }
        },
        suggestedDocuments: [
          {
            name: 'Market Research Reports',
            description: 'Industry analysis and market data',
            required: true,
            category: 'research'
          },
          {
            name: 'Business Plan',
            description: 'Current business plan or strategy documents',
            required: false,
            category: 'strategy'
          },
          {
            name: 'Financial Data',
            description: 'Financial statements and projections',
            required: false,
            category: 'finance'
          }
        ],
        initialConcepts: [
          { name: 'Business Model', description: 'How the business creates and captures value', category: 'core' },
          { name: 'Target Market', description: 'Customer segments and market positioning', category: 'market' },
          { name: 'Competitive Advantage', description: 'Unique value proposition and differentiation', category: 'strategy' }
        ],
        teamRoleTemplates: [
          {
            role: 'owner',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: true,
              canDeleteContent: true
            },
            description: 'CEO/Strategy Lead',
            isDefault: true
          },
          {
            role: 'editor',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: false,
              canModifyProject: false,
              canDeleteContent: false
            },
            description: 'Strategy Team Member',
            isDefault: false
          }
        ],
        workflowSteps: [
          {
            step: 'analysis',
            title: 'Market Analysis',
            description: 'Upload market research and competitive data',
            optional: false,
            estimatedTime: '45 minutes'
          },
          {
            step: 'strategy',
            title: 'Strategy Development',
            description: 'Develop and refine business strategy',
            optional: false,
            estimatedTime: '2 hours'
          },
          {
            step: 'validation',
            title: 'Strategy Validation',
            description: 'Test assumptions and validate strategic decisions',
            optional: false,
            estimatedTime: '1 hour'
          }
        ]
      },
      {
        id: 'creative',
        name: 'Creative Project',
        description: 'Creative writing, content creation, and artistic projects with AI collaboration.',
        category: 'creative',
        icon: '🎨',
        customInstructions: `You are a creative AI assistant specializing in artistic and creative projects. Help with:
- Creative writing and storytelling
- Content ideation and development
- Artistic concept development
- Creative problem solving
- Style and tone guidance

Encourage creativity while providing constructive feedback and inspiration.`,
        defaultSettings: {
          aiModelPreferences: {
            defaultModel: 'claude',
            allowModelSwitching: true,
            preferredModels: ['claude', 'gpt4', 'grok']
          },
          documentProcessingSettings: {
            autoExtractConcepts: true,
            chunkSize: 800,
            chunkOverlap: 150,
            enableOCR: false
          }
        },
        suggestedDocuments: [
          {
            name: 'Creative Brief',
            description: 'Project vision, goals, and creative direction',
            required: false,
            category: 'planning'
          },
          {
            name: 'Reference Materials',
            description: 'Inspiration, examples, and research materials',
            required: false,
            category: 'inspiration'
          },
          {
            name: 'Style Guides',
            description: 'Brand guidelines or artistic style references',
            required: false,
            category: 'guidelines'
          }
        ],
        initialConcepts: [
          { name: 'Creative Vision', description: 'Overall artistic vision and goals', category: 'vision' },
          { name: 'Target Audience', description: 'Who the creative work is intended for', category: 'audience' },
          { name: 'Style Elements', description: 'Artistic style, tone, and aesthetic choices', category: 'style' }
        ],
        teamRoleTemplates: [
          {
            role: 'owner',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: true,
              canDeleteContent: true
            },
            description: 'Creative Director',
            isDefault: true
          },
          {
            role: 'editor',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: true,
              canModifyProject: false,
              canDeleteContent: false
            },
            description: 'Collaborator/Contributor',
            isDefault: false
          }
        ],
        workflowSteps: [
          {
            step: 'ideation',
            title: 'Creative Ideation',
            description: 'Brainstorm and develop initial creative concepts',
            optional: false,
            estimatedTime: '45 minutes'
          },
          {
            step: 'development',
            title: 'Content Development',
            description: 'Create and refine creative content',
            optional: false,
            estimatedTime: '2-4 hours'
          },
          {
            step: 'feedback',
            title: 'Review and Refinement',
            description: 'Get feedback and polish the creative work',
            optional: true,
            estimatedTime: '1 hour'
          }
        ]
      },
      {
        id: 'personal',
        name: 'Personal Assistant',
        description: 'Personal productivity, learning, and decision-making support.',
        category: 'personal',
        icon: '🏠',
        customInstructions: `You are a personal AI assistant focused on helping with daily life and personal growth. Help with:
- Personal productivity and organization
- Learning new skills and topics
- Decision making and planning
- Goal setting and tracking
- Information research and synthesis

Provide personalized, practical advice tailored to individual needs and preferences.`,
        defaultSettings: {
          aiModelPreferences: {
            defaultModel: 'claude',
            allowModelSwitching: true,
            preferredModels: ['claude', 'gpt4', 'kimi', 'grok']
          },
          collaborationSettings: {
            enableRealTimeUpdates: false,
            enableActivityNotifications: true,
            shareKnowledgeGraphs: false,
            allowGuestAccess: false,
            activityRetention: 365
          }
        },
        suggestedDocuments: [
          {
            name: 'Personal Goals',
            description: 'Your goals, objectives, and aspirations',
            required: false,
            category: 'goals'
          },
          {
            name: 'Learning Materials',
            description: 'Books, articles, or courses you\'re studying',
            required: false,
            category: 'learning'
          },
          {
            name: 'Reference Documents',
            description: 'Important personal documents and information',
            required: false,
            category: 'reference'
          }
        ],
        initialConcepts: [
          { name: 'Personal Goals', description: 'Your short-term and long-term objectives', category: 'goals' },
          { name: 'Interests', description: 'Topics and activities you\'re passionate about', category: 'interests' },
          { name: 'Challenges', description: 'Current challenges or problems to solve', category: 'challenges' }
        ],
        teamRoleTemplates: [
          {
            role: 'owner',
            permissions: {
              canCreateBranches: true,
              canUploadDocuments: true,
              canInviteMembers: false,
              canModifyProject: true,
              canDeleteContent: true
            },
            description: 'Personal User - Full control',
            isDefault: true
          }
        ],
        workflowSteps: [
          {
            step: 'setup',
            title: 'Personal Setup',
            description: 'Set up your personal AI assistant with your preferences',
            optional: false,
            estimatedTime: '15 minutes'
          },
          {
            step: 'exploration',
            title: 'Start Conversations',
            description: 'Begin exploring topics or asking questions',
            optional: false,
            estimatedTime: '30 minutes'
          }
        ]
      }
    ];
  }

  /**
   * Initialize wizard state
   */
  initializeWizard(): WorkspaceWizardState {
    return {
      currentStep: 0,
      totalSteps: 5,
      data: {
        basicInfo: {
          name: '',
          description: '',
          category: 'personal',
          isPublic: false
        },
        template: {
          selectedTemplate: undefined,
          customInstructions: '',
          aiModelPreference: 'claude'
        },
        documents: {
          uploadedFiles: [],
          processingStatus: {}
        },
        team: {
          members: [],
          inviteEmails: []
        },
        settings: {}
      },
      validation: {
        basicInfo: { isValid: false, errors: [] },
        template: { isValid: true, errors: [] },
        documents: { isValid: true, errors: [] },
        team: { isValid: true, errors: [] },
        settings: { isValid: true, errors: [] }
      },
      isComplete: false
    };
  }

  /**
   * Validate wizard step
   */
  validateStep(step: number, data: WorkspaceWizardState['data']): { isValid: boolean; errors: string[] } {
    switch (step) {
      case 0: // Basic Info
        const errors: string[] = [];
        if (!data.basicInfo.name.trim()) {
          errors.push('Project name is required');
        }
        if (data.basicInfo.name.length < 3) {
          errors.push('Project name must be at least 3 characters');
        }
        if (data.basicInfo.name.length > 100) {
          errors.push('Project name must be less than 100 characters');
        }
        if (data.basicInfo.description.length > 500) {
          errors.push('Description must be less than 500 characters');
        }
        return {
          isValid: errors.length === 0,
          errors
        };

      case 1: // Template Selection
        return {
          isValid: true,
          errors: []
        };

      case 2: // Documents
        return {
          isValid: true,
          errors: []
        };

      case 3: // Team
        const teamErrors: string[] = [];
        for (const email of data.team.inviteEmails) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            teamErrors.push(`Invalid email: ${email}`);
          }
        }
        return {
          isValid: teamErrors.length === 0,
          errors: teamErrors
        };

      case 4: // Settings
        return {
          isValid: true,
          errors: []
        };

      default:
        return {
          isValid: false,
          errors: ['Invalid step']
        };
    }
  }

  /**
   * Apply template to wizard data
   */
  applyTemplate(template: ProjectTemplate, currentData: WorkspaceWizardState['data']): WorkspaceWizardState['data'] {
    return {
      ...currentData,
      basicInfo: {
        ...currentData.basicInfo,
        category: template.category
      },
      template: {
        selectedTemplate: template,
        customInstructions: template.customInstructions,
        aiModelPreference: template.defaultSettings.aiModelPreferences?.defaultModel || 'claude'
      },
      settings: {
        ...template.defaultSettings,
        ...currentData.settings // Preserve any existing settings
      }
    };
  }

  /**
   * Create project from wizard data
   */
  async createProjectFromWizard(wizardData: WorkspaceWizardState['data'], userId: string): Promise<string> {
    try {
      // Prepare project input
      const projectInput: CreateProjectInput = {
        name: wizardData.basicInfo.name,
        description: wizardData.basicInfo.description || undefined,
        customInstructions: wizardData.template.customInstructions || undefined
      };

      // Create the workspace
      const workspace = await workspaceService.createWorkspace(projectInput, userId);

      // Update workspace settings if provided
      if (Object.keys(wizardData.settings).length > 0) {
        await workspaceService.updateWorkspaceSettings(workspace.id, wizardData.settings);
      }

      // Process uploaded documents
      if (wizardData.documents.uploadedFiles.length > 0) {
        await this.processWizardDocuments(workspace.id, wizardData.documents.uploadedFiles);
      }

      // Invite team members
      if (wizardData.team.inviteEmails.length > 0) {
        await this.inviteTeamMembers(workspace.id, wizardData.team.inviteEmails, userId);
      }

      // Log wizard completion
      await workspaceService.logActivity(
        workspace.id,
        userId,
        'wizard_completed',
        {
          template: wizardData.template.selectedTemplate?.id,
          documentsUploaded: wizardData.documents.uploadedFiles.length,
          teamMembersInvited: wizardData.team.inviteEmails.length
        }
      );

      return workspace.id;
    } catch (error) {
      console.error('Failed to create project from wizard:', error);
      throw new Error('Failed to create project from wizard');
    }
  }

  /**
   * Process documents uploaded during wizard
   */
  private async processWizardDocuments(projectId: string, files: File[]): Promise<void> {
    // This would integrate with the document processing pipeline
    // For now, we'll just log the intent
    console.log(`Processing ${files.length} documents for project ${projectId}`);
    
    // TODO: Implement document processing pipeline integration
    // This should:
    // 1. Upload files to S3
    // 2. Extract text content
    // 3. Generate embeddings
    // 4. Store in TiDB with vector indexes
    // 5. Extract concepts for knowledge graph
  }

  /**
   * Invite team members
   */
  private async inviteTeamMembers(projectId: string, emails: string[], inviterId: string): Promise<void> {
    // This would integrate with the team management system
    console.log(`Inviting ${emails.length} team members to project ${projectId}`);
    
    // TODO: Implement team invitation system
    // This should:
    // 1. Generate invitation tokens
    // 2. Send invitation emails
    // 3. Create pending team member records
    // 4. Set up notification system
  }

  /**
   * Get wizard progress
   */
  calculateProgress(wizardState: WorkspaceWizardState): {
    completedSteps: number;
    totalSteps: number;
    progressPercentage: number;
    canProceed: boolean;
  } {
    const completedSteps = Object.values(wizardState.validation).filter(v => v.isValid).length;
    const progressPercentage = Math.round((completedSteps / wizardState.totalSteps) * 100);
    
    return {
      completedSteps,
      totalSteps: wizardState.totalSteps,
      progressPercentage,
      canProceed: wizardState.validation[Object.keys(wizardState.validation)[wizardState.currentStep]]?.isValid || false
    };
  }

  /**
   * Get step information
   */
  getStepInfo(step: number): {
    title: string;
    description: string;
    isOptional: boolean;
  } {
    const steps = [
      {
        title: 'Basic Information',
        description: 'Set up your project name, description, and category',
        isOptional: false
      },
      {
        title: 'Choose Template',
        description: 'Select a template or start from scratch',
        isOptional: true
      },
      {
        title: 'Upload Documents',
        description: 'Add initial documents to your knowledge base',
        isOptional: true
      },
      {
        title: 'Invite Team',
        description: 'Add team members and collaborators',
        isOptional: true
      },
      {
        title: 'Configure Settings',
        description: 'Customize your workspace preferences',
        isOptional: true
      }
    ];

    return steps[step] || {
      title: 'Unknown Step',
      description: 'Step information not available',
      isOptional: false
    };
  }
}

// Export singleton instance
export const projectWizardService = new ProjectWizardService();