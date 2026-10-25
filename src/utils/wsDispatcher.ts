import { WebSocket } from 'ws';

/**
 * Senior Communications Architect real-time WS transmission dispatcher.
 * Safely aggregates live active browser frames to stream push alerts about WhatsApp & Twilio updates.
 */
class WebSocketDispatcher {
  private activeClients: Set<WebSocket> = new Set();

  /**
   * Register a new active client WebSocket connection when the browser client completes connection handshakes.
   */
  public registerClient(ws: WebSocket): void {
    this.activeClients.add(ws);
    console.log(`[WS Registry] Active browser client registered. Pool count: ${this.activeClients.size}`);

    // Simple ping-pong keeps socket alive automatically
    ws.on('close', () => {
      this.activeClients.delete(ws);
      console.log(`[WS Registry] Browser client disconnected. Remaining: ${this.activeClients.size}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS Registry] Client socket error:`, err.message);
      this.activeClients.delete(ws);
    });
  }

  /**
   * Broadcast structured telemetry and message inputs safely to all active view frames.
   */
  public broadcast(event: string, payload: any): void {
    const rawPayload = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    console.log(`[WS Broadcast] Transmitting event: ${event} to ${this.activeClients.size} clients.`);

    this.activeClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(rawPayload);
        } catch (e: any) {
          console.error('[WS Broadcast] Failed to send payload to a client', e.message);
        }
      }
    });
  }

  /**
   * Returns current active client pool size
   */
  public getClientCount(): number {
    return this.activeClients.size;
  }
}

// Global process-wide singleton for the communication worker & routes
export const wsDispatcher = new WebSocketDispatcher();
