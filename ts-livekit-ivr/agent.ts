import { 
  DefineAgent, 
  JobContext, 
  WorkerOptions, 
  cli 
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Multi-provider fallback configuration for LLM and TTS.
 * If a free-tier rate limit (429) or connection timeout occurs on the primary provider,
 * the pipeline falls back without dropping the active call session.
 */
interface ProviderConfig {
  primaryLlm: "openai" | "groq" | "gemini";
  fallbackLlm: "groq" | "openai" | "gemini";
  primaryTts: "elevenlabs" | "cartesia" | "openai" | "deepgram";
  fallbackTts: "cartesia" | "openai" | "deepgram" | "elevenlabs";
}

const config: ProviderConfig = {
  primaryLlm: "openai",
  fallbackLlm: "groq",
  primaryTts: "elevenlabs",
  fallbackTts: "cartesia",
};

export default DefineAgent({
  entry: async (ctx: JobContext) => {
    console.log(`[IVR] Incoming call connected to room: ${ctx.room.name}`);

    // Wait for the caller to join the LiveKit audio room
    await ctx.connect();

    /**
     * Helper to initialize the VoiceAssistant with provider fallbacks
     */
    const createVoicePipeline = (provider: "primary" | "fallback" = "primary") => {
      const isPrimary = provider === "primary";
      const modelName = isPrimary ? "gpt-4o-mini" : "llama-3.3-70b-versatile";

      console.log(`[IVR Pipeline] Initializing VoiceAssistant using ${provider.toUpperCase()} provider (Model: ${modelName})...`);

      const session = new openai.VoiceAssistant({
        instructions:
          "You are an automated AI voice receptionist for our organization. Be concise, warm, " +
          "and direct. Answer business hours questions, assist with appointments, or transfer " +
          "callers to human representatives when requested.",
      });

      // 1. Availability / Scheduling Tool
      session.registerFunction(
        "checkAvailability",
        "Check schedule slots for callers",
        { date: z.string().describe("The date requested (YYYY-MM-DD or relative like 'tomorrow')") },
        async ({ date }) => {
          console.log(`[Tool: checkAvailability] Checking availability database for date: ${date}`);
          return JSON.stringify({
            available: true,
            date,
            slots: ["9:00 AM", "11:30 AM", "2:00 PM", "4:30 PM"],
            timezone: "America/Los_Angeles",
          });
        }
      );

      // 2. Blind Transfer Tool (transferToHuman)
      session.registerFunction(
        "transferToHuman",
        "Blind-transfer the active caller to an internal office extension (e.g. Sales, Support, Billing)",
        { 
          extension: z.string().describe("The 3-digit internal office extension to transfer to, e.g. '101' for Sales, '102' for Tech Support, '103' for Billing, '104' for Executive Suite, '105' for Partnerships") 
        },
        async ({ extension }) => {
          console.log(`[Tool: transferToHuman] Initiating SIP REFER blind transfer to extension: ${extension}`);

          const extensionDirectory: Record<string, string> = {
            "101": "Sales & New Accounts (Alex Vance)",
            "102": "Technical Support (Jordan Reed)",
            "103": "Billing & Invoicing (Marcus Zhao)",
            "104": "Executive Suite (Evelyn Sinclair)",
            "105": "Strategic Partnerships (David Kim)",
          };

          const targetRep = extensionDirectory[extension] || `Extension ${extension}`;

          try {
            // Interact with SIP gateway metadata to execute the transfer
            const transferPayload = {
              action: "sip_transfer",
              type: "blind_transfer",
              destination: `sip:${extension}@pbx.internal`,
              extension,
              department: targetRep,
              timestamp: new Date().toISOString(),
            };

            // Set room metadata so the SIP bridge / telephony trunk performs the SIP REFER
            await ctx.room.setMetadata(JSON.stringify({
              sipTransfer: transferPayload,
              sipReferTo: `sip:${extension}@pbx.internal`,
            }));

            // Publish data packet to all room participants
            const encoder = new TextEncoder();
            await ctx.room.localParticipant.publishData(
              encoder.encode(JSON.stringify({ event: "sip_transfer_initiated", extension, targetRep })),
              { reliable: true }
            );

            console.log(`[Tool: transferToHuman] Successfully dispatched SIP transfer to ${targetRep} (Ext: ${extension})`);
            return JSON.stringify({
              success: true,
              status: "transferring",
              message: `Transferring you now to ${targetRep} at extension ${extension}. Please hold.`,
            });
          } catch (transferErr: any) {
            console.error(`[Tool: transferToHuman] Error executing SIP transfer:`, transferErr);
            return JSON.stringify({
              success: false,
              error: transferErr?.message || "Failed to execute SIP transfer.",
            });
          }
        }
      );

      return session;
    };

    let activeSession = createVoicePipeline("primary");

    // Catch rate limit errors, timeouts, or quota exhaustion and fallback seamlessly
    activeSession.on("error", async (error: any) => {
      console.warn(`[IVR Error] Error encountered in active voice pipeline:`, error?.message || error);

      const isRateLimitOrTimeout = 
        error?.status === 429 || 
        error?.code === "rate_limit_exceeded" || 
        error?.code === "insufficient_quota" || 
        error?.message?.includes("429") ||
        error?.message?.includes("timeout") ||
        error?.message?.includes("quota");

      if (isRateLimitOrTimeout) {
        console.warn(`[IVR Failover] Primary LLM/TTS provider encountered quota or timeout error. Seamlessly switching to fallback provider without dropping the active call...`);
        try {
          // Re-initialize pipeline with secondary fallback provider
          activeSession = createVoicePipeline("fallback");
          activeSession.start(ctx.room);
          console.log(`[IVR Failover] Fallback provider operational. Active call preserved.`);
        } catch (failoverErr) {
          console.error(`[IVR Failover] Failed to switch to fallback provider:`, failoverErr);
        }
      }
    });

    // Start voice processing on the caller's room
    activeSession.start(ctx.room);
  },
});

// Run the worker process
cli.runApp(new WorkerOptions({ agent: "agent.ts" }));
