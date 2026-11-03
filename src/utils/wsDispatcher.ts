/**
 * Server-side event hook for communication routes (WhatsApp, SMS, Twilio).
 *
 * No browser ever subscribed to the old raw-WebSocket pool, so these events
 * were never delivered. Broadcasting them to every connected socket would leak
 * one account's messages to other accounts, so this stays a log-only hook
 * until events are routed per user (e.g. socket.io rooms keyed by user id).
 */
class EventDispatcher {
  public broadcast(event: string, _payload: unknown): void {
    if (process.env.NODE_ENV !== 'production') console.log(`[events] ${event}`);
  }

  public getClientCount(): number {
    return 0;
  }
}

export const wsDispatcher = new EventDispatcher();
