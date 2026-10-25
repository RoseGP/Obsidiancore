/**
 * ChatSession Schema Definition
 * 
 * Supports both Mongoose and Prisma data layers for storing multi-turn AI chat sessions.
 * Attributes:
 *  - sessionId: unique session identifier
 *  - userId: application user / creator identifier
 *  - messages: array of message objects containing role ('user' | 'assistant' | 'system'), content, and timestamp
 */

import { ChatMessageItem, ChatSessionData } from '../types';

// ==========================================
// 1. Mongoose Schema Definition (Reference)
// ==========================================
export const MongooseChatSessionSchemaDefinition = {
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  messages: [
    {
      role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true,
      },
      content: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
};

// Helper for dynamic Mongoose model initialization if mongoose is present in project
export function getMongooseChatSessionModel(mongooseInstance?: any) {
  if (!mongooseInstance) return null;
  const { Schema } = mongooseInstance;
  const messageSubSchema = new Schema(
    {
      role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
    { _id: false }
  );

  const chatSessionSchema = new Schema(
    {
      sessionId: { type: String, required: true, unique: true, index: true },
      userId: { type: String, required: true, index: true },
      messages: [messageSubSchema],
    },
    { timestamps: true }
  );

  return mongooseInstance.models.ChatSession || mongooseInstance.model('ChatSession', chatSessionSchema);
}

// ==========================================
// 2. Prisma Schema Model Representation
// ==========================================
export const PrismaChatSessionModelName = 'ChatSession';

export type { ChatMessageItem, ChatSessionData };
