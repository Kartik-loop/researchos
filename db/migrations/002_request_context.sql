-- Preserve each question's retrieval scope even when later turns select other
-- papers. An idempotency key must identify the full request, not just its text.
ALTER TABLE messages ADD COLUMN request_context jsonb;
CREATE INDEX messages_owner_request ON messages(user_id,request_id) WHERE request_id IS NOT NULL;
