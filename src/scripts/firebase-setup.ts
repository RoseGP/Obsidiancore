import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  Timestamp, 
  Firestore 
} from 'firebase/firestore';
import { getFirestoreDb, handleFirestoreError, OperationType } from '../lib/firebase-config';
import { UserDocument, ChannelDocument, PostDocument } from '../types/firebase-schemas';

/**
 * Seeding Script for Social Media Planner Firestore Database.
 * This runs inside the app context or workspace execution system.
 * It inserts standard, secure mock records matching the system schemas.
 */
export async function seedSocialPlannerDatabase(): Promise<{
  userId: string;
  seededPosts: string[];
}> {
  const db: Firestore = getFirestoreDb();
  
  // 1. Primary User UID (mocking an authenticated user session)
  const mockUserId = "social_architect_prime_2026";
  const userPath = `users/${mockUserId}`;

  console.log(`[Seed Task] Initializing User account seeding at path: ${userPath}`);
  
  const mockUser: UserDocument = {
    uid: mockUserId,
    email: "rpierrette45@gmail.com",
    displayName: "Robert Pierrette",
    photoURL: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  try {
    await setDoc(doc(db, 'users', mockUserId), mockUser);
    console.log("[Seed Task] ✓ Primary User profile document seeded successfully.");
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${mockUserId}`);
  }

  // 2. Channels Subcollection (Supporting all 6 APIs)
  const channelsToSeed: ChannelDocument[] = [
    {
      id: "facebook",
      platform: "facebook",
      connected: true,
      handle: "ForgeForge Brand Page",
      accessToken: "EAAxx_FB_GRAPH_API_LONG_LIVED_TOKEN_MOCK_XYZ123ABC",
      pageId: "fb_page_881920193",
      scope: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_to_groups"],
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)), // 60 Days
      profilePictureUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=100",
      updatedAt: Timestamp.now()
    },
    {
      id: "instagram",
      platform: "instagram",
      connected: true,
      handle: "@flowforge_agency",
      accessToken: "IG_GRAPH_API_USER_TOKEN_MOCK_OPQ456LMN_STILL_VALID",
      pageId: "ig_business_act_551920",
      scope: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments"],
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)), // 60 Days
      profilePictureUrl: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=100",
      updatedAt: Timestamp.now()
    },
    {
      id: "linkedin",
      platform: "linkedin",
      connected: true,
      handle: "Flow Forge Inc.",
      accessToken: "AQW_LINKEDIN_MEMBER_OAUTH2_TOKEN_MOCK_RST789UVI",
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 Days
      scope: ["w_member_social", "r_liteprofile", "r_organization_admin"],
      profilePictureUrl: "https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=100",
      updatedAt: Timestamp.now()
    },
    {
      id: "tiktok",
      platform: "tiktok",
      connected: true,
      handle: "@flowforge_trends",
      accessToken: "tt_client_oauth_token_v2_MOCK_XYZ789",
      refreshToken: "tt_client_refresh_token_v2_MOCK_REFR_456",
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // 24 Hours
      scope: ["video.publish", "user.info.basic"],
      profilePictureUrl: "https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=100",
      updatedAt: Timestamp.now()
    },
    {
      id: "x",
      platform: "x",
      connected: true,
      handle: "@FlowForgeAI",
      accessToken: "X_API_V2_OAUTH_TOKEN_PAIR_USER_MOCK_KLM987",
      refreshToken: "X_API_V2_OAUTH_REFRESH_TOKEN_MOCK_RST321",
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 7200 * 1000)), // 2 Hours
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
      profilePictureUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100",
      updatedAt: Timestamp.now()
    },
    {
      id: "youtube",
      platform: "youtube",
      connected: true,
      handle: "Flow Forge Dev Network",
      accessToken: "YA_YOUTUBE_DATA_API_V3_OAUTH_ACCESS_MOCK_ZXC567",
      refreshToken: "YA_YOUTUBE_OAUTH_REFRESH_MOCK_VBN901",
      tokenExpiry: Timestamp.fromDate(new Date(Date.now() + 3600 * 1000)), // 1 Hour
      scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
      profilePictureUrl: "https://images.unsplash.com/photo-1611162618828-bc409f855cdd?w=100",
      updatedAt: Timestamp.now()
    }
  ];

  for (const channel of channelsToSeed) {
    const channelPath = `users/${mockUserId}/channels/${channel.id}`;
    try {
      await setDoc(doc(db, 'users', mockUserId, 'channels', channel.id), channel);
      console.log(`[Seed Task] ✓ Seeding linked network account profile: ${channel.platform} (${channel.handle})`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, channelPath);
    }
  }

  // 3. Posts Collection Seeding (Different lifecycle states and multi-photo/video attachment objects)
  const postsToSeed: PostDocument[] = [
    {
      userId: mockUserId,
      caption: "Introducing Flow Forge 2.0! Built completely on a server-authoritative engine with strict zero-trust Firestore security. #DevTools #Coding #Architecture",
      media: [
        {
          url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800",
          type: "image",
          name: "dashboard_redesign_hero.png",
          sizeBytes: 1048576
        },
        {
          url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800",
          type: "image",
          name: "codebase_diagram.png",
          sizeBytes: 819200
        }
      ],
      scheduledAt: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 3)), // Scheduled 3 days from now
      channelIds: ["linkedin", "x", "facebook"],
      status: "scheduled",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    {
      userId: mockUserId,
      caption: "Quick workflow demo showing how we manage and orchestrate multi-platform publication queues asynchronously. Watch the full tutorial below! 🎥👇",
      media: [
        {
          url: "https://assets.mixkit.co/videos/preview/mixkit-software-developer-working-on-his-computer-34316-large.mp4",
          type: "video",
          name: "planner_workflow_screencast.mp4",
          sizeBytes: 12480104
        }
      ],
      scheduledAt: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 4)), // Scheduled 4 hours from now
      channelIds: ["youtube", "instagram", "tiktok"],
      status: "publishing",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    {
      userId: mockUserId,
      caption: "Draft post mapping ideas for our upcoming launch. Testing the UI limits for draft validation.",
      media: [],
      scheduledAt: Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)), // Scheduled 14 days from now
      channelIds: ["linkedin"],
      status: "draft",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    {
      userId: mockUserId,
      caption: "This post has already been successfully published to Twitter and LinkedIn channels as of yesterday morning! Thanks to everyone who tuned in.",
      media: [
        {
          url: "https://images.unsplash.com/photo-1542744094-3a31f103e35f?w=800",
          type: "image",
          name: "celebration_graphic.png",
          sizeBytes: 1540100
        }
      ],
      scheduledAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 24)), // Scheduled 1 day ago
      channelIds: ["x", "linkedin"],
      status: "published",
      createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 25)),
      updatedAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 60 * 24))
    },
    {
      userId: mockUserId,
      caption: "Attempting to push rich spreadsheet summaries across TikTok channel... This was designed to fail as raw spreadsheets aren't native video objects.",
      media: [],
      scheduledAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 120)), // 2 hours ago
      channelIds: ["tiktok"],
      status: "failed",
      error: "TikTok API Error (Code 40021): Media is required for publishing text posts to this channel.",
      createdAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 240)),
      updatedAt: Timestamp.fromDate(new Date(Date.now() - 1000 * 60 * 120))
    }
  ];

  const seededPostIds: string[] = [];

  for (const postDoc of postsToSeed) {
    try {
      const docRef = await addDoc(collection(db, 'posts'), postDoc);
      seededPostIds.push(docRef.id);
      console.log(`[Seed Task] ✓ Seeded Post ID: ${docRef.id} [Status: ${postDoc.status}] [Target Platforms: ${postDoc.channelIds.join(', ')}]`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
    }
  }

  console.log(`[Seed Task] Seeding completed. Root collection populated with ${seededPostIds.length} operations.`);
  return {
    userId: mockUserId,
    seededPosts: seededPostIds
  };
}
