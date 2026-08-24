ALTER TABLE life_records
  ADD COLUMN cover_media_id CHAR(36) NULL AFTER archived_at,
  ADD KEY idx_records_user_cover (user_id, cover_media_id),
  ADD CONSTRAINT fk_life_records_cover_media
    FOREIGN KEY (cover_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
