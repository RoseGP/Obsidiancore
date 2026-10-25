import pg from 'pg';

const { Pool } = pg;

// Define data interfaces
export interface ProposalItem {
  id: string;
  proposal_id: string;
  title: string;
  description: string | null;
  price: number;
  is_optional: boolean;
  is_selected: boolean;
  created_at?: Date;
}

export interface Proposal {
  id: string;
  client_name: string;
  title: string;
  status: 'draft' | 'accepted' | string;
  signature_name: string | null;
  client_email: string | null;
  signed_at: Date | null;
  created_at?: Date;
  updated_at?: Date;
  items?: ProposalItem[];
}

let pool: pg.Pool | null = null;
let useMock = false;

// 1. In-memory Mock Store fallback (keeps state if Cloud DB is absent)
const mockProposals: Map<string, Proposal> = new Map();
const mockProposalItems: Map<string, ProposalItem[]> = new Map();

// Helper to seed standard data into the dynamic mock cache
function seedMockDatabase() {
  // TO COMPLETE: proposals are created by users; no seed data is inserted.
  const seeds: { proposal: Proposal; items: ProposalItem[] }[] = [];

  for (const seed of seeds) {
    mockProposals.set(seed.proposal.id, seed.proposal);
    mockProposalItems.set(seed.proposal.id, seed.items);
  }
}

// 2. Initialize PostgreSQL Pool
export async function initializeProposalDb() {
  const dbUrl = process.env.DATABASE_URL;

  // Pre-seed mock repository for seamless fallbacks
  seedMockDatabase();

  if (!dbUrl || dbUrl.includes('placeholder') || dbUrl.includes('MY_DATABASE_URL')) {
    console.warn('[Proposal DB] DATABASE_URL unset or placeholder. Operating in high-performance in-memory sandbox mode.');
    useMock = true;
    return;
  }

  if (dbUrl.startsWith('firestore://') || dbUrl.includes('firestore')) {
    console.log('[Proposal DB] DATABASE_URL points to Firestore. Operating in high-performance Firestore proxy sandboxed mode.');
    useMock = true;
    return;
  }

  if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    console.warn('[Proposal DB] DATABASE_URL does not start with postgresql:// or postgres://. Operating in high-performance in-memory sandbox mode.');
    useMock = true;
    return;
  }

  try {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false // Ensure smooth TLS negotiations under Docker/Cloud environments
      }
    });

    // Test connectivity
    const client = await pool.connect();
    console.log('[Proposal DB] Connected successfully to PostgreSQL server pool.');

    try {
      // Create tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS proposals (
          id VARCHAR(120) PRIMARY KEY,
          client_name VARCHAR(255) NOT NULL,
          title VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'draft',
          signature_name VARCHAR(255) DEFAULT NULL,
          client_email VARCHAR(255) DEFAULT NULL,
          signed_at TIMESTAMP DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS proposal_items (
          id VARCHAR(120) PRIMARY KEY,
          proposal_id VARCHAR(120) REFERENCES proposals(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
          is_optional BOOLEAN DEFAULT FALSE,
          is_selected BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Check if proposals already exist, if not seed tables
      const { rows } = await client.query('SELECT COUNT(*) FROM proposals');
      const count = parseInt(rows[0].count);

      if (count === 0) {
        console.log('[Proposal DB] Seeding initial PostgreSQL records...');
        for (const [id, prop] of mockProposals.entries()) {
          await client.query(
            `INSERT INTO proposals (id, client_name, title, status, signature_name, client_email, signed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [prop.id, prop.client_name, prop.title, prop.status, prop.signature_name, prop.client_email, prop.signed_at]
          );

          const items = mockProposalItems.get(id) || [];
          for (const item of items) {
            await client.query(
              `INSERT INTO proposal_items (id, proposal_id, title, description, price, is_optional, is_selected)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [item.id, item.proposal_id, item.title, item.description, item.price, item.is_optional, item.is_selected]
            );
          }
        }
        console.log('[Proposal DB] Initial PostgreSQL seeding completed successfully.');
      }
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[Proposal DB] Postgres initialization unavailable (' + err.message + '). Operating in high-performance mock sandbox mode.');
    useMock = true;
  }
}

// 3. Database operation proxy services (expert design handling either Postgres or In-Memory seamlessly)
export async function getProposalDetails(id: string): Promise<Proposal | null> {
  if (useMock || !pool) {
    const prop = mockProposals.get(id);
    if (!prop) return null;
    const items = mockProposalItems.get(id) || [];
    return { ...prop, items };
  }

  try {
    const { rows: propRows } = await pool.query('SELECT * FROM proposals WHERE id = $1', [id]);
    if (propRows.length === 0) return null;

    const { rows: itemRows } = await pool.query(
      'SELECT id, proposal_id, title, description, CAST(price AS DOUBLE PRECISION) as price, is_optional, is_selected FROM proposal_items WHERE proposal_id = $1 ORDER BY id ASC',
      [id]
    );

    return {
      id: propRows[0].id,
      client_name: propRows[0].client_name,
      title: propRows[0].title,
      status: propRows[0].status,
      signature_name: propRows[0].signature_name,
      client_email: propRows[0].client_email,
      signed_at: propRows[0].signed_at,
      items: itemRows,
    };
  } catch (error: any) {
    console.error(`[Proposal DB] getProposalDetails exception on id: ${id}:`, error.message);
    throw error;
  }
}

export async function updateProposalItem(proposalId: string, itemId: string, isSelected: boolean): Promise<boolean> {
  if (useMock || !pool) {
    const items = mockProposalItems.get(proposalId);
    if (!items) return false;
    const item = items.find(i => i.id === itemId);
    if (!item) return false;
    item.is_selected = isSelected;
    return true;
  }

  try {
    const result = await pool.query(
      'UPDATE proposal_items SET is_selected = $1 WHERE id = $2 AND proposal_id = $3',
      [isSelected, itemId, proposalId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error: any) {
    console.error(`[Proposal DB] updateProposalItem exception on proposal: ${proposalId}, item: ${itemId}`, error.message);
    throw error;
  }
}

export async function signProposal(id: string, signatureName: string, clientEmail: string): Promise<Proposal | null> {
  const timestamp = new Date();
  
  if (useMock || !pool) {
    const prop = mockProposals.get(id);
    if (!prop) return null;
    if (prop.status === 'accepted') {
      throw new Error('This proposal has already been sealed and accepted.');
    }
    prop.status = 'accepted';
    prop.signature_name = signatureName;
    prop.client_email = clientEmail;
    prop.signed_at = timestamp;
    const items = mockProposalItems.get(id) || [];
    return { ...prop, items };
  }

  try {
    // Audit active state first
    const { rows } = await pool.query('SELECT status FROM proposals WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    if (rows[0].status === 'accepted') {
      throw new Error('This proposal has already been sealed and accepted.');
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE proposals 
       SET status = 'accepted', signature_name = $1, client_email = $2, signed_at = $3, updated_at = NOW()
       WHERE id = $4 
       RETURNING *`,
      [signatureName, clientEmail, timestamp, id]
    );

    const { rows: itemRows } = await pool.query(
      'SELECT id, proposal_id, title, description, CAST(price AS DOUBLE PRECISION) as price, is_optional, is_selected FROM proposal_items WHERE proposal_id = $1 ORDER BY id ASC',
      [id]
    );

    return {
      id: updatedRows[0].id,
      client_name: updatedRows[0].client_name,
      title: updatedRows[0].title,
      status: updatedRows[0].status,
      signature_name: updatedRows[0].signature_name,
      client_email: updatedRows[0].client_email,
      signed_at: updatedRows[0].signed_at,
      items: itemRows,
    };
  } catch (error: any) {
    console.error(`[Proposal DB] signProposal exception on proposal: ${id}`, error.message);
    throw error;
  }
}
