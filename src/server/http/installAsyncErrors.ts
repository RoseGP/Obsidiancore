/**
 * Side-effect import: must be imported in server.ts BEFORE any router module, because Express routes capture
 * their handlers when they're registered (at module load). See installAsyncErrorForwarding in middleware.ts.
 */
import { installAsyncErrorForwarding } from './middleware';

installAsyncErrorForwarding();
