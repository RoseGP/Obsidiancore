/**
 * Standalone Reusable Cloudflare R2 + Cache API Worker Template
 *
 * Implements Edge Caching via Cloudflare Cache API (caches.default),
 * object streaming, automatic HTTP metadata and ETag propagation,
 * and background cache population via context.waitUntil().
 */

export default {
  /**
   * HTTP Fetch Handler
   *
   * @param {Request} request - Inbound HTTP request
   * @param {Object} env - Worker environment (env.MY_BUCKET or env.CRM_BUCKET)
   * @param {ExecutionContext} context - Execution context for waitUntil
   */
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);

      // Construct the cache key from the cache URL
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;

      // Check whether the value is already available in the cache
      // if not, you will need to fetch it from R2, and store it in the cache
      // for future access
      let response = await cache.match(cacheKey);

      if (response) {
        console.log(`Cache hit for: ${request.url}.`);
        return response;
      }

      console.log(
        `Response for request url: ${request.url} not present in cache. Fetching and caching request.`
      );

      // Support env.MY_BUCKET or env.CRM_BUCKET binding
      const bucket = env.MY_BUCKET || env.CRM_BUCKET;
      if (!bucket || typeof bucket.get !== 'function') {
        return new Response('R2 Bucket binding (MY_BUCKET or CRM_BUCKET) not found', { status: 500 });
      }

      // If not in cache, get it from R2
      const objectKey = decodeURIComponent(url.pathname.slice(1));
      if (!objectKey) {
        return new Response('Please specify an R2 object key path (e.g. /my-file.pdf)', { status: 400 });
      }

      const object = await bucket.get(objectKey);
      if (object === null) {
        return new Response('Object Not Found', { status: 404 });
      }

      // Set the appropriate object headers
      const headers = new Headers();
      if (typeof object.writeHttpMetadata === 'function') {
        object.writeHttpMetadata(headers);
      }
      if (object.httpEtag) {
        headers.set('etag', object.httpEtag);
      }

      // Cache API respects Cache-Control headers. Setting s-maxage to 10
      // will limit the response to be in cache for 10 seconds max
      // Any changes made to the response here will be reflected in the cached value
      headers.append('Cache-Control', 's-maxage=10');

      response = new Response(object.body, {
        headers,
      });

      // Store the fetched response as cacheKey
      // Use waitUntil so you can return the response without blocking on
      // writing to cache
      if (context && typeof context.waitUntil === 'function') {
        context.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (e) {
      return new Response('Error thrown ' + e.message, { status: 500 });
    }
  },
};
