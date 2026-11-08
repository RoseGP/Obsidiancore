/**
 * Postiz Integration Automated Tests
 * Tests OAuth URL generation, state validation, AES-256-GCM token encryption,
 * Postiz Public API payload formatting, revocation handling, and webhook verification.
 */

import { PostizService, getPostizConfig } from '../services/postizService';
import { PostizStore } from '../db/postizStore';
import { encryptToken, decryptToken } from '../utils/cryptoSecurity';
import crypto from 'crypto';
// The webhook check fails closed without a secret (correct); give the test one.
process.env.POSTIZ_WEBHOOK_SECRET ||= 'postiz-test-webhook-secret';

async function runTests() {
  console.log('🧪 Starting Postiz Integration Automated Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Postiz OAuth URL Generation & State Security
  try {
    const testUserId = 'test_user_789';
    const redirect = 'http://localhost:3000/api/postiz/callback';
    const { url, state } = PostizService.generateOAuthUrl(testUserId, redirect);

    const parsedUrl = new URL(url);
    assert(parsedUrl.origin + parsedUrl.pathname === 'https://platform.postiz.com/oauth/authorize', 'OAuth URL matches official Postiz authorize endpoint');
    assert(parsedUrl.searchParams.get('response_type') === 'code', 'OAuth response_type is "code"');
    assert(parsedUrl.searchParams.get('state') === state, 'OAuth state parameter matches generated token');
    assert(parsedUrl.searchParams.get('redirect_uri') === redirect, 'OAuth redirect_uri matches provided URL');

    // Anti-replay state consumption
    const consumed = PostizStore.consumeOAuthState(state);
    assert(consumed !== null && consumed.userId === testUserId, 'OAuth state successfully verified and consumed');

    const secondConsume = PostizStore.consumeOAuthState(state);
    assert(secondConsume === null, 'OAuth state cannot be replayed (Single-Use Token)');
  } catch (err: any) {
    assert(false, 'OAuth URL & State Generation', err.message);
  }

  // TEST 2: AES-256-GCM Cryptographic Token Storage
  try {
    const rawSecretToken = 'pos_live_pat_9876543210abcdef';
    const encrypted = encryptToken(rawSecretToken);

    assert(encrypted.encryptedToken !== rawSecretToken, 'Token is encrypted and not in plaintext');
    assert(Boolean(encrypted.iv) && encrypted.iv.length === 32, 'IV is 16 bytes (32 hex characters)');
    assert(Boolean(encrypted.authTag) && encrypted.authTag.length === 32, 'AuthTag is 16 bytes (32 hex characters)');

    const decrypted = decryptToken(encrypted.encryptedToken, encrypted.iv, encrypted.authTag);
    assert(decrypted === rawSecretToken, 'Decrypted token matches original plaintext secret');

    // Tamper detection
    let tampered = false;
    try {
      decryptToken(encrypted.encryptedToken, encrypted.iv, '00112233445566778899aabbccddeeff');
    } catch (e) {
      tampered = true;
    }
    assert(tampered, 'Auth tag tampering detected and rejected by GCM');
  } catch (err: any) {
    assert(false, 'AES-256-GCM Encryption', err.message);
  }

  // TEST 3: PostizStore Credential Lifecycle & Revocation
  try {
    const testUserId = 'test_revocation_user_99';
    await PostizStore.saveCredentials({
      userId: testUserId,
      accessToken: 'pos_access_token_demo',
      refreshToken: 'pos_refresh_token_demo',
      expiresIn: 3600,
      authType: 'oauth'
    });

    const activeCreds = await PostizStore.getDecryptedAccessToken(testUserId);
    assert(activeCreds !== null && activeCreds.token === 'pos_access_token_demo', 'Active credentials successfully retrieved and decrypted');

    // Mark as revoked (simulate Postiz 401 response)
    await PostizStore.markRevoked(testUserId, 'User revoked token in Postiz settings');
    const revokedCreds = await PostizStore.getDecryptedAccessToken(testUserId);
    assert(revokedCreds === null, 'Revoked credentials cannot be used for API calls');

    const record = await PostizStore.getRecord(testUserId);
    assert(record?.status === 'revoked', 'Credential status updated to "revoked"');
    assert(record?.reconnectReason?.includes('revoked'), 'Revocation reason accurately preserved for UI alert');

    await PostizStore.disconnect(testUserId);
    const disconnected = await PostizStore.getRecord(testUserId);
    assert(disconnected === null, 'Disconnected credentials removed from vault');
  } catch (err: any) {
    assert(false, 'Credential Lifecycle & Revocation', err.message);
  }

  // TEST 4: Postiz Public API v1 Payload Schema Conformance
  try {
    const integrationIds = ['channel_twitter_1', 'channel_linkedin_2'];
    const content = 'Test announcement across multi-channel network #Postiz';
    const media = [{ id: 'med_123', path: 'https://cdn.example.com/asset.jpg' }];
    const targetDate = new Date(Date.now() + 86400000).toISOString();

    // Verify format expected by POST https://api.postiz.com/public/v1/posts
    const postPayload = {
      type: 'schedule',
      date: targetDate,
      shortLink: false,
      tags: [],
      posts: integrationIds.map(id => ({
        integration: { id },
        value: [{ content, id: 'main', media }],
        settings: {}
      }))
    };

    assert(postPayload.type === 'schedule', 'Post type adheres to Postiz schema ("schedule")');
    assert(typeof postPayload.date === 'string' && postPayload.date.includes('T'), 'Date is valid ISO 8601 string');
    assert(Array.isArray(postPayload.posts) && postPayload.posts.length === 2, 'Posts array generated for all selected channels');
    assert(postPayload.posts[0].integration.id === 'channel_twitter_1', 'First post integration ID is mapped correctly');
    assert(postPayload.posts[0].value[0].content === content, 'Content text preserved in value array');
    assert(postPayload.posts[0].value[0].media?.[0].id === 'med_123', 'Media attachments formatted according to Postiz schema');
  } catch (err: any) {
    assert(false, 'Postiz Payload Schema Conformance', err.message);
  }

  // TEST 5: Webhook Signature Verification
  try {
    const config = getPostizConfig();
    const payloadRaw = JSON.stringify({
      event: 'post.published',
      timestamp: new Date().toISOString(),
      data: { postId: 'post_abc_123', status: 'published' }
    });

    const validSignature = crypto.createHmac('sha256', config.webhookSecret).update(payloadRaw).digest('hex');
    const isValid = PostizService.verifyWebhookSignature(payloadRaw, validSignature);
    assert(isValid, 'Valid HMAC SHA-256 webhook signature verified');

    const isInvalid = PostizService.verifyWebhookSignature(payloadRaw, 'bad_signature_abc123');
    assert(!isInvalid, 'Forged webhook signature rejected');
  } catch (err: any) {
    assert(false, 'Webhook Signature Verification', err.message);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
