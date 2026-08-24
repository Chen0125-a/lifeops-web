ALTER TABLE media_assets
  ADD UNIQUE KEY uq_media_assets_user_id (user_id, id);

CREATE TABLE life_recipes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  cover_media_id CHAR(36) NULL,
  prep_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  cook_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'easy',
  category_id CHAR(36) NULL,
  tag_ids JSON NOT NULL,
  storage_notes TEXT NOT NULL,
  current_version_id CHAR(36) NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_recipes_user_id (user_id, id),
  KEY idx_life_recipes_user_name (user_id, name),
  KEY idx_life_recipes_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT chk_life_recipes_minutes CHECK (prep_minutes >= 0 AND cook_minutes >= 0),
  CONSTRAINT fk_life_recipes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_recipes_cover_media FOREIGN KEY (user_id, cover_media_id) REFERENCES media_assets(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_recipes_category FOREIGN KEY (user_id, category_id) REFERENCES life_categories(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_recipe_versions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  recipe_id CHAR(36) NOT NULL,
  version_number BIGINT UNSIGNED NOT NULL,
  servings DECIMAL(30,12) NOT NULL,
  yield_quantity DECIMAL(30,12) NULL,
  yield_unit VARCHAR(80) NULL,
  promoted_note TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_recipe_versions_user_id (user_id, id),
  UNIQUE KEY uq_life_recipe_versions_recipe_id (user_id, recipe_id, id),
  UNIQUE KEY uq_life_recipe_versions_number (user_id, recipe_id, version_number),
  CONSTRAINT chk_life_recipe_versions_servings CHECK (servings > 0),
  CONSTRAINT fk_life_recipe_versions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_recipe_versions_recipe FOREIGN KEY (user_id, recipe_id) REFERENCES life_recipes(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE life_recipes ADD CONSTRAINT fk_life_recipes_current_version FOREIGN KEY (user_id, current_version_id) REFERENCES life_recipe_versions(user_id, id) ON DELETE RESTRICT;
ALTER TABLE life_recipes ADD CONSTRAINT fk_life_recipes_current_version_recipe FOREIGN KEY (user_id, id, current_version_id) REFERENCES life_recipe_versions(user_id, recipe_id, id) ON DELETE RESTRICT;

CREATE TABLE life_recipe_components (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  recipe_version_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  quantity DECIMAL(30,12) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  component_role ENUM('ingredient', 'seasoning') NOT NULL,
  position INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_life_recipe_components_item (user_id, recipe_version_id, item_id),
  KEY idx_life_recipe_components_user_item (user_id, item_id, recipe_version_id),
  CONSTRAINT chk_life_recipe_components_quantity CHECK (quantity > 0),
  CONSTRAINT fk_life_recipe_components_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_recipe_components_version FOREIGN KEY (user_id, recipe_version_id) REFERENCES life_recipe_versions(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_recipe_components_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_recipe_steps (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  recipe_version_id CHAR(36) NOT NULL,
  instruction TEXT NOT NULL,
  ingredient_item_ids JSON NOT NULL,
  duration_seconds INT UNSIGNED NULL,
  image_media_id CHAR(36) NULL,
  caution TEXT NOT NULL,
  position INT UNSIGNED NOT NULL,
  KEY idx_life_recipe_steps_user_version_position (user_id, recipe_version_id, position),
  CONSTRAINT fk_life_recipe_steps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_recipe_steps_version FOREIGN KEY (user_id, recipe_version_id) REFERENCES life_recipe_versions(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_recipe_steps_media FOREIGN KEY (user_id, image_media_id) REFERENCES media_assets(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_life_recipe_versions_no_update BEFORE UPDATE ON life_recipe_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';
CREATE TRIGGER trg_life_recipe_versions_no_delete BEFORE DELETE ON life_recipe_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';
CREATE TRIGGER trg_life_recipe_components_no_update BEFORE UPDATE ON life_recipe_components
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';
CREATE TRIGGER trg_life_recipe_components_no_delete BEFORE DELETE ON life_recipe_components
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';
CREATE TRIGGER trg_life_recipe_steps_no_update BEFORE UPDATE ON life_recipe_steps
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';
CREATE TRIGGER trg_life_recipe_steps_no_delete BEFORE DELETE ON life_recipe_steps
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE';

CREATE TABLE life_cooking_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  recipe_id CHAR(36) NOT NULL,
  recipe_version_id CHAR(36) NOT NULL,
  planned_servings DECIMAL(30,12) NOT NULL,
  note TEXT NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  progress_json JSON NOT NULL DEFAULT (JSON_OBJECT('currentStepIndex', 0, 'completedStepIds', JSON_ARRAY(), 'actualIngredients', JSON_ARRAY(), 'timers', JSON_ARRAY())),
  status ENUM('active', 'completed') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_cooking_sessions_user_id (user_id, id),
  UNIQUE KEY uq_life_cooking_sessions_recipe_version (user_id, id, recipe_id, recipe_version_id),
  KEY idx_life_cooking_sessions_user_recipe_created (user_id, recipe_id, created_at),
  CONSTRAINT chk_life_cooking_sessions_planned_servings CHECK (planned_servings > 0),
  CONSTRAINT fk_life_cooking_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_cooking_sessions_recipe FOREIGN KEY (user_id, recipe_id) REFERENCES life_recipes(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_cooking_sessions_version FOREIGN KEY (user_id, recipe_id, recipe_version_id) REFERENCES life_recipe_versions(user_id, recipe_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_cooking_snapshots (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  cooking_session_id CHAR(36) NOT NULL,
  recipe_id CHAR(36) NOT NULL,
  recipe_version_id CHAR(36) NOT NULL,
  made_servings DECIMAL(30,12) NOT NULL,
  eaten_servings DECIMAL(30,12) NOT NULL,
  ingredients_snapshot JSON NOT NULL,
  total_cost_minor DECIMAL(30,6) NOT NULL,
  total_nutrition JSON NOT NULL,
  intake_nutrition JSON NOT NULL,
  cooking_oil_grams DECIMAL(30,12) NOT NULL,
  intake_cooking_oil_grams DECIMAL(30,12) NOT NULL,
  completed_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_cooking_snapshots_user_id (user_id, id),
  UNIQUE KEY uq_life_cooking_snapshots_recipe_version (user_id, id, recipe_id, recipe_version_id),
  UNIQUE KEY uq_life_cooking_snapshots_session (user_id, cooking_session_id),
  CONSTRAINT chk_life_cooking_snapshots_servings CHECK (made_servings > 0 AND eaten_servings >= 0 AND eaten_servings <= made_servings),
  CONSTRAINT fk_life_cooking_snapshots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_cooking_snapshots_session FOREIGN KEY (user_id, cooking_session_id, recipe_id, recipe_version_id) REFERENCES life_cooking_sessions(user_id, id, recipe_id, recipe_version_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_life_cooking_snapshots_no_update BEFORE UPDATE ON life_cooking_snapshots
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COOKING_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_cooking_snapshots_no_delete BEFORE DELETE ON life_cooking_snapshots
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COOKING_SNAPSHOT_IMMUTABLE';

CREATE TABLE life_prepared_food_stock (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  cooking_snapshot_id CHAR(36) NOT NULL,
  recipe_id CHAR(36) NOT NULL,
  recipe_version_id CHAR(36) NOT NULL,
  portions_created DECIMAL(30,12) NOT NULL,
  portions_remaining DECIMAL(30,12) NOT NULL,
  nutrition_remaining JSON NOT NULL,
  cooking_oil_grams_remaining DECIMAL(30,12) NOT NULL,
  cost_remaining_minor DECIMAL(30,6) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_prepared_food_user_id (user_id, id),
  KEY idx_life_prepared_food_user_recipe (user_id, recipe_id, created_at),
  CONSTRAINT chk_life_prepared_food_portions CHECK (portions_created > 0 AND portions_remaining >= 0 AND portions_remaining <= portions_created),
  CONSTRAINT fk_life_prepared_food_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_prepared_food_snapshot FOREIGN KEY (user_id, cooking_snapshot_id, recipe_id, recipe_version_id) REFERENCES life_cooking_snapshots(user_id, id, recipe_id, recipe_version_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_recipe_idempotency (
  user_id CHAR(36) NOT NULL,
  operation_key VARCHAR(220) NOT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, operation_key, idempotency_key),
  CONSTRAINT fk_life_recipe_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
