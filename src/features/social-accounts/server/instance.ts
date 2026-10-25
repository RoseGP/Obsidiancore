/** Single wiring point for the accounts/posts services (server only). */
import { loadConfig } from './config';
import { createPostizGateway } from './postiz/postizGateway';
import { createAccountsService } from './service';
import { createPostsService } from './postsService';
import { createAutoStore } from './store';
import { log } from './http';

export const config = loadConfig();
export const store = createAutoStore(config.storeMode, config.dataDir, config.isProduction);
export const gateway = createPostizGateway(config.postizApiUrl);
export const accounts = createAccountsService(config, store, gateway);
export const posts = createPostsService(config, store, gateway, accounts);

store.ready()
  .then((kind) => log.info(`storing connections in ${kind === 'firestore' ? 'Firestore' : `the file store (${config.dataDir})`}`))
  .catch((err) => log.error('store unavailable', err));
if (!config.isProduction && !process.env.SOCIAL_ACCOUNTS_ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY) {
  log.warn('no SOCIAL_ACCOUNTS_ENCRYPTION_KEY set: using a temporary key; stored tokens won’t survive a restart');
}
