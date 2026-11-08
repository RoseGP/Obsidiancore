/**
 * Social Planner tab: the Pulse planner, with the previous planner kept as
 * "Advanced tools" (Postiz panel, worker monitor, grid).
 */
import React, { useMemo } from 'react';
import PlannerApp from '../features/social-planner/PlannerApp';
import { createAccountsApi } from '../features/social-accounts/client/accountsApi';
import SocialPlannerView from './SocialPlannerView';
import { useDatabase } from '../context/DatabaseContext';
import { useAuth } from '../context/AuthContext';
import { useCommand } from '../context/CommandContext';
import { getApiAuthHeaders, installApiAuthInterceptor } from '../lib/apiAuth';

function cameFromConnectRedirect() {
  const p = new URLSearchParams(window.location.search);
  return Boolean(p.get('postiz_connected') || p.get('tab') === 'postiz' || p.get('tab') === 'accounts' || p.get('social_connect'));
}

export default function SocialPlannerTab() {
  const db = useDatabase();
  const { userProfile } = useAuth();
  const { setActiveView } = useCommand();
  const userId = db?.userId || 'demo-user-123'; // same fallback the posts API uses

  // The server verifies the caller on every /api/accounts, /api/posts and /api/analytics call.
  // Same identity as every other request in the app: the signed-in Firebase user (or, in development,
  // the sandbox identity). A planner-only fallback id would split uploads and posts between two users.
  const getAuthHeaders = useMemo(() => () => getApiAuthHeaders(db?.userId), [db?.userId]);
  const accountsApi = useMemo(() => createAccountsApi(getAuthHeaders), [getAuthHeaders]);
  installApiAuthInterceptor(() => db?.userId); // older panels under Advanced tools use axios

  const returningFromAuthorization = new URLSearchParams(window.location.search).has('sa');

  return (
    <PlannerApp
      userId={userId}
      workspaceName={userProfile?.company || 'My workspace'}
      userName={userProfile?.displayName}
      onOpenMessaging={() => setActiveView('messages')}
      renderClassicTools={() => <SocialPlannerView />}
      startInClassic={cameFromConnectRedirect()}
      startInAccounts={returningFromAuthorization}
      accountsApi={accountsApi}
      getAuthHeaders={getAuthHeaders}
    />
  );
}
