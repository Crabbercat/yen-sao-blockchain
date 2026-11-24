CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(80) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name varchar(120) NOT NULL,
  organization_msp varchar(80),
  role varchar(40) NOT NULL CHECK (role IN (
    'harvest_operator',
    'processing_operator',
    'quality_inspector',
    'distributor',
    'auditor',
    'consumer',
    'security_admin',
    'system_admin'
  )),
  fabric_identity varchar(80),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id varchar(64) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  target varchar(200),
  outcome varchar(20) NOT NULL CHECK (outcome IN ('success', 'failure')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS file_metadata (
  storage_id uuid PRIMARY KEY,
  batch_id varchar(64) NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_metadata_batch_id_idx ON file_metadata(batch_id);

CREATE TABLE IF NOT EXISTS security_test_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id varchar(80) NOT NULL,
  target varchar(255) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  evidence_path varchar(500)
);
