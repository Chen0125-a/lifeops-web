CREATE TABLE IF NOT EXISTS knowledge_collections (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(32) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_knowledge_collections_owner_name (user_id, name),
  KEY idx_knowledge_collections_owner_position (user_id, position, id),
  CONSTRAINT fk_knowledge_collections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE knowledge_notes
  MODIFY source_type ENUM('record', 'review') NULL,
  MODIFY source_id CHAR(36) NULL,
  ADD COLUMN collection_ids JSON NULL AFTER tags,
  ADD COLUMN source_links JSON NULL AFTER collection_ids,
  ADD COLUMN related_ids JSON NULL AFTER source_links,
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE AFTER related_ids,
  ADD COLUMN favorite BOOLEAN NOT NULL DEFAULT FALSE AFTER pinned,
  ADD COLUMN review_on DATE NULL AFTER favorite,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER review_on,
  ADD COLUMN updated_at DATETIME(3) NULL AFTER created_at,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER updated_at,
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER archived_at;

UPDATE knowledge_notes
SET collection_ids = JSON_ARRAY(),
    source_links = CASE
      WHEN source_type IS NULL OR source_id IS NULL THEN JSON_ARRAY()
      ELSE JSON_ARRAY(JSON_OBJECT('type', source_type, 'id', source_id))
    END,
    related_ids = JSON_ARRAY(),
    updated_at = created_at
WHERE collection_ids IS NULL OR source_links IS NULL OR related_ids IS NULL OR updated_at IS NULL;

ALTER TABLE knowledge_notes
  MODIFY collection_ids JSON NOT NULL,
  MODIFY source_links JSON NOT NULL,
  MODIFY related_ids JSON NOT NULL,
  MODIFY updated_at DATETIME(3) NOT NULL,
  ADD KEY idx_knowledge_owner_updated (user_id, updated_at, id),
  ADD KEY idx_knowledge_owner_review (user_id, review_on, id),
  ADD KEY idx_knowledge_owner_archive_delete (user_id, archived_at, deleted_at);
