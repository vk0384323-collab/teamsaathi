const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vjesrebkdrqbjkkcebpm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZXNyZWJrZHJxYmpra2NlYnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDM2MTMsImV4cCI6MjEwNDY3OTYxM30.zqVXvFCqYwEYRoaB1kWLwKOQSLov1crchZ-SFhCL2_o';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -------------------------------------------------------
// Unified DB helper — wraps Supabase calls cleanly
// -------------------------------------------------------
const db = {
  supabase,

  // SELECT rows from a table
  async from(table) {
    return supabase.from(table);
  },

  // Run raw SQL via Supabase RPC (for complex joins, use individual table queries instead)
  async rpc(fn, params) {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw error;
    return data;
  }
};

// -------------------------------------------------------
// initDatabase — verify Supabase connection
// -------------------------------------------------------
async function initDatabase() {
  try {
    const { data, error } = await supabase.from('departments').select('count').limit(1);
    if (error) {
      console.error('[Database] Supabase connection error:', error.message);
    } else {
      console.log('[Database] Supabase connected successfully');
    }
  } catch (err) {
    console.error('[Database] Failed to connect to Supabase:', err.message);
  }
  return db;
}

// No-op for compatibility (Supabase auto-saves)
function saveDb() {}

// No-op for compatibility
function clearDemoData() {
  console.log('[Database] clearDemoData is a no-op with Supabase.');
}

module.exports = { db, supabase, initDatabase, saveDb, clearDemoData };
