/**
 * Cloudflare Workers AI Email Classifier & Summarizer Module
 *
 * Uses Cloudflare Workers AI (env.AI) with LLMs like @cf/meta/llama-3-8b-instruct
 * to automatically:
 * 1. Generate an accurate, 2-sentence summary of the email body.
 * 2. Classify the email as either 'Important' or 'Spam'.
 */

export const DEFAULT_AI_MODEL = '@cf/meta/llama-3-8b-instruct';

/**
 * Analyzes an inbound email using Cloudflare Workers AI (env.AI)
 *
 * @param {Object} ai - Cloudflare Workers AI binding (env.AI)
 * @param {Object} emailData - Email metadata and content
 * @param {string} emailData.sender - Sender email address
 * @param {string} emailData.subject - Email subject line
 * @param {string} [emailData.bodyText] - Plain-text body
 * @param {string} [emailData.bodyHtml] - HTML body
 * @returns {Promise<{ summary: string, classification: 'Important' | 'Spam', model: string }>}
 */
export async function analyzeEmailWithAI(ai, emailData) {
  const {
    sender = '',
    subject = '(No Subject)',
    bodyText = '',
    bodyHtml = ''
  } = emailData;

  // Extract clean text content (up to 4000 characters for token efficiency)
  let cleanContent = (bodyText || stripHtmlTags(bodyHtml)).trim();
  if (cleanContent.length > 4000) {
    cleanContent = cleanContent.slice(0, 4000) + '... [truncated]';
  }

  // If no content exists
  if (!cleanContent) {
    cleanContent = `(Empty email body with subject: ${subject})`;
  }

  // If env.AI binding is missing, fallback gracefully
  if (!ai || typeof ai.run !== 'function') {
    console.warn('[AI Classifier] env.AI binding not found. Using heuristic fallback.');
    return fallbackHeuristicAnalysis({ sender, subject, cleanContent });
  }

  const systemPrompt = `You are an automated enterprise email triage AI for a CRM system. Given the email sender, subject, and body text, perform two tasks:
1. Generate a concise, objective 2-sentence summary of the email content.
2. Classify the email as either "Important" or "Spam".

Classification Guidelines:
- "Important": Genuine customer inquiries, sales leads, signed agreements, quote requests, support tickets, billing questions, partnership proposals, or authentic human correspondence.
- "Spam": Unsolicited bulk marketing, phishing attempts, spam promotions, get-rich-quick scams, cold sales automation blasts, or generic newsletters.

You MUST respond strictly in valid JSON format with no markdown formatting or extra text:
{
  "summary": "First sentence summarizing the sender's core request. Second sentence highlighting key deliverables, questions, or next steps.",
  "classification": "Important"
}`;

  const userPrompt = `Sender: ${sender}\nSubject: ${subject}\n\nEmail Body:\n${cleanContent}`;

  try {
    const aiResponse = await ai.run(DEFAULT_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 250
    });

    let rawOutput = '';
    if (typeof aiResponse === 'string') {
      rawOutput = aiResponse;
    } else if (aiResponse?.response) {
      rawOutput = aiResponse.response;
    } else if (aiResponse?.result?.response) {
      rawOutput = aiResponse.result.response;
    } else {
      rawOutput = JSON.stringify(aiResponse);
    }

    const parsed = extractJsonFromResponse(rawOutput);

    let classification = 'Important';
    if (parsed?.classification) {
      const normalizedClass = String(parsed.classification).trim().toLowerCase();
      if (normalizedClass.includes('spam')) {
        classification = 'Spam';
      } else {
        classification = 'Important';
      }
    }

    let summary = parsed?.summary?.trim();
    if (!summary) {
      summary = cleanContent.length > 150
        ? cleanContent.slice(0, 150) + '...'
        : cleanContent;
    } else {
      // Ensure summary is clean and within 2 sentences
      summary = cleanTwoSentences(summary);
    }

    return {
      summary,
      classification,
      model: DEFAULT_AI_MODEL
    };

  } catch (error) {
    console.error('[AI Classifier] Workers AI execution error:', error.message);
    // Fallback to local heuristic classifier so the email flow never crashes
    return fallbackHeuristicAnalysis({ sender, subject, cleanContent });
  }
}

/**
 * Strips HTML tags and decodes common entities
 */
function stripHtmlTags(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Robustly parses JSON from LLM text that might contain code blocks or surrounding text
 */
function extractJsonFromResponse(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    // 1. Try direct parse
    return JSON.parse(text.trim());
  } catch (e) {
    // 2. Extract from markdown code block ```json ... ```
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (err2) {
        // continue
      }
    }

    // 3. Extract between first { and last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch (err3) {
        // continue
      }
    }
  }

  // 4. Regex fallback extraction
  const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/i);
  const classMatch = text.match(/"classification"\s*:\s*"([^"]+)"/i);

  if (summaryMatch || classMatch) {
    return {
      summary: summaryMatch ? summaryMatch[1] : null,
      classification: classMatch ? classMatch[1] : null
    };
  }

  return null;
}

/**
 * Ensures text is limited to 2 clean sentences
 */
function cleanTwoSentences(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 2) {
    return (sentences[0].trim() + ' ' + sentences[1].trim());
  }
  return text.trim();
}

/**
 * Heuristic fallback in case Workers AI is unavailable or rate-limited
 */
function fallbackHeuristicAnalysis({ sender, subject, cleanContent }) {
  const spamKeywords = [
    'viagra', 'casino', 'lottery', 'winner', 'crypto investment',
    'earn money fast', '100% free', 'unsubscribe from this blast',
    'wire transfer', 'nigerian prince', 'dear beneficiary', 'act now discount'
  ];

  const fullText = `${sender} ${subject} ${cleanContent}`.toLowerCase();
  const isSpam = spamKeywords.some(k => fullText.includes(k));

  const sentences = cleanContent.match(/[^.!?]+[.!?]+/g) || [cleanContent];
  const summary = sentences.slice(0, 2).join(' ').trim() || `${subject}: Inbound message from ${sender}.`;

  return {
    summary: summary.length > 250 ? summary.slice(0, 250) + '...' : summary,
    classification: isSpam ? 'Spam' : 'Important',
    model: 'heuristic-fallback'
  };
}

export default {
  analyzeEmailWithAI,
  DEFAULT_AI_MODEL
};
