ALTER TABLE life_records
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE AFTER tags,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER pinned,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER archived_at,
  ADD COLUMN updated_at DATETIME(3) NULL AFTER created_at,
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER updated_at,
  ADD KEY idx_records_user_deleted_occurred (user_id, deleted_at, occurred_at),
  ADD KEY idx_records_user_archived_updated (user_id, archived_at, updated_at);

UPDATE life_records
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE life_records
  MODIFY COLUMN updated_at DATETIME(3) NOT NULL;

CREATE TABLE record_links (
  record_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  link_type ENUM('goal', 'project', 'task', 'habit') NOT NULL,
  link_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (record_id, link_type, link_id),
  KEY idx_record_links_user_link (user_id, link_type, link_id),
  KEY idx_record_links_user_record_position (user_id, record_id, position),
  CONSTRAINT fk_record_links_record FOREIGN KEY (record_id) REFERENCES life_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_links_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE record_media (
  record_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  media_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (record_id, media_id),
  KEY idx_record_media_user_media (user_id, media_id),
  KEY idx_record_media_user_record_position (user_id, record_id, position),
  CONSTRAINT fk_record_media_record FOREIGN KEY (record_id) REFERENCES life_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_media_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_media_asset FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
