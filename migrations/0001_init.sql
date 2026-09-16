CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  connect_token TEXT NOT NULL UNIQUE,
  ig_user_id TEXT,
  ig_username TEXT,
  ig_account_type TEXT,
  access_token_enc TEXT,
  token_expires_at INTEGER,
  token_refreshed_at INTEGER,
  feed_json TEXT,
  last_sync_at INTEGER,
  sync_error TEXT,
  show_posts INTEGER NOT NULL DEFAULT 1,
  show_reels INTEGER NOT NULL DEFAULT 1,
  show_stories INTEGER NOT NULL DEFAULT 0,
  post_limit INTEGER NOT NULL DEFAULT 9,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sites_connect_token ON sites(connect_token);
CREATE INDEX IF NOT EXISTS idx_sites_connected ON sites(access_token_enc);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
