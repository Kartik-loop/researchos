ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
CREATE TABLE account_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_owner ON account_tokens(user_id,purpose);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);
CREATE INDEX sessions_owner ON sessions(user_id);
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);
CREATE INDEX conversations_owner_updated ON conversations(user_id,updated_at DESC);
CREATE INDEX collection_papers_owner_paper ON collection_papers(user_id,paper_id);
