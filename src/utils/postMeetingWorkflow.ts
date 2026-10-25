import { wsDispatcher } from './wsDispatcher';
import { sendSecureOutboundEmail } from './secureOutboundMailer';

export interface ActionItem {
  task: string;
  assignee?: string;
  dueDate?: string;
}

export interface Participant {
  name: string;
  email: string;
}

export interface MeetingWorkflowData {
  meetingId: string;
  title: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  participants: Participant[];
}

/**
 * Compiles an HTML email template summarizing the meeting and dispatches via DKIM-signed Cloudflare mTLS Mailer.
 */
export async function draftFollowUpEmail(meetingData: MeetingWorkflowData): Promise<{ success: boolean; recipients: string[]; htmlBody: string; messageId: string }> {
  const recipientEmails = meetingData.participants.map(p => p.email);

  console.log(`[Post-Meeting Workflow] Compiling HTML follow-up newsletter template for: ${recipientEmails.join(', ')}`);

  // Build a clean responsive HTML email design
  const beautifulHtmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Minutes &amp; Follow-Up: ${meetingData.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 32px;
      color: #ffffff;
      text-align: left;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.025em;
    }
    .header p {
      margin: 8px 0 0 0;
      font-size: 13px;
      color: #94a3b8;
    }
    .content {
      padding: 32px;
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #64748b;
      margin: 0 0 12px 0;
      font-weight: 700;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 6px;
    }
    .summary-text {
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
      margin-bottom: 24px;
    }
    .list-item {
      padding: 10px 0;
      border-bottom: 1px dashed #f1f5f9;
      font-size: 13px;
      color: #334155;
      line-height: 1.4;
    }
    .action-pill {
      display: inline-block;
      background-color: #e0f2fe;
      color: #0369a1;
      font-weight: 700;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 9999px;
      margin-left: 6px;
    }
    .footer {
      background-color: #f8fafc;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>${meetingData.title}</h1>
        <p>Official Post-Meeting Summary &amp; Actionable Deliverables</p>
      </div>
      <div class="content">
        <h3 class="section-title">Overview Summary</h3>
        <p class="summary-text">${meetingData.summary}</p>
        
        <h3 class="section-title">Key Decisions Established</h3>
        <div style="margin-bottom: 24px;">
          ${meetingData.decisions.map(decision => `
            <div class="list-item" style="font-weight: 500;">
              ✓ &nbsp; ${decision}
            </div>
          `).join('') || '<div class="list-item" style="color:#94a3b8;">No major decisions listed.</div>'}
        </div>

        <h3 class="section-title">Critical Deliverables</h3>
        <div>
          ${meetingData.actionItems.map(item => `
            <div class="list-item">
              <strong>${item.task}</strong>
              ${item.assignee ? `<span class="action-pill">Assignee: ${item.assignee}</span>` : ''}
              ${item.dueDate ? `<span class="action-pill" style="background-color:#fef3c7; color:#b45309;">Due: ${item.dueDate}</span>` : ''}
            </div>
          `).join('') || '<div class="list-item" style="color:#94a3b8;">No pending deliverables listed.</div>'}
        </div>
      </div>
      <div class="footer">
        Automated via Secure DKIM / Cloudflare mTLS Relay Mailer.<br>
        <p>&copy; 2026 Omnichannel CRM. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  // Dispatch via Secure DKIM + Cloudflare mTLS Relay Module
  const dispatchResult = await sendSecureOutboundEmail({
    to: recipientEmails.length > 0 ? recipientEmails : ['client@example.com'],
    subject: `Meeting Follow-Up: ${meetingData.title}`,
    html: beautifulHtmlBody,
    text: `Summary for ${meetingData.title}:\n\n${meetingData.summary}\n\nKey Decisions:\n${meetingData.decisions.join('\n')}\n\nAction Items:\n${meetingData.actionItems.map(a => `- ${a.task}`).join('\n')}`
  });

  wsDispatcher.broadcast('WORKFLOW_EMAIL_SENT', {
    meetingId: meetingData.meetingId,
    status: 'dispatched_success',
    recipientsCount: recipientEmails.length,
    messageId: dispatchResult.messageId,
    algorithm: dispatchResult.algorithmUsed,
  });

  return { 
    success: true, 
    recipients: recipientEmails, 
    htmlBody: beautifulHtmlBody, 
    messageId: dispatchResult.messageId 
  };
}

/**
 * Main module postMeetingWorkflow(meetingData)
 */
export async function postMeetingWorkflow(meetingData: MeetingWorkflowData): Promise<{
  success: boolean;
  meetingId: string;
  emailResult: { success: boolean; recipientsCount: number; messageId: string };
}> {
  console.log(`[Post-Meeting Workflow] Initiating secure email dispatch for Meeting ID: "${meetingData.meetingId}"`);

  const emailRes = await draftFollowUpEmail(meetingData);

  const summary = {
    success: true,
    meetingId: meetingData.meetingId,
    emailResult: {
      success: emailRes.success,
      recipientsCount: emailRes.recipients.length,
      messageId: emailRes.messageId,
    }
  };

  wsDispatcher.broadcast('WORKFLOW_COMPLETED', {
    meetingId: meetingData.meetingId,
    results: summary
  });

  return summary;
}
