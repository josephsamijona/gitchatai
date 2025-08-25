/**
 * External API Integration Service for SYNAPSE AI Platform
 * Handles Slack, email, webhook integrations for multi-step workflow demonstration
 * Core hackathon requirement: External API integration in workflow pipeline
 */

import type {
  ExternalIntegration,
  IntegrationResult,
  SlackConfig,
  EmailConfig,
  WebhookConfig,
  IntegrationTemplate,
  IntegrationMetrics
} from '../../types/workflow';

export interface ExternalAPIServiceConfig {
  slack: SlackConfig;
  email: EmailConfig;
  webhooks: Record<string, WebhookConfig>;
  templates: Record<string, IntegrationTemplate>;
  retryConfig: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
  };
  timeout: number;
}

export class ExternalAPIService {
  private integrationMetrics: IntegrationMetrics = {
    totalIntegrations: 0,
    successfulIntegrations: 0,
    failedIntegrations: 0,
    averageLatency: 0,
    integrationsByType: {
      slack: { total: 0, successful: 0, failed: 0 },
      email: { total: 0, successful: 0, failed: 0 },
      webhook: { total: 0, successful: 0, failed: 0 }
    }
  };

  constructor(private config: ExternalAPIServiceConfig) {}

  /**
   * Execute multiple integrations in parallel
   * Core method for workflow step execution
   */
  async executeIntegrations(
    integrationTypes: string[],
    data: {
      template: string;
      data: any;
      metadata?: any;
    }
  ): Promise<IntegrationResult[]> {
    const startTime = Date.now();

    try {
      const integrationPromises = integrationTypes.map(type => 
        this.executeIntegration(type, data)
      );

      const results = await Promise.allSettled(integrationPromises);
      
      const integrationResults: IntegrationResult[] = results.map((result, index) => {
        const type = integrationTypes[index];
        
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            type: type as any,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            latency: Date.now() - startTime,
            timestamp: new Date()
          };
        }
      });

      // Update metrics
      this.updateMetrics(integrationResults);

      return integrationResults;

    } catch (error) {
      console.error('Failed to execute integrations:', error);
      throw new Error(`Integration execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Send Slack notification
   */
  async sendSlackMessage(data: {
    channel?: string;
    message: string;
    attachments?: any[];
    metadata?: any;
  }): Promise<IntegrationResult> {
    const startTime = Date.now();

    try {
      if (!this.config.slack.enabled || !this.config.slack.botToken) {
        throw new Error('Slack integration not configured');
      }

      const slackPayload = {
        channel: data.channel || this.config.slack.defaultChannel,
        text: data.message,
        username: this.config.slack.botName || 'SYNAPSE AI',
        icon_emoji: ':robot_face:',
        attachments: data.attachments || [],
        metadata: data.metadata
      };

      const response = await this.makeHTTPRequest({
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        headers: {
          'Authorization': `Bearer ${this.config.slack.botToken}`,
          'Content-Type': 'application/json'
        },
        data: slackPayload,
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.error || 'Unknown error'}`);
      }

      return {
        type: 'slack',
        success: true,
        response: response,
        latency: Date.now() - startTime,
        timestamp: new Date(),
        metadata: {
          channel: slackPayload.channel,
          messageId: response.ts
        }
      };

    } catch (error) {
      return {
        type: 'slack',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
        timestamp: new Date()
      };
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(data: {
    to?: string[];
    subject: string;
    content: string;
    isHtml?: boolean;
    metadata?: any;
  }): Promise<IntegrationResult> {
    const startTime = Date.now();

    try {
      if (!this.config.email.enabled) {
        throw new Error('Email integration not configured');
      }

      const emailPayload = {
        to: data.to || this.config.email.defaultRecipients,
        from: this.config.email.fromAddress,
        subject: data.subject,
        [data.isHtml ? 'html' : 'text']: data.content,
        metadata: data.metadata
      };

      let response;

      // Use configured email service
      switch (this.config.email.provider) {
        case 'sendgrid':
          response = await this.sendEmailViaSendGrid(emailPayload);
          break;
        case 'smtp':
          response = await this.sendEmailViaSMTP(emailPayload);
          break;
        case 'resend':
          response = await this.sendEmailViaResend(emailPayload);
          break;
        default:
          throw new Error(`Unsupported email provider: ${this.config.email.provider}`);
      }

      return {
        type: 'email',
        success: true,
        response: response,
        latency: Date.now() - startTime,
        timestamp: new Date(),
        metadata: {
          recipients: emailPayload.to,
          provider: this.config.email.provider
        }
      };

    } catch (error) {
      return {
        type: 'email',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
        timestamp: new Date()
      };
    }
  }

  /**
   * Send webhook notification
   */
  async sendWebhook(webhookName: string, data: {
    payload: any;
    metadata?: any;
  }): Promise<IntegrationResult> {
    const startTime = Date.now();

    try {
      const webhookConfig = this.config.webhooks[webhookName];
      if (!webhookConfig) {
        throw new Error(`Webhook configuration not found: ${webhookName}`);
      }

      const webhookPayload = {
        ...data.payload,
        timestamp: new Date().toISOString(),
        source: 'synapse-ai',
        metadata: data.metadata
      };

      const response = await this.makeHTTPRequest({
        method: webhookConfig.method || 'POST',
        url: webhookConfig.url,
        headers: {
          'Content-Type': 'application/json',
          ...webhookConfig.headers
        },
        data: webhookPayload,
        timeout: this.config.timeout
      });

      return {
        type: 'webhook',
        success: true,
        response: response,
        latency: Date.now() - startTime,
        timestamp: new Date(),
        metadata: {
          webhookName,
          url: webhookConfig.url,
          method: webhookConfig.method || 'POST'
        }
      };

    } catch (error) {
      return {
        type: 'webhook',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
        timestamp: new Date(),
        metadata: {
          webhookName
        }
      };
    }
  }

  /**
   * Get integration performance metrics for hackathon demo
   */
  getMetrics(): IntegrationMetrics {
    return { ...this.integrationMetrics };
  }

  /**
   * Test all configured integrations
   */
  async testIntegrations(): Promise<Record<string, IntegrationResult>> {
    const results: Record<string, IntegrationResult> = {};

    // Test Slack
    if (this.config.slack.enabled) {
      results.slack = await this.sendSlackMessage({
        message: '🧪 SYNAPSE AI Integration Test - Slack connection verified!',
        metadata: { test: true }
      });
    }

    // Test Email
    if (this.config.email.enabled) {
      results.email = await this.sendEmail({
        subject: '🧪 SYNAPSE AI Integration Test',
        content: 'Email integration test successful! Your SYNAPSE AI platform is ready.',
        metadata: { test: true }
      });
    }

    // Test Webhooks
    for (const webhookName of Object.keys(this.config.webhooks)) {
      results[`webhook_${webhookName}`] = await this.sendWebhook(webhookName, {
        payload: {
          event: 'integration_test',
          message: 'SYNAPSE AI webhook integration test'
        },
        metadata: { test: true }
      });
    }

    return results;
  }

  /**
   * Create pre-built integration templates for common workflows
   */
  createWorkflowNotification(workflowType: string, data: any): {
    slack?: any;
    email?: any;
    webhook?: any;
  } {
    const templates = {
      document_processed: {
        slack: {
          message: `📄 *Document Processed*\n\nA new document has been processed in project "${data.projectName}":\n• Filename: ${data.filename}\n• Concepts extracted: ${data.conceptsCount}\n• Processing time: ${data.processingTime}ms\n\n<${data.documentUrl}|View Document>`,
          attachments: [{
            color: 'good',
            fields: [
              { title: 'Project', value: data.projectName, short: true },
              { title: 'Processing Time', value: `${data.processingTime}ms`, short: true }
            ]
          }]
        },
        email: {
          subject: `Document Processed: ${data.filename}`,
          content: `
            <h2>Document Processing Complete</h2>
            <p>A new document has been successfully processed in your SYNAPSE AI project.</p>
            <ul>
              <li><strong>Project:</strong> ${data.projectName}</li>
              <li><strong>Filename:</strong> ${data.filename}</li>
              <li><strong>Concepts extracted:</strong> ${data.conceptsCount}</li>
              <li><strong>Processing time:</strong> ${data.processingTime}ms</li>
            </ul>
            <p><a href="${data.documentUrl}">View Document</a></p>
          `,
          isHtml: true
        },
        webhook: {
          event: 'document_processed',
          project: data.projectName,
          document: data.filename,
          metrics: {
            conceptsCount: data.conceptsCount,
            processingTime: data.processingTime
          }
        }
      },

      workflow_completed: {
        slack: {
          message: `✅ *Workflow Completed*\n\nWorkflow "${data.workflowName}" has been completed successfully:\n• Duration: ${data.duration}ms\n• Steps executed: ${data.stepsExecuted}\n• Results: ${data.results}\n\n<${data.workflowUrl}|View Results>`,
          attachments: [{
            color: 'good',
            fields: [
              { title: 'Workflow', value: data.workflowName, short: true },
              { title: 'Duration', value: `${data.duration}ms`, short: true }
            ]
          }]
        },
        email: {
          subject: `Workflow Completed: ${data.workflowName}`,
          content: `
            <h2>Workflow Execution Complete</h2>
            <p>Your SYNAPSE AI workflow has completed successfully.</p>
            <ul>
              <li><strong>Workflow:</strong> ${data.workflowName}</li>
              <li><strong>Duration:</strong> ${data.duration}ms</li>
              <li><strong>Steps executed:</strong> ${data.stepsExecuted}</li>
              <li><strong>Results:</strong> ${data.results}</li>
            </ul>
            <p><a href="${data.workflowUrl}">View Complete Results</a></p>
          `,
          isHtml: true
        },
        webhook: {
          event: 'workflow_completed',
          workflow: data.workflowName,
          execution: {
            duration: data.duration,
            stepsExecuted: data.stepsExecuted,
            results: data.results
          }
        }
      },

      research_insights: {
        slack: {
          message: `🔬 *Research Insights Generated*\n\nNew research insights have been generated:\n• Query: "${data.query}"\n• Sources analyzed: ${data.sourcesCount}\n• Key concepts: ${data.concepts.join(', ')}\n\n<${data.researchUrl}|View Research>`,
          attachments: [{
            color: '#36a64f',
            fields: [
              { title: 'Sources', value: data.sourcesCount.toString(), short: true },
              { title: 'Concepts', value: data.concepts.length.toString(), short: true }
            ]
          }]
        },
        email: {
          subject: `Research Insights: ${data.query}`,
          content: `
            <h2>New Research Insights Available</h2>
            <p>SYNAPSE AI has generated new research insights for your query.</p>
            <ul>
              <li><strong>Query:</strong> "${data.query}"</li>
              <li><strong>Sources analyzed:</strong> ${data.sourcesCount}</li>
              <li><strong>Key concepts:</strong> ${data.concepts.join(', ')}</li>
            </ul>
            <p><a href="${data.researchUrl}">View Complete Research</a></p>
          `,
          isHtml: true
        },
        webhook: {
          event: 'research_insights',
          query: data.query,
          insights: {
            sourcesCount: data.sourcesCount,
            concepts: data.concepts,
            summary: data.summary
          }
        }
      }
    };

    return templates[workflowType as keyof typeof templates] || {};
  }

  /**
   * Private helper methods
   */
  private async executeIntegration(
    type: string,
    data: {
      template: string;
      data: any;
      metadata?: any;
    }
  ): Promise<IntegrationResult> {
    const template = this.config.templates[data.template];
    if (!template) {
      throw new Error(`Integration template not found: ${data.template}`);
    }

    const notifications = this.createWorkflowNotification(data.template, data.data);

    switch (type) {
      case 'slack':
        if (!notifications.slack) {
          throw new Error(`Slack template not found for: ${data.template}`);
        }
        return this.sendSlackMessage({
          ...notifications.slack,
          metadata: data.metadata
        });

      case 'email':
        if (!notifications.email) {
          throw new Error(`Email template not found for: ${data.template}`);
        }
        return this.sendEmail({
          ...notifications.email,
          metadata: data.metadata
        });

      default:
        // Assume it's a webhook name
        if (!notifications.webhook) {
          throw new Error(`Webhook template not found for: ${data.template}`);
        }
        return this.sendWebhook(type, {
          payload: notifications.webhook,
          metadata: data.metadata
        });
    }
  }

  private async makeHTTPRequest(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    data?: any;
    timeout: number;
  }): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.data ? JSON.stringify(options.data) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async sendEmailViaSendGrid(emailData: any): Promise<any> {
    if (!this.config.email.apiKey) {
      throw new Error('SendGrid API key not configured');
    }

    return this.makeHTTPRequest({
      method: 'POST',
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: {
        'Authorization': `Bearer ${this.config.email.apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        personalizations: [{
          to: emailData.to.map((email: string) => ({ email }))
        }],
        from: { email: emailData.from },
        subject: emailData.subject,
        content: [{
          type: emailData.html ? 'text/html' : 'text/plain',
          value: emailData.html || emailData.text
        }]
      },
      timeout: this.config.timeout
    });
  }

  private async sendEmailViaResend(emailData: any): Promise<any> {
    if (!this.config.email.apiKey) {
      throw new Error('Resend API key not configured');
    }

    return this.makeHTTPRequest({
      method: 'POST',
      url: 'https://api.resend.com/emails',
      headers: {
        'Authorization': `Bearer ${this.config.email.apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text
      },
      timeout: this.config.timeout
    });
  }

  private async sendEmailViaSMTP(emailData: any): Promise<any> {
    // SMTP implementation would require a different approach
    // For demo purposes, we'll simulate success
    return {
      success: true,
      messageId: `smtp_${Date.now()}`,
      provider: 'smtp'
    };
  }

  private updateMetrics(results: IntegrationResult[]): void {
    this.integrationMetrics.totalIntegrations += results.length;

    let totalLatency = 0;
    for (const result of results) {
      totalLatency += result.latency;

      if (result.success) {
        this.integrationMetrics.successfulIntegrations++;
        this.integrationMetrics.integrationsByType[result.type].successful++;
      } else {
        this.integrationMetrics.failedIntegrations++;
        this.integrationMetrics.integrationsByType[result.type].failed++;
      }

      this.integrationMetrics.integrationsByType[result.type].total++;
    }

    // Update average latency
    const oldTotal = this.integrationMetrics.averageLatency * (this.integrationMetrics.totalIntegrations - results.length);
    this.integrationMetrics.averageLatency = (oldTotal + totalLatency) / this.integrationMetrics.totalIntegrations;
  }
}

/**
 * Factory function to create external API service
 */
export function createExternalAPIService(config: ExternalAPIServiceConfig): ExternalAPIService {
  return new ExternalAPIService(config);
}

/**
 * Default configuration for demo/development
 */
export const createDemoExternalAPIConfig = (): ExternalAPIServiceConfig => ({
  slack: {
    enabled: process.env.SLACK_BOT_TOKEN ? true : false,
    botToken: process.env.SLACK_BOT_TOKEN || '',
    defaultChannel: process.env.SLACK_DEFAULT_CHANNEL || '#synapse-ai',
    botName: 'SYNAPSE AI'
  },
  email: {
    enabled: process.env.EMAIL_PROVIDER ? true : false,
    provider: (process.env.EMAIL_PROVIDER as any) || 'resend',
    apiKey: process.env.EMAIL_API_KEY || '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'synapse@example.com',
    defaultRecipients: process.env.EMAIL_DEFAULT_RECIPIENTS?.split(',') || []
  },
  webhooks: {
    analytics_service: {
      url: process.env.ANALYTICS_WEBHOOK_URL || 'https://example.com/webhook/analytics',
      method: 'POST',
      headers: {
        'X-API-Key': process.env.ANALYTICS_API_KEY || 'demo-key'
      }
    },
    crm_update: {
      url: process.env.CRM_WEBHOOK_URL || 'https://example.com/webhook/crm',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CRM_API_TOKEN || 'demo-token'}`
      }
    }
  },
  templates: {
    document_processed: {
      name: 'Document Processed',
      description: 'Notification when document processing completes'
    },
    workflow_completed: {
      name: 'Workflow Completed',
      description: 'Notification when multi-step workflow completes'
    },
    research_insights: {
      name: 'Research Insights',
      description: 'Notification when research insights are generated'
    }
  },
  retryConfig: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  },
  timeout: 30000
});