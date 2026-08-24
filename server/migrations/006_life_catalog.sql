CREATE TABLE life_categories (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  parent_id CHAR(36) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  position INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_categories_user_id (user_id, id),
  UNIQUE KEY uq_life_categories_user_name (user_id, name),
  KEY idx_life_categories_user_parent_position (user_id, parent_id, position),
  KEY idx_life_categories_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT fk_life_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_categories_parent FOREIGN KEY (user_id, parent_id) REFERENCES life_categories(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_tags (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_tags_user_id (user_id, id),
  UNIQUE KEY uq_life_tags_user_name (user_id, name),
  KEY idx_life_tags_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT fk_life_tags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_locations (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  parent_id CHAR(36) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  position INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_locations_user_id (user_id, id),
  UNIQUE KEY uq_life_locations_user_name (user_id, name),
  KEY idx_life_locations_user_parent_position (user_id, parent_id, position),
  KEY idx_life_locations_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT fk_life_locations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_locations_parent FOREIGN KEY (user_id, parent_id) REFERENCES life_locations(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_units (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  dimension ENUM('mass', 'volume', 'count', 'package', 'time') NOT NULL,
  base_code VARCHAR(80) NOT NULL,
  to_base_factor DECIMAL(30,12) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_units_user_id (user_id, id),
  UNIQUE KEY uq_life_units_user_code (user_id, code),
  KEY idx_life_units_user_dimension_deleted (user_id, dimension, deleted_at),
  CONSTRAINT chk_life_units_factor CHECK (to_base_factor IS NULL OR to_base_factor > 0),
  CONSTRAINT fk_life_units_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_kind ENUM('ingredient', 'supplement', 'medicine', 'household_consumable', 'household_durable') NOT NULL,
  name VARCHAR(240) NOT NULL,
  aliases JSON NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  category_id CHAR(36) NULL,
  location_id CHAR(36) NULL,
  base_unit VARCHAR(80) NOT NULL,
  available_units JSON NOT NULL,
  notes TEXT NOT NULL,
  custom_order INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_items_user_id (user_id, id),
  KEY idx_life_items_user_kind_deleted_updated (user_id, item_kind, deleted_at, updated_at),
  KEY idx_life_items_user_category_order (user_id, category_id, custom_order),
  KEY idx_life_items_user_location (user_id, location_id),
  CONSTRAINT fk_life_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_items_category FOREIGN KEY (user_id, category_id) REFERENCES life_categories(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_items_location FOREIGN KEY (user_id, location_id) REFERENCES life_locations(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_item_profiles (
  item_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  profile_kind ENUM('ingredient', 'supplement', 'medicine', 'household_consumable', 'household_durable') NOT NULL,
  profile_data JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (item_id, profile_kind),
  KEY idx_life_item_profiles_user_kind_deleted (user_id, profile_kind, deleted_at),
  CONSTRAINT fk_life_item_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_profiles_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_item_tags (
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  tag_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (item_id, tag_id),
  KEY idx_life_item_tags_user_tag (user_id, tag_id),
  KEY idx_life_item_tags_user_item_position (user_id, item_id, position),
  CONSTRAINT fk_life_item_tags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_tags_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_tags_tag FOREIGN KEY (user_id, tag_id) REFERENCES life_tags(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_item_unit_conversions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  from_unit VARCHAR(80) NOT NULL,
  to_unit VARCHAR(80) NOT NULL,
  conversion_factor DECIMAL(30,12) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_item_conversions_rule (user_id, item_id, from_unit, to_unit),
  KEY idx_life_item_conversions_user_item_deleted (user_id, item_id, deleted_at),
  CONSTRAINT chk_life_item_conversions_factor CHECK (conversion_factor > 0),
  CONSTRAINT fk_life_item_conversions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_conversions_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_price_history (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  purchase_quantity DECIMAL(30,12) NOT NULL,
  purchase_unit VARCHAR(80) NOT NULL,
  effective_from DATE NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_price_history_effective (user_id, item_id, effective_from, purchase_unit, currency),
  KEY idx_life_price_history_user_item_effective (user_id, item_id, effective_from, deleted_at),
  CONSTRAINT chk_life_price_history_quantity CHECK (purchase_quantity > 0),
  CONSTRAINT fk_life_price_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_price_history_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_item_attachments (
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  media_id CHAR(36) NOT NULL,
  caption VARCHAR(500) NOT NULL DEFAULT '',
  position INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (item_id, media_id),
  KEY idx_life_item_attachments_user_item_position (user_id, item_id, position),
  CONSTRAINT fk_life_item_attachments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_attachments_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_life_item_attachments_media FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_trash_references (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  reference_type VARCHAR(80) NOT NULL,
  reference_id CHAR(36) NOT NULL,
  reference_snapshot JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  restored_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_trash_reference (user_id, entity_type, entity_id, reference_type, reference_id),
  KEY idx_life_trash_references_user_entity (user_id, entity_type, entity_id, restored_at),
  CONSTRAINT fk_life_trash_references_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
