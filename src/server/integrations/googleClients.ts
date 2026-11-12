/**
 * The Google API clients this server uses (Calendar v3, OAuth2 userinfo, the OAuth2 auth client), from the
 * per-API packages instead of the `googleapis` bundle. That bundle ships typings for ~300 Google APIs: it made
 * `tsc` need ~2.8 GB (over Node's default heap, so `npm run typecheck` crashed) and added ~100 MB to installs.
 *
 * `google` keeps the old `google.calendar(...)` / `google.oauth2(...)` / `google.auth.OAuth2` shape. It is a
 * plain mutable object on purpose: tests replace its members to stub Google without network calls.
 */
import { auth, calendar } from '@googleapis/calendar';
import { oauth2 } from '@googleapis/oauth2';

export const google = { auth, calendar, oauth2 };
