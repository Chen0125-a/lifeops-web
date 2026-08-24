CREATE TABLE life_plan_templates (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(240) NOT NULL,
  meal_slots_json JSON NOT NULL,
  items_json JSON NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_plan_templates_user_id (user_id, id),
  KEY idx_life_plan_templates_user_name (user_id, name),
  CONSTRAINT fk_life_plan_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_day_plans (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_date DATE NOT NULL,
  meal_slots_json JSON NOT NULL,
  items_json JSON NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  conflicted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_day_plans_user_id (user_id, id),
  UNIQUE KEY uq_life_day_plans_user_date (user_id, plan_date),
  KEY idx_life_day_plans_user_date_state (user_id, plan_date, conflicted),
  CONSTRAINT fk_life_day_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_template_applications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  template_id CHAR(36) NOT NULL,
  day_plan_id CHAR(36) NOT NULL,
  applied_template_version BIGINT UNSIGNED NOT NULL,
  resolution ENUM('merge', 'replace', 'skip') NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_template_applications_user_id (user_id, id),
  KEY idx_life_template_applications_template_day (user_id, template_id, day_plan_id),
  CONSTRAINT fk_life_template_applications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_template_applications_template FOREIGN KEY (user_id, template_id) REFERENCES life_plan_templates(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_template_applications_day FOREIGN KEY (user_id, day_plan_id) REFERENCES life_day_plans(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_medicine_recurrence_rules (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  source_item_id CHAR(36) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  recurrence_json JSON NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_life_medicine_recurrence_user_id (user_id, id),
  KEY idx_life_medicine_recurrence_owner_state (user_id, deleted_at, title),
  KEY idx_life_medicine_recurrence_source (user_id, source_item_id, deleted_at),
  CONSTRAINT chk_life_medicine_recurrence_quantity CHECK (quantity > 0),
  CONSTRAINT chk_life_medicine_recurrence_version CHECK (entity_version >= 1 AND updated_at >= created_at),
  CONSTRAINT fk_life_medicine_recurrence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_medicine_recurrence_source FOREIGN KEY (user_id, source_item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_medicine_recurrence_occurrences (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  source_item_id CHAR(36) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  original_date DATE NOT NULL,
  original_time TIME NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  status ENUM('planned', 'completed', 'skipped', 'cancelled') NOT NULL,
  completion_id CHAR(36) NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_medicine_occurrences_user_id (user_id, id),
  UNIQUE KEY uq_life_medicine_occurrence_identity (user_id, rule_id, original_date, original_time),
  KEY idx_life_medicine_occurrences_owner_schedule (user_id, scheduled_date, scheduled_time, status),
  KEY idx_life_medicine_occurrences_rule_state (user_id, rule_id, status, scheduled_date),
  KEY idx_life_medicine_occurrences_source (user_id, source_item_id, status),
  KEY idx_life_medicine_occurrences_completion (user_id, completion_id),
  CONSTRAINT chk_life_medicine_occurrence_quantity CHECK (quantity > 0),
  CONSTRAINT chk_life_medicine_occurrence_version CHECK (entity_version >= 1 AND updated_at >= created_at),
  CONSTRAINT chk_life_medicine_occurrence_completion CHECK ((status = 'completed' AND completion_id IS NOT NULL) OR (status <> 'completed' AND completion_id IS NULL)),
  CONSTRAINT fk_life_medicine_occurrences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_medicine_occurrences_rule FOREIGN KEY (user_id, rule_id) REFERENCES life_medicine_recurrence_rules(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_medicine_occurrences_source FOREIGN KEY (user_id, source_item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fitness_activities (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(240) NOT NULL,
  default_minutes DECIMAL(10,2) NOT NULL,
  kcal_per_hour DECIMAL(18,6) NOT NULL,
  intensity VARCHAR(120) NOT NULL,
  steps_json JSON NOT NULL,
  equipment_json JSON NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_fitness_activities_user_id (user_id, id),
  KEY idx_fitness_activities_user_name (user_id, name),
  CONSTRAINT chk_fitness_activities_values CHECK (default_minutes >= 0 AND kcal_per_hour >= 0),
  CONSTRAINT fk_fitness_activities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_completion_snapshots (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  day_plan_id CHAR(36) NULL,
  day_plan_item_id CHAR(36) NULL,
  medicine_occurrence_id CHAR(36) NULL,
  completion_source_json JSON NOT NULL,
  item_kind ENUM('meal', 'supplement', 'medicine', 'fitness', 'custom') NOT NULL,
  source_json JSON NULL,
  actual_quantity DECIMAL(18,6) NULL,
  actual_unit VARCHAR(80) NULL,
  actual_servings DECIMAL(18,6) NULL,
  completed_at DATETIME(3) NOT NULL,
  nutrition_json JSON NULL,
  cost_minor DECIMAL(30,6) NULL,
  actual_minutes DECIMAL(10,2) NULL,
  estimated_energy_kcal DECIMAL(18,6) NULL,
  energy_is_estimate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_completion_snapshots_user_id (user_id, id),
  UNIQUE KEY uq_life_completion_snapshots_occurrence_link (user_id, id, medicine_occurrence_id),
  KEY idx_life_completion_snapshots_plan_item (user_id, day_plan_id, day_plan_item_id),
  KEY idx_life_completion_snapshots_occurrence (user_id, medicine_occurrence_id),
  KEY idx_life_completion_snapshots_user_completed (user_id, completed_at),
  CONSTRAINT chk_life_completion_snapshot_source CHECK (
    (
      day_plan_id IS NOT NULL
      AND day_plan_item_id IS NOT NULL
      AND medicine_occurrence_id IS NULL
      AND completion_source_json ->> '$.type' IS NOT NULL
      AND completion_source_json ->> '$.type' = 'day-plan-item'
      AND completion_source_json ->> '$.dayPlanId' = day_plan_id
      AND completion_source_json ->> '$.dayPlanItemId' = day_plan_item_id
    )
    OR
    (
      day_plan_id IS NULL
      AND day_plan_item_id IS NULL
      AND medicine_occurrence_id IS NOT NULL
      AND completion_source_json ->> '$.type' IS NOT NULL
      AND completion_source_json ->> '$.type' = 'medicine-occurrence'
      AND completion_source_json ->> '$.id' = medicine_occurrence_id
      AND JSON_TYPE(completion_source_json -> '$.ruleId') = 'STRING'
      AND JSON_TYPE(completion_source_json -> '$.originalDate') = 'STRING'
      AND JSON_TYPE(completion_source_json -> '$.originalTime') = 'STRING'
      AND JSON_TYPE(completion_source_json -> '$.scheduledDate') = 'STRING'
      AND JSON_TYPE(completion_source_json -> '$.scheduledTime') = 'STRING'
    )
  ),
  CONSTRAINT chk_life_completion_snapshot_values CHECK (
    (cost_minor IS NULL OR cost_minor >= 0)
    AND (actual_quantity IS NULL OR actual_quantity > 0)
    AND (actual_servings IS NULL OR actual_servings > 0)
    AND (actual_minutes IS NULL OR actual_minutes >= 0)
    AND (estimated_energy_kcal IS NULL OR estimated_energy_kcal >= 0)
  ),
  CONSTRAINT fk_life_completion_snapshots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_completion_snapshots_day FOREIGN KEY (user_id, day_plan_id) REFERENCES life_day_plans(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_completion_snapshots_occurrence FOREIGN KEY (user_id, medicine_occurrence_id) REFERENCES life_medicine_recurrence_occurrences(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE life_medicine_recurrence_occurrences
  ADD CONSTRAINT fk_life_medicine_occurrences_completion FOREIGN KEY (user_id, completion_id, id) REFERENCES life_completion_snapshots(user_id, id, medicine_occurrence_id) ON DELETE RESTRICT;

CREATE TABLE life_completion_inventory_events (
  user_id CHAR(36) NOT NULL,
  completion_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  position INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, completion_id, transaction_id),
  UNIQUE KEY uq_life_completion_inventory_position (user_id, completion_id, position),
  CONSTRAINT fk_life_completion_inventory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_completion_inventory_completion FOREIGN KEY (user_id, completion_id) REFERENCES life_completion_snapshots(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_completion_inventory_transaction FOREIGN KEY (user_id, transaction_id) REFERENCES life_inventory_transactions(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_completion_prepared_food_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  completion_id CHAR(36) NOT NULL,
  prepared_food_stock_id CHAR(36) NOT NULL,
  portions DECIMAL(18,6) NOT NULL,
  nutrition_json JSON NOT NULL,
  cooking_oil_grams DECIMAL(18,6) NOT NULL,
  cost_minor DECIMAL(30,6) NOT NULL,
  position INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_completion_prepared_user_id (user_id, id),
  UNIQUE KEY uq_life_completion_prepared_position (user_id, completion_id, position),
  CONSTRAINT chk_life_completion_prepared_values CHECK (portions > 0 AND cooking_oil_grams >= 0 AND cost_minor >= 0),
  CONSTRAINT fk_life_completion_prepared_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_completion_prepared_completion FOREIGN KEY (user_id, completion_id) REFERENCES life_completion_snapshots(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_completion_prepared_stock FOREIGN KEY (user_id, prepared_food_stock_id) REFERENCES life_prepared_food_stock(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_completion_reversals (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  completion_id CHAR(36) NOT NULL,
  reversed_inventory_transaction_ids JSON NOT NULL,
  restored_prepared_food_event_ids JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_completion_reversals_user_id (user_id, id),
  UNIQUE KEY uq_life_completion_reversals_completion (user_id, completion_id),
  CONSTRAINT fk_life_completion_reversals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_completion_reversals_completion FOREIGN KEY (user_id, completion_id) REFERENCES life_completion_snapshots(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_planning_idempotency (
  user_id CHAR(36) NOT NULL,
  operation_key VARCHAR(220) NOT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, operation_key, idempotency_key),
  CONSTRAINT fk_life_planning_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_life_completion_snapshots_no_update BEFORE UPDATE ON life_completion_snapshots
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_snapshots_no_delete BEFORE DELETE ON life_completion_snapshots
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_inventory_no_update BEFORE UPDATE ON life_completion_inventory_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_inventory_no_delete BEFORE DELETE ON life_completion_inventory_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_prepared_no_update BEFORE UPDATE ON life_completion_prepared_food_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_prepared_no_delete BEFORE DELETE ON life_completion_prepared_food_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_reversals_no_update BEFORE UPDATE ON life_completion_reversals
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_reversals_no_delete BEFORE DELETE ON life_completion_reversals
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE';
CREATE TRIGGER trg_life_completion_snapshot_source_validate BEFORE INSERT ON life_completion_snapshots
FOR EACH ROW BEGIN IF NEW.medicine_occurrence_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM life_medicine_recurrence_occurrences occurrence_row WHERE occurrence_row.user_id = NEW.user_id AND occurrence_row.id = NEW.medicine_occurrence_id AND occurrence_row.status = 'planned' AND NEW.item_kind = 'medicine' AND JSON_TYPE(NEW.source_json) = 'OBJECT' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.source_json, '$.type')) = 'catalog-item' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.source_json, '$.id')) = occurrence_row.source_item_id AND NEW.actual_quantity <=> occurrence_row.quantity AND NEW.actual_unit <=> occurrence_row.unit AND NEW.actual_servings IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(NEW.completion_source_json, '$.ruleId')) = occurrence_row.rule_id AND JSON_UNQUOTE(JSON_EXTRACT(NEW.completion_source_json, '$.originalDate')) = DATE_FORMAT(occurrence_row.original_date, '%Y-%m-%d') AND JSON_UNQUOTE(JSON_EXTRACT(NEW.completion_source_json, '$.originalTime')) = DATE_FORMAT(occurrence_row.original_time, '%H:%i') AND JSON_UNQUOTE(JSON_EXTRACT(NEW.completion_source_json, '$.scheduledDate')) = DATE_FORMAT(occurrence_row.scheduled_date, '%Y-%m-%d') AND JSON_UNQUOTE(JSON_EXTRACT(NEW.completion_source_json, '$.scheduledTime')) = DATE_FORMAT(occurrence_row.scheduled_time, '%H:%i')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SOURCE_MISMATCH'; END IF; END;
CREATE TRIGGER trg_life_medicine_recurrence_rule_no_update BEFORE UPDATE ON life_medicine_recurrence_rules
FOR EACH ROW BEGIN IF OLD.deleted_at IS NOT NULL OR NOT (NEW.id <=> OLD.id) OR NOT (NEW.user_id <=> OLD.user_id) OR NOT (NEW.created_at <=> OLD.created_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_RECURRENCE_RULE_IDENTITY_IMMUTABLE'; ELSEIF NEW.entity_version <> OLD.entity_version + 1 OR NEW.updated_at < OLD.updated_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_RECURRENCE_RULE_VERSION_INVALID'; END IF; END;
CREATE TRIGGER trg_life_medicine_recurrence_rule_no_delete BEFORE DELETE ON life_medicine_recurrence_rules
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_RECURRENCE_RULE_HISTORY_IMMUTABLE';
CREATE TRIGGER trg_life_medicine_occurrence_identity_no_update BEFORE UPDATE ON life_medicine_recurrence_occurrences
FOR EACH ROW BEGIN IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.user_id <=> OLD.user_id) OR NOT (NEW.rule_id <=> OLD.rule_id) OR NOT (NEW.original_date <=> OLD.original_date) OR NOT (NEW.original_time <=> OLD.original_time) OR NOT (NEW.created_at <=> OLD.created_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_IDENTITY_IMMUTABLE'; ELSEIF NEW.entity_version <> OLD.entity_version + 1 OR NEW.updated_at < OLD.updated_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_VERSION_INVALID'; ELSEIF OLD.status IN ('skipped', 'cancelled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; ELSEIF OLD.status = 'completed' AND (NEW.status NOT IN ('planned', 'cancelled') OR NEW.completion_id IS NOT NULL OR NOT (NEW.title <=> OLD.title) OR NOT (NEW.source_item_id <=> OLD.source_item_id) OR NOT (NEW.quantity <=> OLD.quantity) OR NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.scheduled_date <=> OLD.scheduled_date) OR NOT (NEW.scheduled_time <=> OLD.scheduled_time) OR NOT EXISTS (SELECT 1 FROM life_completion_reversals reversal_row WHERE reversal_row.user_id = OLD.user_id AND reversal_row.completion_id = OLD.completion_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; ELSEIF OLD.status = 'planned' AND NEW.status <> 'planned' AND (NOT (NEW.title <=> OLD.title) OR NOT (NEW.source_item_id <=> OLD.source_item_id) OR NOT (NEW.quantity <=> OLD.quantity) OR NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.scheduled_date <=> OLD.scheduled_date) OR NOT (NEW.scheduled_time <=> OLD.scheduled_time)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; END IF; END;
CREATE TRIGGER trg_life_medicine_occurrence_no_delete BEFORE DELETE ON life_medicine_recurrence_occurrences
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_HISTORY_IMMUTABLE';
