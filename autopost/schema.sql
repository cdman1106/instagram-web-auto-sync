-- Dedicated D1 database for autopost. Do not run against existing website-sync DB.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL CHECK(account IN ('touchcd','ippuku')),
  local_date TEXT NOT NULL,
  status TEXT NOT NULL,
  theme TEXT,
  caption TEXT,
  image_key TEXT,
  image_source TEXT,
  publish_after INTEGER NOT NULL,
  container_id TEXT,
  instagram_media_id TEXT,
  error_text TEXT,
  metrics_json TEXT,
  metrics_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account, local_date)
);
CREATE INDEX IF NOT EXISTS idx_posts_due ON posts(status,publish_after);
CREATE INDEX IF NOT EXISTS idx_posts_metrics ON posts(account,status,metrics_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL CHECK(account IN ('touchcd','ippuku')),
  r2_key TEXT NOT NULL UNIQUE,
  approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_assets_rotation ON assets(account,approved,last_used_at);

CREATE TABLE IF NOT EXISTS ig_tokens (
  account TEXT PRIMARY KEY CHECK(account IN ('touchcd','ippuku')),
  cipher TEXT NOT NULL,
  nonce TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
