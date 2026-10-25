# Postiz Public API v1 Integration Guide

## 1. Overview
The **Postiz Multi-Channel Social Hub** connects the Omnichannel CRM to Postiz's open-source social media management network, enabling scheduling and immediate publishing across 30+ platforms (including 𝕏/Twitter, LinkedIn, Instagram, Facebook, TikTok, YouTube, Pinterest, Reddit, Mastodon, Bluesky, and Threads).

- **Official Public API Documentation**: [https://docs.postiz.com/public-api](https://docs.postiz.com/public-api)
- **Base API Endpoint**: `https://api.postiz.com/public/v1`

---

## 2. API Endpoints Reference

### 2.1 Authentication & Status
| Endpoint | Method | Description |
|---|---|---|
| `/api/postiz/status` | GET | Checks active connection status, workspace, and authorization validity |
| `/api/postiz/auth/url` | GET | Generates the official OAuth authorization URL (`https://platform.postiz.com/oauth/authorize`) |
| `/api/postiz/callback` | GET | Handles the OAuth code redirect, token exchange, and persistence |
| `/api/postiz/connect-direct` | POST | Allows direct connection via Postiz API key (`pos_...` or workspace key) |
| `/api/postiz/disconnect` | POST | Disconnects and deletes credentials for the active user |

### 2.2 Channel Discovery & Media
| Endpoint | Method | Postiz Target | Description |
|---|---|---|---|
| `/api/postiz/integrations` | GET | `GET /public/v1/integrations` | Discovers connected social channels/accounts |
| `/api/postiz/upload` | POST | `POST /public/v1/upload` | Uploads multipart file (images, video) to Postiz |
| `/api/postiz/upload-from-url` | POST | `POST /public/v1/upload-from-url` | Attaches media via public asset URL |

### 2.3 Post Management & Scheduling
| Endpoint | Method | Postiz Target | Description |
|---|---|---|---|
| `/api/postiz/posts` | POST | `POST /public/v1/posts` | Creates, drafts, or schedules a post across selected channels |
| `/api/postiz/posts` | GET | `GET /public/v1/posts` | Retrieves scheduled and published posts |
| `/api/postiz/posts/:id` | DELETE | `DELETE /public/v1/posts/:id` | Cancels a scheduled post from the Postiz queue |
| `/api/postiz/webhook` | POST | Inbound Webhook | Receives status updates (`post.published`, `post.failed`) |

---

## 3. Postiz Public API v1 Request Schema

When calling `POST https://api.postiz.com/public/v1/posts`, the request body adheres to the verified Postiz schema:

```json
{
  "type": "schedule", // "now" | "schedule" | "draft"
  "date": "2026-09-30T14:00:00.000Z", // Required ISO 8601 string
  "shortLink": false,
  "tags": ["announcement", "crm"],
  "posts": [
    {
      "integration": {
        "id": "cm123456789"
      },
      "value": [
        {
          "content": "✨ Exciting announcement across multi-channel social networks!",
          "id": "main",
          "media": [
            {
              "id": "file_123",
              "path": "https://cdn.example.com/asset.jpg"
            }
          ]
        }
      ],
      "settings": {}
    }
  ]
}
```

---

## 4. User Journey Walkthrough (Social Planner Tab)

1. **Step 1 - Connect**:
   - In the **Social Planner** tab, click **Postiz Studio (30+ Networks)**.
   - Click **"Connect with Postiz (OAuth 2.0)"** to be redirected to `https://platform.postiz.com/oauth/authorize`.
   - (Alternatively, click **"Use API Key"** to paste your Postiz API token directly).
2. **Step 2 - Authorize**:
   - Approve permissions on Postiz. Postiz redirects back to `/api/postiz/callback`.
   - The token is securely stored with AES-256-GCM encryption.
3. **Step 3 - Channel Discovery**:
   - Connected channels are automatically retrieved via `GET /public/v1/integrations`.
   - Select one or multiple channels (𝕏, LinkedIn, Instagram, etc.).
4. **Step 4 - Compose & Attach Media**:
   - Type post content with platform-specific character limit indicators.
   - Attach images or videos via file upload or direct URL.
5. **Step 5 - Live Preview**:
   - Check realistic feed previews for 𝕏, LinkedIn, and Instagram.
6. **Step 6 - Schedule or Publish Immediately**:
   - Select **"Publish Now"**, **"Schedule"**, or **"Save Draft"**.
   - Pick the target date & time.
7. **Step 7 - Confirm Operation**:
   - Review channels, timing, and media in the confirmation modal.
   - Click **"Confirm & Send"**. The backend dispatches the payload to Postiz.
8. **Step 8 - Manage & Cancel**:
   - View scheduled and published posts in the **Postiz Schedule & Queue**.
   - Cancel scheduled posts anytime with one click.
9. **Step 9 - Reconnect on Revocation**:
   - If authorization is revoked or expires, the system displays an alert banner with a 1-click reconnect button.
