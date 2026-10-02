CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS papers (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, filename text NOT NULL, file_data bytea NOT NULL, file_size integer NOT NULL,
 sha256 text NOT NULL, authors text[] NOT NULL DEFAULT '{}', year integer,
 tags text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
 error text, page_count integer, analysis jsonb, embedding_model text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id), UNIQUE(user_id,sha256)
);
CREATE INDEX papers_owner ON papers(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS chunks (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, paper_id uuid NOT NULL,
 ordinal integer NOT NULL, page integer NOT NULL CHECK(page>0), section text, content text NOT NULL,
 embedding vector(1536) NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
 FOREIGN KEY(user_id,paper_id) REFERENCES papers(user_id,id) ON DELETE CASCADE, UNIQUE(paper_id,ordinal)
);
CREATE INDEX chunks_owner_paper ON chunks(user_id,paper_id);
CREATE INDEX chunks_search ON chunks USING gin(search);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, paper_id uuid NOT NULL UNIQUE REFERENCES papers(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim ON jobs(status,available_at);
CREATE TABLE IF NOT EXISTS collections (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id), UNIQUE(user_id,name)
);
CREATE TABLE IF NOT EXISTS collection_papers (
 user_id uuid NOT NULL, collection_id uuid NOT NULL, paper_id uuid NOT NULL,
 PRIMARY KEY(collection_id,paper_id),
 FOREIGN KEY(user_id,collection_id) REFERENCES collections(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,paper_id) REFERENCES papers(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, mode text NOT NULL CHECK(mode IN ('chat','compare')), paper_ids uuid[] NOT NULL DEFAULT '{}',
 generation_token uuid, generation_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id)
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'complete' CHECK(status IN ('pending','streaming','complete','failed','cancelled')),
 citations jsonb NOT NULL DEFAULT '[]', request_id uuid, error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
 UNIQUE(conversation_id,request_id,role)
);
CREATE INDEX messages_conversation ON messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
