import { Router } from 'express';
import {
  handleChatCompletions,
  handleGetModels,
  handleGetGatewayStatus
} from '../controllers/omniRouteChatController';

export const chatRouter = Router();

// Primary Chat Completion SSE Streaming Route (/api/chat/completions)
chatRouter.post('/completions', handleChatCompletions);
chatRouter.post('/chat/completions', handleChatCompletions);

// Models and Fallback Chains Configuration
chatRouter.get('/models', handleGetModels);

// OmniRoute Gateway Health & Circuit Breaker Telemetry
chatRouter.get('/gateway/status', handleGetGatewayStatus);

export default chatRouter;
