/**
 * EmailJS Integration Service for SYNAPSE AI Platform
 * Client-side email sending using EmailJS service
 * Integrates with existing workflow and external API system
 */

import emailjs from '@emailjs/browser';

// EmailJS configuration from environment variables
const EMAILJS_CONFIG = {
  serviceId: process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || 'service_2gp54om',
  templateId: process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID || 'template_7m7fip8',
  publicKey: process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || '5RG56BLKEzjRINH7P'
};

/**
 * Initialize EmailJS service
 */
export function initializeEmailJS() {
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
    console.log('EmailJS initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize EmailJS:', error);
    return false;
  }
}

/**
 * Send email using EmailJS service
 * @param {Object} emailData - Email data object
 * @param {string} emailData.to_email - Recipient email address
 * @param {string} emailData.to_name - Recipient name
 * @param {string} emailData.from_name - Sender name
 * @param {string} emailData.from_email - Sender email (optional)
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.message - Email message content
 * @param {string} emailData.html_message - HTML email content (optional)
 * @param {Object} emailData.metadata - Additional metadata (optional)
 * @returns {Promise<Object>} Email sending result
 */
export async function sendEmail(emailData) {
  const startTime = Date.now();
  
  try {
    // Validate required fields
    if (!emailData.to_email || !emailData.subject || !emailData.message) {
      throw new Error('Missing required fields: to_email, subject, and message are required');
    }

    // Prepare template parameters for EmailJS
    const templateParams = {
      to_email: emailData.to_email,
      to_name: emailData.to_name || emailData.to_email,
      from_name: emailData.from_name || 'SYNAPSE AI Platform',
      from_email: emailData.from_email || 'noreply@synapse-ai.com',
      subject: emailData.subject,
      message: emailData.message,
      html_message: emailData.html_message || emailData.message,
      timestamp: new Date().toISOString(),
      project_name: emailData.metadata?.projectName || 'SYNAPSE AI',
      workflow_type: emailData.metadata?.workflowType || 'general',
      // Additional metadata as JSON string for template access
      metadata: JSON.stringify(emailData.metadata || {})
    };

    console.log('Sending email via EmailJS:', {
      serviceId: EMAILJS_CONFIG.serviceId,
      templateId: EMAILJS_CONFIG.templateId,
      to: templateParams.to_email,
      subject: templateParams.subject
    });

    // Send email using EmailJS
    const response = await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      templateParams,
      EMAILJS_CONFIG.publicKey
    );

    const processingTime = Date.now() - startTime;

    return {
      type: 'email',
      success: true,
      response: {
        status: response.status,
        text: response.text,
        messageId: `emailjs_${Date.now()}`
      },
      latency: processingTime,
      timestamp: new Date(),
      metadata: {
        recipient: templateParams.to_email,
        provider: 'emailjs',
        serviceId: EMAILJS_CONFIG.serviceId,
        templateId: EMAILJS_CONFIG.templateId
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    console.error('EmailJS sending failed:', {
      error: error.message,
      stack: error.stack,
      emailData: {
        to: emailData.to_email,
        subject: emailData.subject
      }
    });

    return {
      type: 'email',
      success: false,
      error: error.message || 'Unknown EmailJS error',
      latency: processingTime,
      timestamp: new Date(),
      metadata: {
        recipient: emailData.to_email,
        provider: 'emailjs',
        errorCode: error.code || 'UNKNOWN_ERROR'
      }
    };
  }
}

/**
 * Send workflow notification email with pre-built templates
 * @param {string} workflowType - Type of workflow notification
 * @param {Object} data - Workflow data for template
 * @param {string|string[]} recipients - Email recipient(s)
 * @returns {Promise<Object>} Email sending result
 */
export async function sendWorkflowNotification(workflowType, data, recipients) {
  try {
    // Ensure recipients is an array
    const recipientList = Array.isArray(recipients) ? recipients : [recipients];
    
    // Generate email content based on workflow type
    const emailContent = generateWorkflowEmailContent(workflowType, data);
    
    if (!emailContent) {
      throw new Error(`Unknown workflow type: ${workflowType}`);
    }

    // Send email to all recipients
    const emailPromises = recipientList.map(recipient => 
      sendEmail({
        to_email: recipient,
        to_name: recipient.split('@')[0], // Use email prefix as name
        subject: emailContent.subject,
        message: emailContent.textContent,
        html_message: emailContent.htmlContent,
        metadata: {
          workflowType,
          projectName: data.projectName,
          ...data.metadata
        }
      })
    );

    const results = await Promise.all(emailPromises);
    
    // Return combined result
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return {
      type: 'email',
      success: successCount === totalCount,
      results,
      summary: {
        total: totalCount,
        successful: successCount,
        failed: totalCount - successCount
      },
      latency: Math.max(...results.map(r => r.latency)),
      timestamp: new Date(),
      metadata: {
        workflowType,
        recipientCount: totalCount,
        provider: 'emailjs'
      }
    };

  } catch (error) {
    return {
      type: 'email',
      success: false,
      error: error.message,
      latency: 0,
      timestamp: new Date(),
      metadata: {
        workflowType,
        provider: 'emailjs'
      }
    };
  }
}

/**
 * Generate email content for different workflow types
 * @param {string} workflowType - Type of workflow
 * @param {Object} data - Workflow data
 * @returns {Object|null} Email content object or null if unknown type
 */
function generateWorkflowEmailContent(workflowType, data) {
  const templates = {
    document_processed: {
      subject: `📄 Document Processed: ${data.filename || 'Document'}`,
      textContent: `
Document Processing Complete

A new document has been successfully processed in your SYNAPSE AI project.

Project: ${data.projectName || 'Unknown'}
Filename: ${data.filename || 'Unknown'}
Concepts extracted: ${data.conceptsCount || 0}
Processing time: ${data.processingTime || 0}ms

View your project: ${data.documentUrl || 'N/A'}

--
SYNAPSE AI Platform
Revolutionizing AI conversations with Git-style branching
      `.trim(),
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">📄 Document Processing Complete</h2>
          <p>A new document has been successfully processed in your SYNAPSE AI project.</p>
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Project:</strong> ${data.projectName || 'Unknown'}</li>
              <li><strong>Filename:</strong> ${data.filename || 'Unknown'}</li>
              <li><strong>Concepts extracted:</strong> ${data.conceptsCount || 0}</li>
              <li><strong>Processing time:</strong> ${data.processingTime || 0}ms</li>
            </ul>
          </div>
          ${data.documentUrl ? `<p><a href="${data.documentUrl}" style="color: #2563eb; text-decoration: none;">View Document →</a></p>` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            SYNAPSE AI Platform<br>
            Revolutionizing AI conversations with Git-style branching
          </p>
        </div>
      `
    },

    workflow_completed: {
      subject: `✅ Workflow Completed: ${data.workflowName || 'Workflow'}`,
      textContent: `
Workflow Execution Complete

Your SYNAPSE AI workflow has completed successfully.

Workflow: ${data.workflowName || 'Unknown'}
Duration: ${data.duration || 0}ms
Steps executed: ${data.stepsExecuted || 0}
Results: ${data.results || 'No results'}

View results: ${data.workflowUrl || 'N/A'}

--
SYNAPSE AI Platform
Revolutionizing AI conversations with Git-style branching
      `.trim(),
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #10b981;">✅ Workflow Execution Complete</h2>
          <p>Your SYNAPSE AI workflow has completed successfully.</p>
          <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #10b981;">
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Workflow:</strong> ${data.workflowName || 'Unknown'}</li>
              <li><strong>Duration:</strong> ${data.duration || 0}ms</li>
              <li><strong>Steps executed:</strong> ${data.stepsExecuted || 0}</li>
              <li><strong>Results:</strong> ${data.results || 'No results'}</li>
            </ul>
          </div>
          ${data.workflowUrl ? `<p><a href="${data.workflowUrl}" style="color: #10b981; text-decoration: none;">View Complete Results →</a></p>` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            SYNAPSE AI Platform<br>
            Revolutionizing AI conversations with Git-style branching
          </p>
        </div>
      `
    },

    research_insights: {
      subject: `🔬 Research Insights: ${data.query || 'Research Query'}`,
      textContent: `
Research Insights Generated

New research insights have been generated for your query.

Query: "${data.query || 'Unknown'}"
Sources analyzed: ${data.sourcesCount || 0}
Key concepts: ${data.concepts ? data.concepts.join(', ') : 'None'}

${data.summary || 'No summary available.'}

View research: ${data.researchUrl || 'N/A'}

--
SYNAPSE AI Platform
Revolutionizing AI conversations with Git-style branching
      `.trim(),
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #7c3aed;">🔬 New Research Insights Available</h2>
          <p>SYNAPSE AI has generated new research insights for your query.</p>
          <div style="background: #faf5ff; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #7c3aed;">
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Query:</strong> "${data.query || 'Unknown'}"</li>
              <li><strong>Sources analyzed:</strong> ${data.sourcesCount || 0}</li>
              <li><strong>Key concepts:</strong> ${data.concepts ? data.concepts.join(', ') : 'None'}</li>
            </ul>
          </div>
          ${data.summary ? `<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <h3 style="margin-top: 0; color: #374151;">Summary:</h3>
            <p style="margin-bottom: 0;">${data.summary}</p>
          </div>` : ''}
          ${data.researchUrl ? `<p><a href="${data.researchUrl}" style="color: #7c3aed; text-decoration: none;">View Complete Research →</a></p>` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            SYNAPSE AI Platform<br>
            Revolutionizing AI conversations with Git-style branching
          </p>
        </div>
      `
    },

    branch_created: {
      subject: `🌿 New Branch Created: ${data.branchName || 'Branch'}`,
      textContent: `
New Conversation Branch Created

A new branch has been created in your conversation tree.

Branch name: ${data.branchName || 'Unknown'}
Parent branch: ${data.parentBranch || 'main'}
Model: ${data.model || 'Unknown'}
Created from message: "${data.sourceMessage || 'N/A'}"

View branch: ${data.branchUrl || 'N/A'}

--
SYNAPSE AI Platform
Revolutionizing AI conversations with Git-style branching
      `.trim(),
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #059669;">🌿 New Conversation Branch Created</h2>
          <p>A new branch has been created in your conversation tree.</p>
          <div style="background: #f0fdfa; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #059669;">
            <ul style="margin: 0; padding-left: 20px;">
              <li><strong>Branch name:</strong> ${data.branchName || 'Unknown'}</li>
              <li><strong>Parent branch:</strong> ${data.parentBranch || 'main'}</li>
              <li><strong>Model:</strong> ${data.model || 'Unknown'}</li>
              <li><strong>Created from:</strong> "${data.sourceMessage || 'N/A'}"</li>
            </ul>
          </div>
          ${data.branchUrl ? `<p><a href="${data.branchUrl}" style="color: #059669; text-decoration: none;">View Branch →</a></p>` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            SYNAPSE AI Platform<br>
            Revolutionizing AI conversations with Git-style branching
          </p>
        </div>
      `
    }
  };

  return templates[workflowType] || null;
}

/**
 * Test EmailJS configuration
 * @returns {Promise<Object>} Test result
 */
export async function testEmailJSConfiguration() {
  try {
    const testResult = await sendEmail({
      to_email: 'test@example.com',
      to_name: 'Test User',
      subject: '🧪 SYNAPSE AI EmailJS Integration Test',
      message: 'This is a test email from SYNAPSE AI platform to verify EmailJS configuration.',
      html_message: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">🧪 EmailJS Integration Test</h2>
          <p>This is a test email from SYNAPSE AI platform to verify EmailJS configuration.</p>
          <div style="background: #f0f9ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Configuration Details:</strong></p>
            <ul>
              <li>Service ID: ${EMAILJS_CONFIG.serviceId}</li>
              <li>Template ID: ${EMAILJS_CONFIG.templateId}</li>
              <li>Public Key: ${EMAILJS_CONFIG.publicKey.substring(0, 8)}...</li>
              <li>Test Date: ${new Date().toISOString()}</li>
            </ul>
          </div>
          <p style="color: #10b981;"><strong>✅ If you received this email, EmailJS is configured correctly!</strong></p>
        </div>
      `,
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      result: testResult,
      configuration: {
        serviceId: EMAILJS_CONFIG.serviceId,
        templateId: EMAILJS_CONFIG.templateId,
        publicKeyPrefix: EMAILJS_CONFIG.publicKey.substring(0, 8)
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      configuration: {
        serviceId: EMAILJS_CONFIG.serviceId,
        templateId: EMAILJS_CONFIG.templateId,
        publicKeyPrefix: EMAILJS_CONFIG.publicKey.substring(0, 8)
      }
    };
  }
}

/**
 * Get EmailJS configuration status
 * @returns {Object} Configuration status
 */
export function getEmailJSStatus() {
  return {
    configured: !!(EMAILJS_CONFIG.serviceId && EMAILJS_CONFIG.templateId && EMAILJS_CONFIG.publicKey),
    serviceId: EMAILJS_CONFIG.serviceId,
    templateId: EMAILJS_CONFIG.templateId,
    publicKeyConfigured: !!EMAILJS_CONFIG.publicKey,
    provider: 'emailjs'
  };
}

// Export configuration for integration with existing external APIs
export const emailJSIntegration = {
  send: sendEmail,
  sendWorkflowNotification,
  test: testEmailJSConfiguration,
  getStatus: getEmailJSStatus,
  init: initializeEmailJS
};

// Default export
export default {
  send: sendEmail,
  sendWorkflowNotification,
  test: testEmailJSConfiguration,
  getStatus: getEmailJSStatus,
  init: initializeEmailJS,
  config: EMAILJS_CONFIG
};