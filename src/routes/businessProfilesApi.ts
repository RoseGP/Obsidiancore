/** /api/business-profiles — see src/features/business-profiles/server/router.ts for the route table. */
import { config } from '../features/social-accounts/server/instance';
import { businessProfiles } from '../features/business-profiles/server/instance';
import { createBusinessProfilesRouter } from '../features/business-profiles/server/router';

export default createBusinessProfilesRouter(businessProfiles, { appUrl: config.appUrl });
