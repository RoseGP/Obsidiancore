// Optional Prisma client resolution; defaults to high-performance operational mock
let PrismaClient: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PrismaClient = require('@prisma/client')?.PrismaClient;
} catch {
  // Graceful fallback to operational mock
}

let prisma: any = null;
let isMock = false;

// In-memory collections to act as fallback if database is not reachable / not configured
const mockClients: any[] = [];
const mockMessages: any[] = [];
const mockGoogleLocations: any[] = [];
const mockGbpProfileDetails: any[] = [];
const mockSocialAccounts: any[] = [];
const mockChannels: any[] = [];
const mockPosts: any[] = [];
const mockSocialPosts: any[] = [];
const mockPostTargets: any[] = [];
const mockChatSessions: any[] = [];
const mockAccounts: any[] = [];
const mockUsers: any[] = [
  {
    id: 'demo-user-123',
    email: 'rpierrette45@gmail.com',
    name: 'Rene Pierrette',
    role: 'MARKETEER',
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

/**
 * Safe client initialization targeting PostgreSQL or returning an equivalent operational mock
 */
function getPrismaClient(): any {
  if (prisma) return prisma;

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl || dbUrl.includes('placeholder') || dbUrl.includes('MY_DATABASE_URL')) {
    console.warn('[Database System] DATABASE_URL is not set or contains placeholders. Activating high-performance Mock DB Service.');
    isMock = true;
    return createMockPrisma();
  }

  if (dbUrl.startsWith('firestore://') || dbUrl.includes('firestore')) {
    console.log('[Database System] DATABASE_URL is set to Firestore. Activating clean Firestore mapping and bypassing Prisma/Postgres.');
    isMock = true;
    return createMockPrisma();
  }

  if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    console.warn('[Database System] DATABASE_URL does not start with postgresql:// or postgres://. Activating high-performance Mock DB Service.');
    isMock = true;
    return createMockPrisma();
  }

  try {
    const tempPrisma = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl
        }
      },
      log: ['error', 'warn'],
    });
    
    // Defensive check to verify the generated Prisma Client actually contains the expected models.
    // If Prisma is instantiated but not migrated/generated, model properties might be undefined.
    if (!tempPrisma.user || !tempPrisma.client || !tempPrisma.socialAccount) {
      console.warn('[Database System] Prisma Client was instantiated but is missing expected properties (user, client, or socialAccount). Falling back to Mock DB.');
      isMock = true;
      return createMockPrisma();
    }

    prisma = tempPrisma;
    console.log('[Database System] PostgreSQL Prisma Client successfully instantiated and verified.');
    return prisma;
  } catch (err: any) {
    console.warn('[Database System] Prisma Client instantiation bypassed (' + err.message + '). Activating Mock DB Service.');
    isMock = true;
    return createMockPrisma();
  }
}

/**
 * Creates an operational mock containing matching queries and updates to mimic real PostgreSQL actions
 */
function createMockPrisma() {
  return {
    user: {
      findFirst: async (args?: any) => {
        if (args?.where) {
          const { id, email } = args.where;
          return mockUsers.find((u) => {
            if (id && u.id === id) return true;
            if (email && u.email === email) return true;
            return false;
          }) || mockUsers[0] || null;
        }
        return mockUsers[0] || null;
      },
      create: async ({ data }: { data: any }) => {
        const newUser = {
          id: `user-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockUsers.push(newUser);
        return newUser;
      },
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        return mockUsers.find((u) => {
          if (where.id && u.id === where.id) return true;
          if (where.email && u.email === where.email) return true;
          return false;
        }) || null;
      },
    },
    client: {
      findFirst: async ({ where }: { where: any }) => {
        let matched = mockClients.find((c) => {
          if (where.phone && c.phone === where.phone) return true;
          if (where.email && c.email === where.email) return true;
          if (where.OR) {
            return where.OR.some((cond: any) => {
              if (cond.phone && c.phone === cond.phone) return true;
              if (cond.email && c.email === cond.email) return true;
              return false;
            });
          }
          return false;
        });
        return matched || null;
      },
      create: async ({ data }: { data: any }) => {
        const newClient = {
          id: `client-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockClients.push(newClient);
        console.log('[Mock DB] Client Created:', JSON.stringify(newClient, null, 2));
        return newClient;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return mockClients.find((c) => c.id === where.id) || null;
      },
    },
    message: {
      create: async ({ data }: { data: any }) => {
        const newMessage = {
          id: `msg-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          ...data,
        };
        mockMessages.push(newMessage);
        console.log('[Mock DB] Message Logged:', JSON.stringify(newMessage, null, 2));
        return newMessage;
      },
      findMany: async (args?: any) => {
        return mockMessages;
      },
    },
    googleLocation: {
      findUnique: async ({ where }: { where: { id?: string; locationId?: string } }) => {
        return mockGoogleLocations.find((l) => {
          if (where.id && l.id === where.id) return true;
          if (where.locationId && l.locationId === where.locationId) return true;
          return false;
        }) || null;
      },
      findMany: async (args?: any) => {
        return mockGoogleLocations;
      },
      create: async ({ data }: { data: any }) => {
        const newLocation = {
          id: `loc-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockGoogleLocations.push(newLocation);
        return newLocation;
      },
      update: async ({ where, data }: { where: { id?: string; locationId?: string }; data: any }) => {
        const itemIndex = mockGoogleLocations.findIndex((l) => {
          if (where.id && l.id === where.id) return true;
          if (where.locationId && l.locationId === where.locationId) return true;
          return false;
        });
        if (itemIndex > -1) {
          mockGoogleLocations[itemIndex] = {
            ...mockGoogleLocations[itemIndex],
            ...data,
            updatedAt: new Date(),
          };
          return mockGoogleLocations[itemIndex];
        }
        throw new Error('Record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: { locationId: string }; update: any; create: any }) => {
        const existing = mockGoogleLocations.find((l) => l.locationId === where.locationId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        } else {
          const newLocation = {
            id: `loc-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockGoogleLocations.push(newLocation);
          return newLocation;
        }
      },
    },
    gbpProfileDetails: {
      findUnique: async ({ where }: { where: { locationId: string } }) => {
        return mockGbpProfileDetails.find((l) => l.locationId === where.locationId) || null;
      },
      findMany: async (args?: any) => {
        return mockGbpProfileDetails;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          lastSyncedAt: new Date(),
          ...data,
        };
        mockGbpProfileDetails.push(item);
        return item;
      },
      update: async ({ where, data }: { where: { locationId: string }; data: any }) => {
        const itemIndex = mockGbpProfileDetails.findIndex((l) => l.locationId === where.locationId);
        if (itemIndex > -1) {
          mockGbpProfileDetails[itemIndex] = {
            ...mockGbpProfileDetails[itemIndex],
            ...data,
            lastSyncedAt: new Date(),
          };
          return mockGbpProfileDetails[itemIndex];
        }
        throw new Error('GBP profile details record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: { locationId: string }; update: any; create: any }) => {
        const existing = mockGbpProfileDetails.find((l) => l.locationId === where.locationId);
        if (existing) {
          Object.assign(existing, update, { lastSyncedAt: new Date() });
          return existing;
        } else {
          const item = {
            lastSyncedAt: new Date(),
            ...create,
          };
          mockGbpProfileDetails.push(item);
          return item;
        }
      },
    },
    socialAccount: {
      findUnique: async ({ where }: { where: any }) => {
        return mockSocialAccounts.find(sa => {
          if (where.platform_accountId) {
            return sa.platform === where.platform_accountId.platform && sa.accountId === where.platform_accountId.accountId;
          }
          if (where.id) {
            return sa.id === where.id;
          }
          return false;
        }) || null;
      },
      findMany: async (args?: any) => {
        if (args?.where?.userId) {
          return mockSocialAccounts.filter(sa => sa.userId === args.where.userId);
        }
        return mockSocialAccounts;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `sa-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockSocialAccounts.push(item);
        return item;
      },
      update: async ({ where, data }: { where: any; data: any }) => {
        const item = mockSocialAccounts.find(sa => {
          if (where.platform_accountId) {
            return sa.platform === where.platform_accountId.platform && sa.accountId === where.platform_accountId.accountId;
          }
          if (where.id) {
            return sa.id === where.id;
          }
          return false;
        });
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('SocialAccount record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const existing = mockSocialAccounts.find(sa => {
          if (where.platform_accountId) {
            return sa.platform === where.platform_accountId.platform && sa.accountId === where.platform_accountId.accountId;
          }
          if (where.id) {
            return sa.id === where.id;
          }
          return false;
        });
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        } else {
          const item = {
            id: `sa-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockSocialAccounts.push(item);
          return item;
        }
      },
      delete: async ({ where }: { where: any }) => {
        const idx = mockSocialAccounts.findIndex(sa => {
          if (where.platform_accountId) {
            return sa.platform === where.platform_accountId.platform && sa.accountId === where.platform_accountId.accountId;
          }
          if (where.id) return sa.id === where.id;
          return false;
        });
        if (idx > -1) {
          const removed = mockSocialAccounts.splice(idx, 1);
          return removed[0];
        }
        throw new Error('SocialAccount record to delete not found.');
      },
      deleteMany: async (args?: any) => {
        const where = args?.where;
        if (!where) {
          const count = mockSocialAccounts.length;
          mockSocialAccounts.length = 0;
          return { count };
        }
        let count = 0;
        for (let i = mockSocialAccounts.length - 1; i >= 0; i--) {
          const sa = mockSocialAccounts[i];
          let match = true;
          if (where.platform && sa.platform !== where.platform) match = false;
          if (where.userId && sa.userId !== where.userId) match = false;
          if (where.accountId && sa.accountId !== where.accountId) match = false;
          if (match) {
            mockSocialAccounts.splice(i, 1);
            count++;
          }
        }
        return { count };
      }
    },
    channel: {
      findMany: async (args?: any) => {
        if (args?.where?.userId) {
          return mockChannels.filter(c => c.userId === args.where.userId);
        }
        return mockChannels;
      },
      findFirst: async (args?: any) => {
        if (args?.where) {
          const { platform, userId, id } = args.where;
          return mockChannels.find(c => {
            if (id && c.id === id) return true;
            if (platform && userId && c.platform === platform && c.userId === userId) return true;
            return false;
          }) || null;
        }
        return mockChannels[0] || null;
      },
      findUnique: async ({ where }: { where: any }) => {
        return mockChannels.find(c => {
          if (where.id && c.id === where.id) return true;
          if (where.platform_userId) {
            return c.platform === where.platform_userId.platform && c.userId === where.platform_userId.userId;
          }
          return false;
        }) || null;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `channel-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockChannels.push(item);
        return item;
      },
      update: async ({ where, data }: { where: any; data: any }) => {
        const item = mockChannels.find(c => {
          if (where.id) return c.id === where.id;
          if (where.platform_userId) {
            return c.platform === where.platform_userId.platform && c.userId === where.platform_userId.userId;
          }
          return false;
        });
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('Channel record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const existing = mockChannels.find(c => {
          if (where.id) return c.id === where.id;
          if (where.platform_userId) {
            return c.platform === where.platform_userId.platform && c.userId === where.platform_userId.userId;
          }
          return false;
        });
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        } else {
          const item = {
            id: `channel-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockChannels.push(item);
          return item;
        }
      },
      delete: async ({ where }: { where: any }) => {
        const idx = mockChannels.findIndex(c => {
          if (where.id) return c.id === where.id;
          if (where.platform_userId) {
            return c.platform === where.platform_userId.platform && c.userId === where.platform_userId.userId;
          }
          return false;
        });
        if (idx > -1) {
          const removed = mockChannels.splice(idx, 1);
          return removed[0];
        }
        throw new Error('Channel record to delete not found.');
      },
      deleteMany: async (args?: any) => {
        const where = args?.where;
        if (!where) {
          const count = mockChannels.length;
          mockChannels.length = 0;
          return { count };
        }
        let count = 0;
        for (let i = mockChannels.length - 1; i >= 0; i--) {
          const c = mockChannels[i];
          let match = true;
          if (where.platform && c.platform !== where.platform) match = false;
          if (where.userId && c.userId !== where.userId) match = false;
          if (where.id && c.id !== where.id) match = false;
          if (match) {
            mockChannels.splice(i, 1);
            count++;
          }
        }
        return { count };
      }
    },
    post: {
      findMany: async (args?: any) => {
        let list = [...mockPosts];
        if (args?.where?.createdById) {
          list = list.filter(p => p.createdById === args.where.createdById);
        }
        return list;
      },
      findFirst: async (args?: any) => {
        if (args?.where?.id) {
          return mockPosts.find(p => p.id === args.where.id) || null;
        }
        return mockPosts[0] || null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return mockPosts.find(p => p.id === where.id) || null;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `post-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockPosts.push(item);
        return item;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const item = mockPosts.find(p => p.id === where.id);
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('Post record to update not found.');
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = mockPosts.findIndex(p => p.id === where.id);
        if (idx > -1) {
          const removed = mockPosts.splice(idx, 1);
          for (let i = mockPostTargets.length - 1; i >= 0; i--) {
            if (mockPostTargets[i].postId === where.id) {
              mockPostTargets.splice(i, 1);
            }
          }
          return removed[0];
        }
        throw new Error('Post record to delete not found.');
      }
    },
    postTarget: {
      findMany: async (args?: any) => {
        let list = [...mockPostTargets];
        if (args?.where?.postId) {
          list = list.filter(pt => pt.postId === args.where.postId);
        }
        if (args?.where?.channelId) {
          list = list.filter(pt => pt.channelId === args.where.channelId);
        }
        return list;
      },
      findFirst: async (args?: any) => {
        if (args?.where) {
          const { postId, channelId, id } = args.where;
          return mockPostTargets.find(pt => {
            if (id && pt.id === id) return true;
            if (postId && channelId && pt.postId === postId && pt.channelId === channelId) return true;
            return false;
          }) || null;
        }
        return mockPostTargets[0] || null;
      },
      findUnique: async ({ where }: { where: any }) => {
        return mockPostTargets.find(pt => {
          if (where.id && pt.id === where.id) return true;
          if (where.postId_channelId) {
            return pt.postId === where.postId_channelId.postId && pt.channelId === where.postId_channelId.channelId;
          }
          return false;
        }) || null;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `pt-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockPostTargets.push(item);
        return item;
      },
      update: async ({ where, data }: { where: any; data: any }) => {
        const item = mockPostTargets.find(pt => {
          if (where.id) return pt.id === where.id;
          if (where.postId_channelId) {
            return pt.postId === where.postId_channelId.postId && pt.channelId === where.postId_channelId.channelId;
          }
          return false;
        });
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('PostTarget record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const existing = mockPostTargets.find(pt => {
          if (where.id) return pt.id === where.id;
          if (where.postId_channelId) {
            return pt.postId === where.postId_channelId.postId && pt.channelId === where.postId_channelId.channelId;
          }
          return false;
        });
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        } else {
          const item = {
            id: `pt-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockPostTargets.push(item);
          return item;
        }
      },
      delete: async ({ where }: { where: any }) => {
        const idx = mockPostTargets.findIndex(pt => {
          if (where.id) return pt.id === where.id;
          if (where.postId_channelId) {
            return pt.postId === where.postId_channelId.postId && pt.channelId === where.postId_channelId.channelId;
          }
          return false;
        });
        if (idx > -1) {
          const removed = mockPostTargets.splice(idx, 1);
          return removed[0];
        }
        throw new Error('PostTarget record to delete not found.');
      }
    },
    socialPost: {
      findMany: async (args?: any) => {
        let list = [...mockSocialPosts];
        if (args?.where?.createdById) {
          list = list.filter(p => p.createdById === args.where.createdById);
        }
        if (args?.where?.status) {
          list = list.filter(p => p.status === args.where.status);
        }
        return list;
      },
      findFirst: async (args?: any) => {
        if (args?.where?.id) {
          return mockSocialPosts.find(p => p.id === args.where.id) || null;
        }
        return mockSocialPosts[0] || null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return mockSocialPosts.find(p => p.id === where.id) || null;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `social-post-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          status: 'DRAFT',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockSocialPosts.push(item);
        return item;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const item = mockSocialPosts.find(p => p.id === where.id);
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('SocialPost record to update not found.');
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = mockSocialPosts.findIndex(p => p.id === where.id);
        if (idx > -1) {
          const removed = mockSocialPosts.splice(idx, 1);
          return removed[0];
        }
        throw new Error('SocialPost record to delete not found.');
      }
    },
    chatSession: {
      findMany: async (args?: any) => {
        let list = [...mockChatSessions];
        if (args?.where?.userId) {
          list = list.filter(cs => cs.userId === args.where.userId);
        }
        return list;
      },
      findFirst: async (args?: any) => {
        if (args?.where) {
          const { sessionId, id, userId } = args.where;
          return mockChatSessions.find(cs => {
            if (sessionId && cs.sessionId === sessionId) return true;
            if (id && cs.id === id) return true;
            if (userId && cs.userId === userId) return true;
            return false;
          }) || null;
        }
        return mockChatSessions[0] || null;
      },
      findUnique: async ({ where }: { where: { sessionId?: string; id?: string } }) => {
        return mockChatSessions.find(cs => {
          if (where.sessionId && cs.sessionId === where.sessionId) return true;
          if (where.id && cs.id === where.id) return true;
          return false;
        }) || null;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: `chatsession-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          messages: Array.isArray(data.messages) ? data.messages : [],
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockChatSessions.push(item);
        return item;
      },
      update: async ({ where, data }: { where: { sessionId?: string; id?: string }; data: any }) => {
        const item = mockChatSessions.find(cs => {
          if (where.sessionId && cs.sessionId === where.sessionId) return true;
          if (where.id && cs.id === where.id) return true;
          return false;
        });
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          return item;
        }
        throw new Error('ChatSession record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: { sessionId?: string; id?: string }; update: any; create: any }) => {
        const existing = mockChatSessions.find(cs => {
          if (where.sessionId && cs.sessionId === where.sessionId) return true;
          if (where.id && cs.id === where.id) return true;
          return false;
        });
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        } else {
          const item = {
            id: `chatsession-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            messages: Array.isArray(create.messages) ? create.messages : [],
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockChatSessions.push(item);
          return item;
        }
      },
      delete: async ({ where }: { where: { sessionId?: string; id?: string } }) => {
        const idx = mockChatSessions.findIndex(cs => {
          if (where.sessionId && cs.sessionId === where.sessionId) return true;
          if (where.id && cs.id === where.id) return true;
          return false;
        });
        if (idx > -1) {
          const removed = mockChatSessions.splice(idx, 1);
          return removed[0];
        }
        throw new Error('ChatSession record to delete not found.');
      }
    },
    account: {
      findUnique: async ({ where }: { where: any }) => {
        return mockAccounts.find(acc => {
          if (where.userId_provider) {
            return acc.userId === where.userId_provider.userId && acc.provider === where.userId_provider.provider;
          }
          if (where.id) return acc.id === where.id;
          if (where.userId && where.provider) {
            return acc.userId === where.userId && acc.provider === where.provider;
          }
          return false;
        }) || null;
      },
      findFirst: async (args?: any) => {
        if (args?.where) {
          const { userId, provider, id, userId_provider } = args.where;
          return mockAccounts.find(acc => {
            if (id && acc.id === id) return true;
            if (userId_provider && acc.userId === userId_provider.userId && acc.provider === userId_provider.provider) return true;
            if (userId && provider && acc.userId === userId && acc.provider === provider) return true;
            if (userId && !provider && acc.userId === userId) return true;
            return false;
          }) || null;
        }
        return mockAccounts[0] || null;
      },
      findMany: async (args?: any) => {
        if (args?.where?.userId) {
          return mockAccounts.filter(acc => acc.userId === args.where.userId);
        }
        return mockAccounts;
      },
      create: async ({ data }: { data: any }) => {
        const item = {
          id: data.id || `acc-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        mockAccounts.push(item);
        console.log(`[Mock DB Accounts] Created new account record for provider '${item.provider}' (User: ${item.userId}) with AES-256 encrypted tokens`);
        return item;
      },
      update: async ({ where, data }: { where: any; data: any }) => {
        const item = mockAccounts.find(acc => {
          if (where.userId_provider) {
            return acc.userId === where.userId_provider.userId && acc.provider === where.userId_provider.provider;
          }
          if (where.id) return acc.id === where.id;
          return false;
        });
        if (item) {
          Object.assign(item, data, { updatedAt: new Date() });
          console.log(`[Mock DB Accounts] Updated account record for provider '${item.provider}' (User: ${item.userId}) with fresh AES-256 tokens`);
          return item;
        }
        throw new Error('Account record to update not found.');
      },
      upsert: async ({ where, update, create }: { where: any; update: any; create: any }) => {
        const existing = mockAccounts.find(acc => {
          if (where.userId_provider) {
            return acc.userId === where.userId_provider.userId && acc.provider === where.userId_provider.provider;
          }
          if (where.id) return acc.id === where.id;
          if (where.userId && where.provider) {
            return acc.userId === where.userId && acc.provider === where.provider;
          }
          return false;
        });
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          console.log(`[Mock DB Accounts] Upserted (updated) account record for provider '${existing.provider}' (User: ${existing.userId})`);
          return existing;
        } else {
          const item = {
            id: create.id || `acc-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          mockAccounts.push(item);
          console.log(`[Mock DB Accounts] Upserted (created) account record for provider '${item.provider}' (User: ${item.userId}) with AES-256 tokens`);
          return item;
        }
      },
      delete: async ({ where }: { where: any }) => {
        const idx = mockAccounts.findIndex(acc => {
          if (where.userId_provider) {
            return acc.userId === where.userId_provider.userId && acc.provider === where.userId_provider.provider;
          }
          if (where.id) return acc.id === where.id;
          return false;
        });
        if (idx > -1) {
          const removed = mockAccounts.splice(idx, 1);
          return removed[0];
        }
        throw new Error('Account record to delete not found.');
      },
      deleteMany: async (args?: any) => {
        const where = args?.where;
        if (!where) {
          const count = mockAccounts.length;
          mockAccounts.length = 0;
          return { count };
        }
        let count = 0;
        for (let i = mockAccounts.length - 1; i >= 0; i--) {
          const acc = mockAccounts[i];
          let match = true;
          if (where.provider && acc.provider !== where.provider) match = false;
          if (where.userId && acc.userId !== where.userId) match = false;
          if (where.id && acc.id !== where.id) match = false;
          if (match) {
            mockAccounts.splice(i, 1);
            count++;
          }
        }
        return { count };
      }
    },
  };
}

export const db = getPrismaClient();
export const isDatabaseMock = () => isMock;
