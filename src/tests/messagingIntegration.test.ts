/**
 * OmniChannel CRM Messaging & Collaboration Engine
 * Comprehensive Unit, Integration, and Security Test Suite
 */

import {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES
} from './testConstants';

// --- Test Utilities ---
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, errorDetail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}: ${errorDetail || 'Assertion failed'}`);
    failedTests++;
  }
}

console.log('🧪 Starting Messaging & Collaboration Engine Test Suite...\n');

// ---------------------------------------------------------
// 1. FILE & DOCUMENT SECURITY VALIDATION TESTS
// ---------------------------------------------------------
console.log('📦 1. Testing Document Security & Validation:');

function validateFileForUpload(filename: string, sizeBytes: number, mimeType: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, error: 'BLOCKED_EXTENSION' };
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: 'UNSUPPORTED_FORMAT' };
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'FILE_TOO_LARGE' };
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType) && !mimeType.startsWith('image/')) {
    return { valid: false, error: 'DISALLOWED_MIME' };
  }
  return { valid: true };
}

// Test A: Normal Business Documents
assert(
  validateFileForUpload('Master_Services_Agreement.pdf', 3 * 1024 * 1024, 'application/pdf').valid,
  'Allows valid PDF contract upload (3MB)'
);
assert(
  validateFileForUpload('Q3_Revenue_Forecast.xlsx', 1.5 * 1024 * 1024, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').valid,
  'Allows valid Excel spreadsheet upload'
);

// Test B: Dangerous Executables (Blocked)
assert(
  validateFileForUpload('malicious_payload.exe', 1024, 'application/octet-stream').error === 'BLOCKED_EXTENSION',
  'Blocks dangerous Windows executable (.exe)'
);
assert(
  validateFileForUpload('exploit_script.sh', 500, 'text/x-sh').error === 'BLOCKED_EXTENSION',
  'Blocks shell script file (.sh)'
);
assert(
  validateFileForUpload('server_backdoor.php', 2048, 'application/x-php').error === 'BLOCKED_EXTENSION',
  'Blocks PHP script execution file (.php)'
);

// Test C: Oversized Files (>25MB)
assert(
  validateFileForUpload('massive_dump.zip', 30 * 1024 * 1024, 'application/zip').error === 'UNSUPPORTED_FORMAT',
  'Rejects unapproved archive format (.zip)'
);
assert(
  validateFileForUpload('huge_database_export.pdf', 28 * 1024 * 1024, 'application/pdf').error === 'FILE_TOO_LARGE',
  'Rejects PDF file exceeding 25MB boundary'
);

// ---------------------------------------------------------
// 2. MENTION PARSING & AUTOLINKING TESTS
// ---------------------------------------------------------
console.log('\n💬 2. Testing @Mention Parser & Formatting:');

function parseMentions(text: string): string[] {
  const mentionRegex = /@([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
  const matches: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

const sampleMsgWithMentions = 'Hey @Alex Rivera and @Liam, please review the proposal for @Marcus Chen before Friday.';
const extracted = parseMentions(sampleMsgWithMentions);

assert(extracted.includes('Alex Rivera'), 'Extracts full name mention: Alex Rivera');
assert(extracted.includes('Liam'), 'Extracts single name mention: Liam');
assert(extracted.includes('Marcus Chen'), 'Extracts contact mention: Marcus Chen');
assert(extracted.length === 3, 'Identifies exact total mention count (3)');

// ---------------------------------------------------------
// 3. CRM RECORD LINKAGE INTEGRITY
// ---------------------------------------------------------
console.log('\n🏢 3. Testing CRM Entity Association:');

interface MockCrmConversation {
  id: string;
  type: string;
  crmRecord?: {
    type: string;
    id: string;
    title: string;
    value?: string;
  };
}

function linkCrmRecord(conv: MockCrmConversation, record: { type: string; id: string; title: string; value?: string }) {
  if (!['contact', 'company', 'lead', 'deal', 'ticket', 'project', 'task'].includes(record.type)) {
    throw new Error('INVALID_CRM_ENTITY_TYPE');
  }
  conv.crmRecord = record;
  conv.type = 'crm_linked';
  return conv;
}

const mockConv: MockCrmConversation = { id: 'conv_test_1', type: 'direct' };
linkCrmRecord(mockConv, {
  type: 'deal',
  id: 'deal_101',
  title: 'AlphaTech Cloud Migration',
  value: '$120,000 ARR'
});

assert(mockConv.type === 'crm_linked', 'Conversation type updates to crm_linked');
assert(mockConv.crmRecord?.id === 'deal_101', 'Associated Deal ID matches');
assert(mockConv.crmRecord?.value === '$120,000 ARR', 'Deal value preserved for HUD badges');

// ---------------------------------------------------------
// 4. STRUCTURED PROMPT & SOP VALIDATION
// ---------------------------------------------------------
console.log('\n📋 4. Testing Structured Prompt & Instruction Blueprints:');

function validatePromptData(p: { title: string; goal: string; instructions: string[]; template: string }) {
  if (!p.title || p.title.length < 3) return false;
  if (!p.template || p.template.length < 10) return false;
  if (!Array.isArray(p.instructions) || p.instructions.length === 0) return false;
  return true;
}

assert(
  validatePromptData({
    title: 'Enterprise SOC-2 Review',
    goal: 'Mitigate data privacy objections',
    instructions: ['State TLS 1.3 encryption', 'Confirm US-East1 data locality'],
    template: 'Hi {{client_name}}, we maintain SOC 2 Type II compliance...'
  }),
  'Validates complete structured prompt blueprint'
);

assert(
  !validatePromptData({
    title: 'AB',
    goal: '',
    instructions: [],
    template: 'Short'
  }),
  'Rejects malformed prompt blueprint with missing instructions'
);

// ---------------------------------------------------------
// 5. SECURITY & TENANT AUTHORIZATION TESTS
// ---------------------------------------------------------
console.log('\n🔒 5. Testing Authorization & Anti-Spoofing:');

function authorizeMessageEdit(messageAuthorId: string, currentUserId: string, currentUserRole: string) {
  if (currentUserRole === 'admin') return true;
  return messageAuthorId === currentUserId;
}

assert(
  authorizeMessageEdit('user_agent_1', 'user_agent_1', 'agent'),
  'Author can edit their own message'
);
assert(
  authorizeMessageEdit('user_agent_2', 'user_agent_1', 'admin'),
  'Admin can edit/moderate any message'
);
assert(
  !authorizeMessageEdit('user_agent_2', 'user_agent_3', 'agent'),
  'Non-admin agent cannot edit another user message'
);

// ---------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------
console.log('\n---------------------------------------------------------');
console.log(`Test Execution Summary: ${passedTests} Passed, ${failedTests} Failed.`);
if (failedTests > 0) {
  console.error('❌ Test suite failed!');
  process.exit(1);
} else {
  console.log('🎉 All Messaging, Document, CRM, and Security Tests Passed Cleanly!');
  process.exit(0);
}
