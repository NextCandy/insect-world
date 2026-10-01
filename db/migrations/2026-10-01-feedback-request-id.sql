-- 仅用于尚无 request_id 的旧库；先用 PRAGMA table_info(messages) 确认。
-- 一次性增量迁移：保留全部既有留言与索引。新库直接使用 db/schema.sql。
ALTER TABLE messages ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_request_id ON messages (request_id);
