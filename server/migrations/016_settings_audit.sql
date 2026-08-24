CREATE TABLE IF NOT EXISTS user_settings (
  user_id CHAR(36) PRIMARY KEY,
  settings_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_sessions_user_created ON sessions (user_id, created_at);

CREATE TABLE IF NOT EXISTS data_transfer_restore_points (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  schema_version INT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  record_counts_json JSON NOT NULL,
  canonical_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_data_transfer_restore_owner (user_id, id),
  KEY idx_data_transfer_restore_owner_created (user_id, created_at, id),
  CONSTRAINT chk_data_transfer_restore_schema CHECK (schema_version = 1),
  CONSTRAINT fk_data_transfer_restore_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS trg_data_transfer_restore_no_update;
CREATE TRIGGER trg_data_transfer_restore_no_update BEFORE UPDATE ON data_transfer_restore_points FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DATA_TRANSFER_RESTORE_POINT_IMMUTABLE';

DROP TRIGGER IF EXISTS trg_data_transfer_restore_no_delete;
CREATE TRIGGER trg_data_transfer_restore_no_delete BEFORE DELETE ON data_transfer_restore_points FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DATA_TRANSFER_RESTORE_POINT_IMMUTABLE';
