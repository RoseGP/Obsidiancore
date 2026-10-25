/**
 * Senior Database Architect: Dynamic Knex.js Migration for Omnichannel Marketing CRM.
 * Optimized with dedicated indexing for full-text search, trigrams, and custom JSONB containment.
 * 
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
  // 1. Install PostgreSQL specialized extensions
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // 2. Build 'users' Table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.string('email', 255).unique().notNullable();
    table.string('role', 50).defaultTo('agent').notNullable();
    table.string('timezone', 100).defaultTo('UTC').notNullable();
    table.boolean('is_active').defaultTo(true).notNullable();
    table.timestamps(true, true); // creates created_at and updated_at with timezone defaults

    table.index(['email'], 'idx_users_email');
  });

  // 3. Build 'contacts' Table
  await knex.schema.createTable('contacts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name', 255).notNullable();
    table.string('email', 255).unique().notNullable();
    table.string('phone', 50);
    table.string('company_name', 255);
    table.string('lifecycle_status', 50).defaultTo('lead').notNullable();
    
    // GIN-indexed JSONB column for custom metadata fields and variables
    table.jsonb('custom_fields').defaultTo('{}').notNullable();
    
    // Relationship assignments linking managers
    table.uuid('owner_id').references('id').inTable('users').onDelete('SET NULL');
    
    table.timestamps(true, true);

    table.index(['email'], 'idx_contacts_email');
    table.index(['phone'], 'idx_contacts_phone_exact');
  });

  // Check constraints and JSONB GIN indices
  await knex.raw(`
    ALTER TABLE contacts 
    ADD CONSTRAINT chk_lifecycle_status 
    CHECK (lifecycle_status IN ('lead', 'mql', 'sql', 'customer', 'churned', 'inactive'));
  `);
  
  await knex.raw('CREATE INDEX idx_contacts_custom_fields_gin ON contacts USING gin(custom_fields);');
  await knex.raw(`
    CREATE INDEX idx_contacts_phone_normalized 
    ON contacts(regexp_replace(phone, '\\D', '', 'g'));
  `);

  // 4. Build 'communications' Table
  await knex.schema.createTable('communications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('channel', 50).notNullable();
    table.string('direction', 20).notNullable();
    table.string('subject', 255);
    table.text('body').notNullable();
    table.string('status', 50).defaultTo('sent').notNullable();
    table.specificType('media_urls', 'text[]').defaultTo('{}').notNullable();
    table.text('error_message');

    table.uuid('contact_id').notNullable().references('id').inTable('contacts').onDelete('CASCADE');
    table.uuid('sender_id').references('id').inTable('users').onDelete('SET NULL');

    table.timestamp('sent_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['contact_id'], 'idx_communications_contact_id');
    table.index(['sender_id'], 'idx_communications_sender_id');
    table.index(['channel', 'status'], 'idx_communications_channel_status');
    table.index(['sent_at'], 'idx_communications_sent_at_desc');
  });

  // Add enum constraints
  await knex.raw(`
    ALTER TABLE communications 
    ADD CONSTRAINT chk_comm_channel_knex CHECK (channel IN ('email', 'sms', 'whatsapp', 'google_business'));
  `);
  await knex.raw(`
    ALTER TABLE communications 
    ADD CONSTRAINT chk_comm_direction_knex CHECK (direction IN ('inbound', 'outbound'));
  `);
  await knex.raw(`
    ALTER TABLE communications 
    ADD CONSTRAINT chk_comm_status_knex CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed'));
  `);

  // Advanced index definitions
  // Lexical English Full-text searches on aggregated message fields
  await knex.raw(`
    CREATE INDEX idx_communications_body_fts 
    ON communications USING gin(to_tsvector('english', coalesce(subject, '') || ' ' || body));
  `);

  // Trigram partial searches (LIKE '%pattern%')
  await knex.raw('CREATE INDEX idx_communications_body_trgm ON communications USING gin(body gin_trgm_ops);');
  await knex.raw('CREATE INDEX idx_communications_subject_trgm ON communications USING gin(subject gin_trgm_ops);');

  // 5. Build 'social_posts' Table
  await knex.schema.createTable('social_posts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.text('body').notNullable();
    table.specificType('media_urls', 'text[]').defaultTo('{}').notNullable();
    table.timestamp('scheduled_at');
    table.string('status', 50).defaultTo('draft').notNullable();
    table.specificType('platforms', 'varchar(100)[]').notNullable();
    table.text('error_log');

    table.uuid('creator_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    
    table.timestamps(true, true);

    table.index(['creator_id'], 'idx_social_posts_creator_id');
  });

  await knex.raw(`
    ALTER TABLE social_posts 
    ADD CONSTRAINT chk_social_status_knex CHECK (status IN ('draft', 'scheduled', 'published', 'failed'));
  `);

  // Scheduler worker performance composite filter index
  await knex.raw(`
    CREATE INDEX idx_social_posts_scheduler 
    ON social_posts(status, scheduled_at) 
    WHERE status = 'scheduled';
  `);

  // 6. Build automated 'updated_at' triggers
  await knex.raw(`
    CREATE OR REPLACE FUNCTION knex_update_timestamp_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_knex_users_update_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION knex_update_timestamp_column();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_knex_contacts_update_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION knex_update_timestamp_column();
  `);
  await knex.raw(`
    CREATE TRIGGER trg_knex_social_posts_update_at BEFORE UPDATE ON social_posts
    FOR EACH ROW EXECUTE FUNCTION knex_update_timestamp_column();
  `);
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
  // Cascading drops automatically clean triggers & indexes
  await knex.schema.dropTableIfExists('social_posts');
  await knex.schema.dropTableIfExists('communications');
  await knex.schema.dropTableIfExists('contacts');
  await knex.schema.dropTableIfExists('users');
  
  await knex.raw('DROP FUNCTION IF EXISTS knex_update_timestamp_column() CASCADE;');
  await knex.raw('DROP EXTENSION IF EXISTS pg_trgm;');
}
