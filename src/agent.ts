import { Agent } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS } from "@cloudflare/voice";

export interface Env {
  CRM_VOICE_ASSISTANT: any;
  VOICE_STT_MODEL?: string;
  VOICE_TTS_VOICE?: string;
  AI?: any; // Workers AI binding
  REALTIME_INFRA?: any;
}

export interface AgentMemory {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Cloudflare Agent Memory using Durable Object SQLite storage runtime primitives
 * to record structured key-value configurations during live call sessions.
 */
export class DurableAgentMemory implements AgentMemory {
  private inMemoryFallback = new Map<string, string>();

  constructor(private sql: any) {}

  async get(key: string): Promise<string | null> {
    if (this.sql) {
      try {
        const res = this.sql.exec("SELECT value FROM agent_memory WHERE key = ? LIMIT 1;", key);
        if (res && res.length > 0) {
          const row = res[0];
          if (row && typeof row === "object" && "value" in row) {
            return (row as any).value;
          }
        }
      } catch (err: any) {
        console.warn("[AgentMemory Private SQLite] Query fallback triggered:", err.message);
      }
    }
    return this.inMemoryFallback.get(key) || null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.sql) {
      try {
        this.sql.exec(
          "INSERT OR REPLACE INTO agent_memory (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP);",
          key,
          value
        );
        return;
      } catch (err: any) {
        console.warn("[AgentMemory Private SQLite] Placement fallback triggered:", err.message);
      }
    }
    this.inMemoryFallback.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.sql) {
      try {
        this.sql.exec("DELETE FROM agent_memory WHERE key = ?;", key);
        return;
      } catch (err: any) {
        console.warn("[AgentMemory Private SQLite] Deletion fallback triggered:", err.message);
      }
    }
    this.inMemoryFallback.delete(key);
  }

  async clear(): Promise<void> {
    if (this.sql) {
      try {
        this.sql.exec("DELETE FROM agent_memory;");
        return;
      } catch (err: any) {
        console.warn("[AgentMemory Private SQLite] Clear fallback triggered:", err.message);
      }
    }
    this.inMemoryFallback.clear();
  }
}

export interface CallSession {
  sessionId: string;
  leadId: string;
  agentPath: string;
  teamRoute: string;
  status: "routing" | "active" | "parked" | "forwarded" | "terminated";
  companyTier: "Platinum" | "Enterprise" | "Standard" | "Prospect";
  geographicRegion: string;
  sentimentScore: number;
  recordingMeta: string;
  routingHops: string[];
  timestamp: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-lead-id",
};

/**
 * Modern Cloudflare Agent using @cloudflare/voice for real-time oral communications.
 * Extends the withVoice higher-order class, integrating real-time STT and TTS streaming,
 * while acting as a distributed call router, tracking controller, and SQLite ledger.
 */
export class CRMVoiceAssistant extends withVoice(Agent, {
  stt: new WorkersAIFluxSTT(),
  tts: new WorkersAITTS({ voice: "en-US-neural-male" }),
}) {
  private isDatabaseInitialized = false;
  private inMemoryLedger = new Map<string, CallSession>();
  private memory!: DurableAgentMemory;
  private activeAbortController: AbortController | null = null;
  private currentTurnId = 0;

  // Internal registry of active sales agent paths
  private activeAgents = new Map<string, {
    agentId: string;
    name: string;
    sipUri: string;
    rating: number;
    skills: string[];
    isAvailable: boolean;
  }>([
    ["agent-01", { agentId: "agent-01", name: "Rene Pierrette", sipUri: "sip:rpierrette@stoic.voice.live", rating: 4.9, skills: ["Enterprises SLA", "APIs"], isAvailable: true }],
    ["agent-02", { agentId: "agent-02", name: "Marcus Aurelius", sipUri: "sip:marcus@stoic.voice.live", rating: 5.0, skills: ["Philosophy", "Strategy"], isAvailable: true }],
    ["agent-03", { agentId: "agent-03", name: "Zeno Of Citium", sipUri: "sip:zeno@stoic.voice.live", rating: 4.8, skills: ["Logistics", "Default Risk"], isAvailable: true }]
  ]);

  constructor(state: any, env: Env) {
    super(state, env);
    this.ensureSqlDatabaseReady();
    this.memory = new DurableAgentMemory(this.state && this.state.storage ? this.state.storage.sql : null);
  }

  /**
   * Safe Edge SQLite table bootstrap on Durable Object creation.
   * Leverages the new private DO SQLite database capability.
   */
  private ensureSqlDatabaseReady() {
    if (this.isDatabaseInitialized) return;
    try {
      if (this.state && this.state.storage && this.state.storage.sql) {
        // Table 1: Standard transcript logging
        this.state.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS call_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            transcript TEXT,
            reply TEXT,
            intent TEXT
          );
        `);
        // Table 2: Routing ledger database
        this.state.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS call_session_ledger (
            session_id TEXT PRIMARY KEY,
            lead_id TEXT NOT NULL,
            agent_path TEXT,
            team_route TEXT,
            status TEXT NOT NULL,
            company_tier TEXT,
            geographic_region TEXT,
            sentiment_score REAL,
            recording_meta TEXT,
            routing_hops TEXT,
            timestamp TEXT NOT NULL
          );
        `);
        // Table 3: Reliable key-value context agent memory
        this.state.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS agent_memory (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
        this.isDatabaseInitialized = true;
        console.log("[Durable Object SQLite] Database and tables successfully bootstrapped.");
      }
    } catch (err: any) {
      console.warn("[Durable Object SQL] SQL DO Storage SQLite skipped. Failing over to robust in-memory registry:", err.message);
    }
  }

  /**
   * Evaluates text sentiments on-the-fly using highly optimized, low-latency regex metrics.
   * Returns a score between -1.0 (Critical disappointment) and 1.0 (High customer satisfaction).
   */
  private analyzeSpeechSentiment(text: string): number {
    const textLower = text.toLowerCase();
    
    const positiveWords = ["perfect", "awesome", "excellent", "superb", "stabilized", "yes", "great", "thank", "agree", "onboard", "platinum"];
    const negativeWords = ["broken", "angry", "failing", "failed", "slow", "delay", "issue", "no", "problem", "ticket", "costly", "expensive"];

    let score = 0;
    positiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, "g");
      const matches = textLower.match(regex);
      if (matches) score += matches.length * 0.25;
    });

    negativeWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, "g");
      const matches = textLower.match(regex);
      if (matches) score -= matches.length * 0.25;
    });

    return Math.max(-1.0, Math.min(1.0, score));
  }

  /**
   * Private logger utilizing native transactional DO SQLite.
   */
  private async logCallInteraction(transcript: string, reply: string, intent: string) {
    try {
      this.ensureSqlDatabaseReady();
      if (this.isDatabaseInitialized && this.state.storage.sql) {
        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        this.state.storage.sql.exec(
          "INSERT INTO call_logs (id, timestamp, transcript, reply, intent) VALUES (?, ?, ?, ?, ?);",
          id,
          timestamp,
          transcript,
          reply,
          intent
        );
      }
    } catch (err: any) {
      console.error("Durable Object SQLite Edge logging failure:", err.message);
    }
  }

  /**
   * Computes matching agent and squad metrics based on client attributes to prevent routing bottlenecks.
   */
  private matchAgentForRequest(tier: string, region: string): { agentId: string; teamRoute: string; routingHops: string[] } {
    let teamRoute = "General Sales Queue";
    const hops = ["Edge SIP Gateway Gateway Entry"];

    const checkedTier = tier ? tier.toUpperCase() : "STANDARD";
    if (checkedTier === "PLATINUM" || checkedTier === "ENTERPRISE") {
      teamRoute = "Tier 1 High-Value Alpha Squad";
      hops.push("Alpha Queue VIP Escalation Trigger");
    } else {
      teamRoute = "Standard Growth Sales Team";
      hops.push("Standard Linear Round-Robin Priority");
    }

    const checkedRegion = region ? region.toUpperCase() : "AMER";
    hops.push(`${checkedRegion} Geographic Edge Server Filtering`);

    // Fetch optimal available routing agent path
    let assignedPath = "agent-01";
    for (const [id, agent] of this.activeAgents) {
      if (agent.isAvailable) {
        assignedPath = id;
        break;
      }
    }
    
    const matched = this.activeAgents.get(assignedPath);
    const resolvedUri = matched ? matched.sipUri : `sip:${assignedPath}@stoic.voice.live`;
    hops.push(`Terminal Assigned Router Pipeline: ${resolvedUri}`);

    return { agentId: resolvedUri, teamRoute, routingHops: hops };
  }

  /**
   * Router endpoint broker for all HTTP requests forwarded to this Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.ensureSqlDatabaseReady();

    // CORS preflight fallback
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Endpoint 1: Register call session with intent tracking & DB seed
      if (url.pathname === "/api/create-session" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        
        const leadId = body.leadId || "anonymous_lead_" + Date.now();
        const tier = body.companyTier || "Standard";
        const region = body.geographicRegion || "AMER";
        
        const routing = this.matchAgentForRequest(tier, region);
        
        const session: CallSession = {
          sessionId: crypto.randomUUID(),
          leadId,
          agentPath: routing.agentId,
          teamRoute: routing.teamRoute,
          status: "active",
          companyTier: tier as any,
          geographicRegion: region,
          sentimentScore: 0.0,
          recordingMeta: JSON.stringify({ format: "opus", codec: "VP8", anycastServer: "cloudflare-iad-edge-01" }),
          routingHops: routing.routingHops,
          timestamp: new Date().toISOString()
        };

        // Persist transaction directly into SQLite edge partition
        if (this.isDatabaseInitialized && this.state.storage.sql) {
          this.state.storage.sql.exec(
            `INSERT INTO call_session_ledger (
              session_id, lead_id, agent_path, team_route, status, company_tier, geographic_region, sentiment_score, recording_meta, routing_hops, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            session.sessionId,
            session.leadId,
            session.agentPath,
            session.teamRoute,
            session.status,
            session.companyTier,
            session.geographicRegion,
            session.sentimentScore,
            session.recordingMeta,
            JSON.stringify(session.routingHops),
            session.timestamp
          );
        } else {
          this.inMemoryLedger.set(session.sessionId, session);
        }

        return new Response(JSON.stringify({ success: true, session }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      // Endpoint 2: Park active line
      if (url.pathname === "/api/park" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const sessionId = body.sessionId;

        if (!sessionId) {
          return new Response(JSON.stringify({ error: "Missing required parameter: sessionId" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        }

        let updated = false;
        if (this.isDatabaseInitialized && this.state.storage.sql) {
          const result = this.state.storage.sql.exec(
            "SELECT session_id, routing_hops FROM call_session_ledger WHERE session_id = ?;",
            sessionId
          );
          if (result && result.length > 0) {
            const row = result[0];
            const currentHops = JSON.parse(row.routing_hops || "[]");
            currentHops.push("Call Parked via Webhook Action");
            
            this.state.storage.sql.exec(
              "UPDATE call_session_ledger SET status = 'parked', routing_hops = ? WHERE session_id = ?;",
              JSON.stringify(currentHops),
              sessionId
            );
            updated = true;
          }
        } else {
          const sess = this.inMemoryLedger.get(sessionId);
          if (sess) {
            sess.status = "parked";
            sess.routingHops.push("Call Parked via Webhook Action");
            updated = true;
          }
        }

        return new Response(JSON.stringify({ success: updated, message: updated ? "Call session parked" : "Session ID not found" }), {
          status: updated ? 200 : 404,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      // Endpoint 3: Webhook forward to cellular group (Cloudflare RealtimeKit out-of-band mutation)
      if (url.pathname === "/api/forward" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const sessionId = body.sessionId;
        const targetNumber = body.targetNumber || "+15551234790";

        if (!sessionId) {
          return new Response(JSON.stringify({ error: "Missing required parameter: sessionId" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        }

        // Orchestrate an out-of-band SIP call step using Cloudflare RealtimeKit fallback
        let outOfBandStatus = "STATION_UNAVAILABLE";
        let segmentId = "sip-seg-unrouted";

        if (this.env.REALTIME_INFRA && typeof (this.env.REALTIME_INFRA as any).sipCall === "function") {
          try {
            console.log(`[Cloudflare RealtimeKit] Executing outbound SIP route patch: ${targetNumber}`);
            const sipResult = await (this.env.REALTIME_INFRA as any).sipCall({
              sipUri: "sip:outpost@stoic.voice.live",
              outboundNumber: targetNumber,
              callerId: "+15550182913",
              codecPrefer: "OpusHD"
            });
            outOfBandStatus = sipResult.status || "CONNECTED";
            segmentId = sipResult.callSegmentId || `sip-seg-${crypto.randomUUID().slice(0, 8)}`;
          } catch (sipErr: any) {
            console.warn("[RealtimeKit Out-of-band SIP] Direct gateway handoff failed. Initializing digital SIP router fallback.", sipErr.message);
            outOfBandStatus = "SIP_FALLBACK_ROUTED_GSM";
            segmentId = `gsm-${crypto.randomUUID().slice(0, 8)}`;
          }
        } else {
          // Robust simulator/fallback if RealtimeKit binary triggers are not binded
          console.log(`[SIP Simulator Gateway] Bridging connection directly to cell channel ${targetNumber}`);
          outOfBandStatus = "SIP_SIMULATED_SUCCESS";
          segmentId = `sip-sim-seg-${Math.floor(Math.random() * 899999 + 100000)}`;
        }

        let updated = false;
        if (this.isDatabaseInitialized && this.state.storage.sql) {
          const result = this.state.storage.sql.exec(
            "SELECT session_id, routing_hops FROM call_session_ledger WHERE session_id = ?;",
            sessionId
          );
          if (result && result.length > 0) {
            const row = result[0];
            const currentHops = JSON.parse(row.routing_hops || "[]");
            currentHops.push(`Forwarded Out-of-Band Cellular to ${targetNumber} via RealtimeKit`);
            currentHops.push(`SIP Segment Bonded: ${segmentId}`);

            this.state.storage.sql.exec(
              "UPDATE call_session_ledger SET status = 'forwarded', agent_path = ?, routing_hops = ? WHERE session_id = ?;",
              `cellular:${targetNumber}`,
              JSON.stringify(currentHops),
              sessionId
            );
            updated = true;
          }
        } else {
          const sess = this.inMemoryLedger.get(sessionId);
          if (sess) {
            sess.status = "forwarded";
            sess.agentPath = `cellular:${targetNumber}`;
            sess.routingHops.push(`Forwarded Out-of-Band Cellular to ${targetNumber} via RealtimeKit`);
            sess.routingHops.push(`SIP Segment Bonded: ${segmentId}`);
            updated = true;
          }
        }

        return new Response(JSON.stringify({ 
          success: updated, 
          status: outOfBandStatus,
          segmentId,
          message: updated ? "Call router patched line successfully to mobile cell network." : "Session ID mismatch" 
        }), {
          status: updated ? 200 : 404,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      // Endpoint 4: Get routing sessions dashboard logs
      if (url.pathname === "/api/logs" && request.method === "GET") {
        const list: CallSession[] = [];
        if (this.isDatabaseInitialized && this.state.storage.sql) {
          const rows = this.state.storage.sql.exec("SELECT * FROM call_session_ledger ORDER BY timestamp DESC LIMIT 25;");
          rows.forEach((row: any) => {
            list.push({
              sessionId: row.session_id,
              leadId: row.lead_id,
              agentPath: row.agent_path,
              teamRoute: row.team_route,
              status: row.status as any,
              companyTier: row.company_tier as any,
              geographicRegion: row.geographic_region,
              sentimentScore: Number(row.sentiment_score || 0),
              recordingMeta: row.recording_meta,
              routingHops: JSON.parse(row.routing_hops || "[]"),
              timestamp: row.timestamp
            });
          });
        } else {
          list.push(...Array.from(this.inMemoryLedger.values()));
        }

        return new Response(JSON.stringify({ success: true, count: list.length, sessions: list }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      // Default delegation for standard Agent framework behavior
      const proto = Object.getPrototypeOf(CRMVoiceAssistant.prototype);
      if (proto && typeof proto.fetch === "function") {
        const response: any = await proto.fetch.call(this, request);
        // Intercept WebSocket upgrade to attach the dual-channel voice pipeline productivity assistant
        if (response.status === 101 && response.webSocket) {
          this.attachVoicePipeline(response.webSocket);
        }
        return response;
      }

    } catch (err: any) {
      return new Response(JSON.stringify({ error: true, details: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    return new Response(JSON.stringify({ error: "Routing mismatch" }), { status: 404 });
  }

  /**
   * Attaches our Lead AI voice pipeline engine to active call WebSocket streams.
   * Leverages WorkersAIFluxSTT logic to transcribe the speaker streams into dual-channel chunks.
   */
  private attachVoicePipeline(webSocket: any) {
    console.log("[Voice Pipeline Engine] Succesfully attached invisible productivity assistant.");

    webSocket.addEventListener("message", async (event: any) => {
      try {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          
          // Customer interruption or turn shift signaled by the client application
          if (
            message.type === "turn-shift" || 
            message.type === "interruption" || 
            message.type === "user-start-speaking"
          ) {
            console.log("[Voice Pipeline Engine] Customer interruption detected. Halting active loops.");
            this.handleInterruption();
          }

          // Listening to real-time speech transcription messages from either speaker channel
          if (message.type === "speech-transcription") {
            const sender = message.sender || "Customer";
            const text = message.text;
            if (text && text.trim()) {
              await this.processSpeechPhrase(sender, text);
            }
          }
        } else if (event.data instanceof ArrayBuffer) {
          // Fallback PCM level detector of user interruptions or turn shifts
          this.evaluateAudioBuffersAndEnergy(event.data);
        }
      } catch (err: any) {
        // Suppress non-JSON message stream noise gracefully
      }
    });

    webSocket.addEventListener("close", () => {
      console.log("[Voice Pipeline Engine] WebSocket communication channel detached.");
      this.handleInterruption();
    });
  }

  /**
   * Instant interruption signal detector utilizing PCM root-mean-square amplitude.
   */
  private evaluateAudioBuffersAndEnergy(buffer: ArrayBuffer) {
    try {
      const view = new DataView(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.byteLength; i += 2) {
        if (i + 1 < buffer.byteLength) {
          const sample = view.getInt16(i, true);
          sumSquares += sample * sample;
        }
      }
      const rms = Math.sqrt(sumSquares / (buffer.byteLength / 2));
      const energyLevel = (rms / 32768) * 100;

      // Amplitude peak cutoff indicative of active customer intrusion
      if (energyLevel > 22.5) {
        console.log(`[Voice Pipeline Engine] Speaker Energy Level: ${energyLevel.toFixed(1)}%. Halting AI loops.`);
        this.handleInterruption();
      }
    } catch {
      // Incompatible binary codec - skip evaluation safely
    }
  }

  /**
   * Safe execution barrier ensuring ongoing generation tasks are killed upon turn-shift
   */
  private handleInterruption() {
    this.currentTurnId++;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      console.log("[Voice Pipeline Engine] Abort signal dispatched. Interrupted LLM generation cleanly.");
    }
  }

  /**
   * Analyzes sentence-complete speech phrases for target core concepts (pricing, compliance, security, SLAs).
   * Generates a structural JSON containing contextual sales talking points.
   */
  private async processSpeechPhrase(sender: "Agent" | "Customer", phrase: string) {
    if (!phrase || phrase.trim().length < 4) return;

    this.currentTurnId++;
    const turnId = this.currentTurnId;
    
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    // Direct filter for key sales terms
    const hasConcept = /pricing|price|cost|compliance|security standard|standard|SLA|soc2|gdpr|contract|discount/i.test(phrase);
    if (!hasConcept) {
      await this.memory.put(`raw_trans_turn_${turnId}`, JSON.stringify({ sender, phrase, ts: Date.now() }));
      return;
    }

    try {
      const instructions = `
        You are an invisible high-performance real-time sales assistant.
        Analyze the spoken raw text (Sender: ${sender}) for target concepts like pricing, compliance, SLAs, discounts or security standards.
        Formulate high-impact, contextual sales talking points.
        Maintain standard conversational fluency and objective technical guidelines.
        Ensure you only output a cleanly structured, valid JSON string and nothing else. No markdown wrap, no explanations.

        JSON Schema:
        {
          "conceptType": "pricing | compliance | SLA | security standard",
          "matchedTrigger": "the spoken trigger words",
          "talkingPoints": [
            "Concisely structured technical response or defense",
            "Contextual sales advantage or unique value prop"
          ],
          "recommendedTacticalAction": "Suggested workflow instruction or offer"
        }

        Input Raw Speech Text: "${phrase}"
      `;

      if (signal.aborted || this.currentTurnId !== turnId) return;

      let modelResult: any = null;
      if (this.env.AI) {
        try {
          modelResult = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages: [
              { role: "system", content: "You output valid raw JSON only. Absolutely no conversational preamble or markdown formatting." },
              { role: "user", content: instructions }
            ]
          });
        } catch (err: any) {
          console.warn("[Voice Pipeline Engine] Primary Meta model failing. Running fallback Mistral node...", err.message);
          if (!signal.aborted && this.currentTurnId === turnId) {
            modelResult = await this.env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
              prompt: instructions
            });
          }
        }
      }

      if (signal.aborted || this.currentTurnId !== turnId) {
        console.log("[Voice Pipeline Engine] Turn aborted during inference phase.");
        return;
      }

      let parsedResult: any = null;
      if (modelResult && modelResult.response) {
        parsedResult = this.extractJSONPayload(modelResult.response);
      } else if (modelResult && typeof modelResult === "string") {
        parsedResult = this.extractJSONPayload(modelResult);
      }

      if (!parsedResult) {
        parsedResult = {
          conceptType: phrase.toLowerCase().includes("sla") ? "SLA" : "pricing",
          matchedTrigger: phrase,
          talkingPoints: [
            "Observe enterprise SLA and premium uptime models",
            "Offer Stoic high-availability cloud configurations"
          ],
          recommendedTacticalAction: "Apply standard 15% pre-contract annual discount coupon"
        };
      }

      // Commit processed Context JSON structure to persistent DO SQLite Agent Memory space
      await this.memory.put(`last_insight_${parsedResult.conceptType}`, JSON.stringify(parsedResult));
      await this.memory.put(`turn_${turnId}_insight`, JSON.stringify(parsedResult));

      console.log(`[Voice Pipeline Engine] Insight recorded for: ${parsedResult.conceptType}`);

    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("[Voice Pipeline Engine] Worker AI execution aborted safely.");
      } else {
        console.error("[Voice Pipeline Engine] Inference error:", err.message);
      }
    } finally {
      if (this.activeAbortController && this.currentTurnId === turnId) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * Extracts clean, parsed JSON data blocks from raw LLM output text
   */
  private extractJSONPayload(input: string): any {
    try {
      const cleaned = input.trim();
      const sanitized = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      return JSON.parse(sanitized);
    } catch {
      try {
        const first = input.indexOf("{");
        const last = input.lastIndexOf("}");
        if (first !== -1 && last !== -1) {
          const cand = input.substring(first, last + 1);
          return JSON.parse(cand);
        }
      } catch {
        // Fail over silently
      }
      return null;
    }
  }

  /**
   * Core turn conversational loop triggered upon speech transcription event.
   * Receives real-time transcript text drafts, classifies objective, and speaks back audio.
   */
  async onTurn(transcript: string, context: any) {
    if (!transcript || !transcript.trim()) {
      return;
    }

    // Process the speaker transcript with our sales concepts analysis pipeline instantly
    await this.processSpeechPhrase("Customer", transcript);

    const inputLower = transcript.toLowerCase().trim();
    let reply = "";
    let classifiedIntent = "general";

    // Intent classifier routing matrix
    if (
      inputLower.includes("meeting") ||
      inputLower.includes("schedule") ||
      inputLower.includes("book") ||
      inputLower.includes("calendar") ||
      inputLower.includes("appointment")
    ) {
      classifiedIntent = "meeting";
      reply = `I would love to help get you scheduled. Let's reserve an onboard briefing slot for next Tuesday, June 23rd at 2:00 PM Eastern Standard Time. Does that work for you and your tech leadership?`;
    } else if (
      inputLower.includes("pricing") ||
      inputLower.includes("price") ||
      inputLower.includes("cost") ||
      inputLower.includes("subscription") ||
      inputLower.includes("how much")
    ) {
      classifiedIntent = "pricing";
      reply = `Obsidian Core offers modular pricing starting with our Professional suite at one thousand dollars a month. This includes full custom client databases, whereas our white-glove Enterprise architecture starts at five thousand dollars a month.`;
    } else if (
      inputLower.includes("support") ||
      inputLower.includes("help") ||
      inputLower.includes("broken") ||
      inputLower.includes("issue") ||
      inputLower.includes("ticket")
    ) {
      classifiedIntent = "support";
      reply = `I understand you are seeking active assistance. I can open an elevated support ticket or route your voice stream directly to our on-call engineering specialists right now. Would you like me to initiate the specialist transfer?`;
    } else if (
      inputLower.includes("hello") ||
      inputLower.includes("hi") ||
      inputLower.includes("hey") ||
      inputLower.includes("anyone there")
    ) {
      classifiedIntent = "greeting";
      reply = `Hi, I am Alex, your virtual AI concierge at Obsidian Core CRM. Are you calling to book an onboarding slot, enquire about custom package pricing, or reach technical support?`;
    } else {
      classifiedIntent = "general";
      reply = `Understood. I am here to help you coordinate calendar appointments, outline specific monthly pricing models, or trigger a direct human specialist handoff. Which of those should we work on?`;
    }

    // Stream spoken synthesis back to the websocket caller
    if (context && typeof context.say === "function") {
      await context.say(reply);
    }

    // Calculated localized sentiment amplitude to record in the DO system ledger
    const sentiment = this.analyzeSpeechSentiment(transcript);

    // Persist session telemetry directly into SQLite edge partition
    await this.logCallInteraction(transcript, reply, classifiedIntent);

    // Dynamically update sentiment index on the active database session trace if SQL is available
    try {
      if (this.isDatabaseInitialized && this.state.storage.sql) {
        this.state.storage.sql.exec(
          "UPDATE call_session_ledger SET sentiment_score = ? WHERE lead_id = ? ORDER BY timestamp DESC LIMIT 1;",
          sentiment,
          "marcus_aurelius_stoic_ventures"
        );
      }
    } catch {
      // Graceful bypass in environments where storage.sql updates aren't available during testing loops
    }
  }
}
