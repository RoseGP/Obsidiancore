export interface ReceptionistQA {
  id: string;
  category: 'general' | 'pricing' | 'technical' | 'security' | 'routing' | 'policy' | 'custom';
  question: string;
  answer: string;
  keywords: string[];
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  updatedAt: string;
}

export interface ReceptionistDocument {
  id: string;
  title: string;
  category: string;
  rawContent: string;
  summary: string;
  extractedQAsCount: number;
  createdAt: string;
}

export interface DepartmentRoutingRule {
  departmentKey: 'sales' | 'support' | 'billing' | 'exec' | 'partnerships';
  name: string;
  title: string;
  leadPerson: string;
  extension: string;
  status: 'available' | 'in_meeting' | 'busy' | 'offline';
  triggers: string[];
  fallbackAction: 'take_message' | 'schedule_callback' | 'voicemail' | 'transfer_backup';
}

export interface ReceptionistCompanyProfile {
  companyName: string;
  tagline: string;
  industry: string;
  businessHours: string;
  timezone: string;
  address: string;
  visitorPolicy: string;
  emergencyPhone: string;
  defaultGreeting: string;
  agentName: string;
  voiceTone: 'executive' | 'friendly' | 'formal' | 'concierge';
  fallbackInstructions: string;
  maxResponseLengthWords: number;
}

export interface ReceptionistKnowledgeStore {
  profile: ReceptionistCompanyProfile;
  qas: ReceptionistQA[];
  documents: ReceptionistDocument[];
  departments: DepartmentRoutingRule[];
}

const INITIAL_PROFILE: ReceptionistCompanyProfile = {
  companyName: 'Obsidian Core Enterprise CRM',
  tagline: 'Zero-latency omnichannel communications & AI voice infrastructure',
  industry: 'Enterprise CRM & AI Communications',
  businessHours: 'Monday through Friday, 8:00 AM to 6:00 PM Pacific Time (PST)',
  timezone: 'America/Los_Angeles (PST/PDT)',
  address: '500 Howard Street, Suite 1400, San Francisco, CA 94105',
  visitorPolicy: 'Visitor badges prepared in advance at the ground floor security desk with valid government ID.',
  emergencyPhone: '+1 (800) 555-0199 (24/7 Critical Tier-1 SLA On-Call)',
  defaultGreeting: 'Thank you for calling Obsidian Core. My name is Sophia, how may I direct your call or assist you today?',
  agentName: 'Sophia',
  voiceTone: 'executive',
  fallbackInstructions: 'Warmly take caller name, phone number, and message, and promise an account executive callback within two business hours.',
  maxResponseLengthWords: 38,
};

const INITIAL_QAS: ReceptionistQA[] = [
  {
    id: 'qa-1',
    category: 'general',
    question: 'What are your business hours and operating schedule?',
    answer: 'Our main office is open Monday through Friday from 8:00 AM to 6:00 PM Pacific Time. We also have 24/7 on-call DevOps for enterprise tier clients.',
    keywords: ['hours', 'open', 'schedule', 'close', 'weekend', 'operating hours', 'time'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-action-1',
    category: 'custom',
    question: 'Can you start a video call or face-to-face consultation right now?',
    answer: 'Yes! I can initiate an encrypted WebRTC video conference room immediately. You can click Join Video Room on your screen to connect directly with audio and video.',
    keywords: ['video', 'video call', 'face to face', 'webrtc', 'zoom', 'camera', 'screen share', 'consultation', 'start video', 'switch to video'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-action-2',
    category: 'custom',
    question: 'Can you schedule a calendar event or meeting with your team?',
    answer: 'Absolutely. I can book an appointment directly into our CRM and Google Calendar for you or your team, complete with reminders and meeting invitations.',
    keywords: ['schedule', 'calendar', 'meeting', 'book', 'appointment', 'demo', 'time slot', 'calendar event', 'availability', 'schedule call', 'book demo'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-action-3',
    category: 'custom',
    question: 'Can you create a contract or customized proposal for my company?',
    answer: 'Certainly! I can draft a formal enterprise contract and proposal with tailored line items, deliverable milestones, and digital signature capabilities right away.',
    keywords: ['proposal', 'contract', 'agreement', 'draft proposal', 'create contract', 'quote', 'sow', 'statement of work', 'nda', 'create proposal', 'generate contract'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-2',
    category: 'general',
    question: 'Where is your corporate headquarters located?',
    answer: 'We are located at 500 Howard Street, Suite 1400, in downtown San Francisco, California 94105, two blocks from the Transbay Transit Center.',
    keywords: ['location', 'address', 'where', 'office', 'headquarters', 'directions', 'san francisco'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-3',
    category: 'pricing',
    question: 'What are your platform subscription plans and pricing?',
    answer: 'We offer Growth Tier at $1,200 per month, Scale Tier at $4,800 per month, and Custom Sovereign SLAs for enterprise deployments. Annual plans receive a 20% discount.',
    keywords: ['pricing', 'cost', 'plans', 'subscription', 'price', 'rates', 'discount', 'quote'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-4',
    category: 'security',
    question: 'What security, compliance, and encryption standards do you meet?',
    answer: 'We are SOC 2 Type II certified, HIPAA compliant, ISO 27001 certified, and implement zero-trust end-to-end encryption across all voice and WebRTC channels.',
    keywords: ['security', 'soc2', 'hipaa', 'iso', 'encryption', 'compliance', 'privacy', 'gdpr'],
    enabled: true,
    priority: 'high',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-5',
    category: 'technical',
    question: 'Which communication channels and messaging apps are supported?',
    answer: 'We natively support WhatsApp Business API, Telegram, Twilio SMS and MMS, Live WebRTC Video, SIP Voice, Gmail, Microsoft 365, and Instagram Direct Messaging.',
    keywords: ['channels', 'whatsapp', 'telegram', 'sms', 'video', 'integrations', 'email', 'instagram'],
    enabled: true,
    priority: 'medium',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-6',
    category: 'policy',
    question: 'Do you offer a trial period or money-back guarantee?',
    answer: 'Yes, we provide a 14-day zero-risk trial with full engineering onboarding, backed by a 30-day money-back guarantee on all growth and scale contracts.',
    keywords: ['trial', 'guarantee', 'refund', 'cancellation', 'poc', 'free trial', 'demo'],
    enabled: true,
    priority: 'medium',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-7',
    category: 'technical',
    question: 'What is your voice stream transcription and dialer latency?',
    answer: 'Our proprietary voice pipelines achieve sub-50 millisecond roundtrip latency with real-time Speech-To-Text and adaptive Gemini neural conversational synthesis.',
    keywords: ['latency', 'voice latency', 'stt', 'tts', 'speed', 'real-time', 'lag'],
    enabled: true,
    priority: 'medium',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'qa-8',
    category: 'general',
    question: 'How do visitor badges and building access work?',
    answer: 'Visitors can check in at the ground floor lobby kiosk with a valid government photo ID. Please notify your host in advance for automated badge pre-clearance.',
    keywords: ['visitors', 'parking', 'badge', 'building', 'lobby', 'check in', 'access'],
    enabled: true,
    priority: 'low',
    updatedAt: new Date().toISOString()
  }
];

// TO COMPLETE: knowledge documents are uploaded by the business in Train Knowledge; none are pre-filled.
const INITIAL_DOCUMENTS: ReceptionistDocument[] = [];

// TO COMPLETE: departments are configured by the business (routing numbers, hours).
const INITIAL_DEPARTMENTS: DepartmentRoutingRule[] = [];

class ReceptionistKnowledgeManager {
  private store: ReceptionistKnowledgeStore;

  constructor() {
    this.store = {
      profile: { ...INITIAL_PROFILE },
      qas: [...INITIAL_QAS],
      documents: [...INITIAL_DOCUMENTS],
      departments: [...INITIAL_DEPARTMENTS]
    };
  }

  public getStore(): ReceptionistKnowledgeStore {
    return this.store;
  }

  public updateProfile(updated: Partial<ReceptionistCompanyProfile>): ReceptionistCompanyProfile {
    this.store.profile = {
      ...this.store.profile,
      ...updated
    };
    return this.store.profile;
  }

  public addQA(qa: Omit<ReceptionistQA, 'id' | 'updatedAt'>): ReceptionistQA {
    const newQA: ReceptionistQA = {
      id: `qa-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...qa,
      updatedAt: new Date().toISOString()
    };
    this.store.qas.unshift(newQA);
    return newQA;
  }

  public updateQA(id: string, updates: Partial<ReceptionistQA>): ReceptionistQA | null {
    const idx = this.store.qas.findIndex(q => q.id === id);
    if (idx === -1) return null;
    this.store.qas[idx] = {
      ...this.store.qas[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    return this.store.qas[idx];
  }

  public deleteQA(id: string): boolean {
    const prevLen = this.store.qas.length;
    this.store.qas = this.store.qas.filter(q => q.id !== id);
    return this.store.qas.length < prevLen;
  }

  public addDocument(doc: Omit<ReceptionistDocument, 'id' | 'createdAt'>): ReceptionistDocument {
    const newDoc: ReceptionistDocument = {
      id: `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...doc,
      createdAt: new Date().toISOString()
    };
    this.store.documents.unshift(newDoc);
    return newDoc;
  }

  public deleteDocument(id: string): boolean {
    const prevLen = this.store.documents.length;
    this.store.documents = this.store.documents.filter(d => d.id !== id);
    return this.store.documents.length < prevLen;
  }

  public updateDepartment(deptKey: DepartmentRoutingRule['departmentKey'], updates: Partial<DepartmentRoutingRule>): DepartmentRoutingRule | null {
    const idx = this.store.departments.findIndex(d => d.departmentKey === deptKey);
    if (idx === -1) return null;
    this.store.departments[idx] = {
      ...this.store.departments[idx],
      ...updates
    };
    return this.store.departments[idx];
  }

  public resetToDefaults(): ReceptionistKnowledgeStore {
    this.store = {
      profile: { ...INITIAL_PROFILE },
      qas: [...INITIAL_QAS],
      documents: [...INITIAL_DOCUMENTS],
      departments: [...INITIAL_DEPARTMENTS]
    };
    return this.store;
  }

  /**
   * Generates a rich, structured prompt context string to feed directly into Gemini's system instructions
   */
  public buildKnowledgeContext(): string {
    const { profile, qas, departments, documents } = this.store;

    const enabledQAs = qas.filter(q => q.enabled);
    const qaContext = enabledQAs.map((q, i) => 
      `Q${i+1} [${q.category.toUpperCase()}]: "${q.question}"\nA${i+1}: "${q.answer}"`
    ).join('\n\n');

    const deptContext = departments.map(d => 
      `- ${d.name} (${d.leadPerson}, Ext: ${d.extension}, Status: ${d.status === 'in_meeting' ? 'IN MEETING (Take Message)' : 'AVAILABLE'}). Triggers: ${d.triggers.join(', ')}`
    ).join('\n');

    const docContext = documents.map(doc => 
      `[DOCUMENT: ${doc.title} (${doc.category})]\n${doc.summary || doc.rawContent.slice(0, 300)}`
    ).join('\n\n');

    return `
========================================
TRAINED AI RECEPTIONIST KNOWLEDGE BASE:
========================================
COMPANY INFORMATION:
- Company Name: ${profile.companyName}
- Industry: ${profile.industry}
- Tagline: ${profile.tagline}
- Operating Business Hours: ${profile.businessHours}
- Timezone: ${profile.timezone}
- Corporate Address: ${profile.address}
- Building & Visitor Access: ${profile.visitorPolicy}
- 24/7 Critical SLA Hotline: ${profile.emergencyPhone}
- Tone of Voice: ${profile.voiceTone} (Max spoken sentence length: ~${profile.maxResponseLengthWords} words)
- Opening Spoken Greeting: "${profile.defaultGreeting}"
- Fallback Handling: ${profile.fallbackInstructions}

AUTONOMOUS ACTION EXECUTION CAPABILITIES:
You are fully trained to execute business actions when the caller or client requests them:
1. START A VIDEO CALL: If the user asks to start/switch to a video call or consultation, immediately confirm you are launching an encrypted WebRTC video conference room.
2. SCHEDULE A CALENDAR EVENT: If the user asks to schedule a meeting, demo, or appointment on a specific day/time, confirm the booking and extract date, time, duration, and guests.
3. CREATE A CONTRACT OR PROPOSAL: If the user asks to draft/create a proposal or contract, formulate the business scope, line items, pricing tiers, and e-signature preparation.

DEPARTMENT SPECIALISTS & WARM TRANSFER DIRECTORY:
${deptContext}

TRAINED Q&A KNOWLEDGE BASE (${enabledQAs.length} VERIFIED ENTRIES):
${qaContext}

ADDITIONAL INGESTED COMPANY KNOWLEDGE:
${docContext}
========================================
`;
  }
}

export const receptionistKnowledgeDb = new ReceptionistKnowledgeManager();
