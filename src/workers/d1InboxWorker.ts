/**
 * Cloudflare Worker Endpoint: GET /api/inbox
 * Target Runtime: Cloudflare Workers Edge Engine
 *
 * Database Binding:
 *  - env.DB: Cloudflare D1 Database binding ("obsidiandashoarddb" - adc1da90-6d37-45e1-88ce-9522ea7bf3ee)
 *
 * Schema Structure:
 *  - users (id, email, name, created_at)
 *  - emails (id, thread_id, sender, subject, body_text, created_at)
 *  - threads (id, subject, updated_at)
 *  - user_emails (user_id, email_id, folder, is_read, created_at)
 */

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { rows_written?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  DATABASE_NAME?: string;
  DATABASE_ID?: string;
}

export interface EmailRecord {
  id: string;
  threadId: string;
  sender: string;
  subject: string;
  bodyText: string;
  createdAt: string;
  folder: string;
  isRead: boolean;
  userId: string;
}

export interface InboxPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface InboxApiResponse {
  success: boolean;
  data: EmailRecord[];
  pagination: InboxPagination;
  filter: {
    userId: string;
    folder: string;
    search?: string;
  };
  d1Metadata: {
    database: string;
    databaseId: string;
    binding: string;
  };
}

/**
 * Cloudflare Worker Handler for GET /api/inbox
 */
export async function handleInboxRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // Parse Query Parameters
  const userId = url.searchParams.get('userId') || 'usr_101';
  const folder = url.searchParams.get('folder') || 'inbox';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));
  const search = url.searchParams.get('search')?.trim() || '';

  const offset = (page - 1) * limit;

  try {
    // 1. Construct SQL queries joining user_emails with emails
    let querySql = `
      SELECT 
        e.id,
        e.thread_id AS threadId,
        e.sender,
        e.subject,
        e.body_text AS bodyText,
        e.created_at AS createdAt,
        ue.user_id AS userId,
        ue.folder,
        CASE WHEN ue.is_read = 1 OR ue.is_read = 'true' THEN 1 ELSE 0 END AS isRead
      FROM user_emails ue
      INNER JOIN emails e ON ue.email_id = e.id
      WHERE ue.user_id = ? AND ue.folder = ?
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM user_emails ue
      INNER JOIN emails e ON ue.email_id = e.id
      WHERE ue.user_id = ? AND ue.folder = ?
    `;

    const queryParams: any[] = [userId, folder];
    const countParams: any[] = [userId, folder];

    // Optional Search Filter
    if (search) {
      const searchPattern = `%${search}%`;
      querySql += ` AND (e.sender LIKE ? OR e.subject LIKE ? OR e.body_text LIKE ?)`;
      countSql += ` AND (e.sender LIKE ? OR e.subject LIKE ? OR e.body_text LIKE ?)`;
      
      queryParams.push(searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern);
    }

    // Add Order and Pagination Limits
    querySql += ` ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    // 2. Execute SQL Queries on D1 Database
    const countResult = await env.DB.prepare(countSql).bind(...countParams).first<{ total: number }>();
    const total = countResult ? countResult.total : 0;

    const emailsQuery = await env.DB.prepare(querySql).bind(...queryParams).all<any>();
    const rawResults = emailsQuery.results || [];

    // Map database rows to clean EmailRecord objects
    const emails: EmailRecord[] = rawResults.map((row) => ({
      id: row.id || `msg_${Math.random().toString(36).substring(2, 8)}`,
      threadId: row.threadId || row.thread_id || `thread_${Math.random().toString(36).substring(2, 8)}`,
      sender: row.sender || 'unknown@domain.com',
      subject: row.subject || '(No Subject)',
      bodyText: row.bodyText || row.body_text || '',
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
      folder: row.folder || folder,
      isRead: Boolean(row.isRead || row.is_read),
      userId: row.userId || row.user_id || userId,
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    const responsePayload: InboxApiResponse = {
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      filter: {
        userId,
        folder,
        search: search || undefined,
      },
      d1Metadata: {
        database: env.DATABASE_NAME || 'obsidiandashoarddb',
        databaseId: env.DATABASE_ID || 'adc1da90-6d37-45e1-88ce-9522ea7bf3ee',
        binding: 'DB',
      },
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    console.error('[Cloudflare D1 Worker Error] GET /api/inbox failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to query D1 database inbox table',
        d1Metadata: {
          database: 'obsidiandashoarddb',
          databaseId: 'adc1da90-6d37-45e1-88ce-9522ea7bf3ee',
          binding: 'DB',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Standard Worker Default Export
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/inbox' && request.method === 'GET') {
      return handleInboxRequest(request, env);
    }
    return new Response('Not Found', { status: 404 });
  },
};
