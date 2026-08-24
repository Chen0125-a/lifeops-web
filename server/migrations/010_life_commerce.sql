-- Purchase cash remains integer minor units, while per-base-unit actual cost can
-- be fractional when a whole-minor total is divided across an arbitrary quantity.
-- Keep these derived facts as fixed-point decimals; never use floating SQL types.
ALTER TABLE life_inventory_batches
  MODIFY actual_unit_cost_minor DECIMAL(30,9) UNSIGNED NULL;
ALTER TABLE life_cooking_snapshots
  MODIFY total_cost_minor DECIMAL(30,9) NOT NULL;
ALTER TABLE life_prepared_food_stock
  MODIFY cost_remaining_minor DECIMAL(30,9) NOT NULL;
ALTER TABLE life_completion_snapshots
  MODIFY cost_minor DECIMAL(30,9) NULL;
ALTER TABLE life_completion_prepared_food_events
  MODIFY cost_minor DECIMAL(30,9) NOT NULL;

CREATE TABLE life_inventory_policies (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  minimum_stock DECIMAL(30,12) NOT NULL,
  package_quantity DECIMAL(30,12) NOT NULL,
  unit_id VARCHAR(80) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_inventory_policy_user_id (user_id, id),
  UNIQUE KEY uq_life_inventory_policy_user_item (user_id, item_id),
  KEY idx_life_inventory_policy_owner_updated (user_id, updated_at, id),
  CONSTRAINT chk_life_inventory_policy_values CHECK (minimum_stock >= 0 AND package_quantity > 0 AND entity_version >= 1 AND updated_at >= created_at),
  CONSTRAINT fk_life_inventory_policy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_inventory_policy_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_shopping_suggestions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  suggestion_origin ENUM('manual', 'derived') NOT NULL,
  through_date DATE NULL,
  required_quantity DECIMAL(30,12) NOT NULL,
  suggested_quantity DECIMAL(30,12) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  package_quantity DECIMAL(30,12) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_shopping_suggestion_user_id (user_id, id),
  UNIQUE KEY uq_life_shopping_suggestion_user_item_origin (user_id, item_id, suggestion_origin),
  KEY idx_life_shopping_suggestion_owner_updated (user_id, updated_at, id),
  CONSTRAINT chk_life_shopping_suggestion_values CHECK (required_quantity > 0 AND suggested_quantity >= 0 AND package_quantity > 0 AND updated_at >= created_at),
  CONSTRAINT chk_life_shopping_suggestion_origin CHECK ((suggestion_origin = 'manual' AND through_date IS NULL) OR (suggestion_origin = 'derived' AND through_date IS NOT NULL)),
  CONSTRAINT fk_life_shopping_suggestion_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_shopping_suggestion_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_shopping_suggestion_reasons (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  suggestion_id CHAR(36) NOT NULL,
  reason_kind ENUM('planned_shortage', 'minimum_stock', 'expiring', 'manual') NOT NULL,
  source_type ENUM('day-plan', 'inventory-policy', 'inventory-batch', 'manual') NOT NULL,
  source_id VARCHAR(190) NOT NULL,
  required_quantity DECIMAL(30,12) NOT NULL,
  source_quantity DECIMAL(30,12) NOT NULL,
  source_unit VARCHAR(80) NOT NULL,
  conversion_factor DECIMAL(30,12) NOT NULL,
  required_on DATE NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_shopping_reason_user_id (user_id, id),
  UNIQUE KEY uq_life_shopping_reason_source (user_id, suggestion_id, source_type, source_id),
  KEY idx_life_shopping_reason_owner_required (user_id, required_on, suggestion_id),
  CONSTRAINT chk_life_shopping_reason_quantity CHECK (required_quantity > 0 AND source_quantity >= 0 AND conversion_factor > 0),
  CONSTRAINT fk_life_shopping_reason_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_shopping_reason_suggestion FOREIGN KEY (user_id, suggestion_id) REFERENCES life_shopping_suggestions(user_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_shopping_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  requested_quantity DECIMAL(30,12) NOT NULL,
  purchased_quantity DECIMAL(30,12) NOT NULL DEFAULT 0,
  unit VARCHAR(80) NOT NULL,
  needed_on DATE NULL,
  priority ENUM('low', 'normal', 'high') NOT NULL DEFAULT 'normal',
  store_group VARCHAR(240) NOT NULL,
  status ENUM('added', 'shopping', 'partial', 'purchased', 'deferred', 'cancelled', 'archived') NOT NULL DEFAULT 'added',
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_shopping_items_user_id (user_id, id),
  KEY idx_life_shopping_items_owner_state (user_id, status, needed_on, created_at),
  KEY idx_life_shopping_items_owner_item (user_id, item_id, status),
  CONSTRAINT chk_life_shopping_item_values CHECK (requested_quantity > 0 AND purchased_quantity >= 0 AND purchased_quantity <= requested_quantity AND entity_version >= 1 AND updated_at >= created_at),
  CONSTRAINT fk_life_shopping_item_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_shopping_item_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_purchases (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purchased_at DATETIME(3) NOT NULL,
  currency CHAR(3) NOT NULL,
  store_name VARCHAR(240) NOT NULL,
  total_amount_minor BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_purchases_user_id (user_id, id),
  KEY idx_life_purchases_owner_time (user_id, purchased_at, id),
  CONSTRAINT fk_life_purchases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_purchase_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purchase_id CHAR(36) NOT NULL,
  shopping_item_id CHAR(36) NULL,
  item_id CHAR(36) NOT NULL,
  quantity DECIMAL(30,12) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  update_current_price BOOLEAN NOT NULL DEFAULT FALSE,
  inventory_transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_purchase_items_user_id (user_id, id),
  UNIQUE KEY uq_life_purchase_items_purchase_link (user_id, id, purchase_id),
  UNIQUE KEY uq_life_purchase_items_inventory (user_id, inventory_transaction_id),
  KEY idx_life_purchase_items_owner_purchase (user_id, purchase_id, id),
  KEY idx_life_purchase_items_owner_item (user_id, item_id, purchase_id),
  KEY idx_life_purchase_items_owner_shopping (user_id, shopping_item_id, purchase_id),
  CONSTRAINT chk_life_purchase_item_quantity CHECK (quantity > 0),
  CONSTRAINT fk_life_purchase_item_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_purchase_item_purchase FOREIGN KEY (user_id, purchase_id) REFERENCES life_purchases(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_purchase_item_shopping FOREIGN KEY (user_id, shopping_item_id) REFERENCES life_shopping_items(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_purchase_item_catalog FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_purchase_item_inventory FOREIGN KEY (user_id, inventory_transaction_id) REFERENCES life_inventory_transactions(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_refunds (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purchase_id CHAR(36) NOT NULL,
  refunded_at DATETIME(3) NOT NULL,
  total_amount_minor BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_refunds_user_id (user_id, id),
  UNIQUE KEY uq_life_refunds_purchase_link (user_id, id, purchase_id),
  KEY idx_life_refunds_owner_purchase (user_id, purchase_id, refunded_at),
  CONSTRAINT fk_life_refunds_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_refund_purchase FOREIGN KEY (user_id, purchase_id) REFERENCES life_purchases(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_refund_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  refund_id CHAR(36) NOT NULL,
  purchase_id CHAR(36) NOT NULL,
  purchase_item_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  quantity DECIMAL(30,12) NOT NULL,
  amount_minor BIGINT UNSIGNED NOT NULL,
  inventory_transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_refund_items_user_id (user_id, id),
  UNIQUE KEY uq_life_refund_items_inventory (user_id, inventory_transaction_id),
  KEY idx_life_refund_items_owner_refund (user_id, refund_id, id),
  KEY idx_life_refund_items_owner_purchase (user_id, purchase_item_id, id),
  CONSTRAINT chk_life_refund_item_quantity CHECK (quantity > 0),
  CONSTRAINT fk_life_refund_item_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_refund_item_refund FOREIGN KEY (user_id, refund_id, purchase_id) REFERENCES life_refunds(user_id, id, purchase_id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_refund_item_purchase_item FOREIGN KEY (user_id, purchase_item_id, purchase_id) REFERENCES life_purchase_items(user_id, id, purchase_id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_refund_item_catalog FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_refund_item_inventory FOREIGN KEY (user_id, inventory_transaction_id) REFERENCES life_inventory_transactions(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_cash_expenditures (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  source_type ENUM('purchase', 'refund') NOT NULL,
  purchase_id CHAR(36) NULL,
  refund_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_cash_expenditures_user_id (user_id, id),
  UNIQUE KEY uq_life_cash_purchase_source (user_id, purchase_id),
  UNIQUE KEY uq_life_cash_refund_source (user_id, refund_id),
  KEY idx_life_cash_owner_time (user_id, occurred_at, id),
  CONSTRAINT chk_life_cash_source CHECK ((source_type = 'purchase' AND purchase_id IS NOT NULL AND refund_id IS NULL AND amount_minor >= 0) OR (source_type = 'refund' AND purchase_id IS NULL AND refund_id IS NOT NULL AND amount_minor <= 0)),
  CONSTRAINT fk_life_cash_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_cash_purchase FOREIGN KEY (user_id, purchase_id) REFERENCES life_purchases(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_cash_refund FOREIGN KEY (user_id, refund_id) REFERENCES life_refunds(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_budgets (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(240) NOT NULL,
  scope_json JSON NOT NULL,
  period_kind ENUM('weekly', 'monthly', 'custom') NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  limit_minor BIGINT UNSIGNED NOT NULL,
  thresholds_json JSON NOT NULL,
  rollover_minor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  entity_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_budgets_user_id (user_id, id),
  KEY idx_life_budgets_owner_period (user_id, starts_on, ends_on, id),
  CONSTRAINT chk_life_budget_period CHECK (ends_on >= starts_on AND entity_version >= 1 AND updated_at >= created_at),
  CONSTRAINT fk_life_budget_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_exports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  reason ENUM('user-export', 'pre-import-restore-point') NOT NULL,
  export_format ENUM('json', 'zip') NOT NULL,
  format_version INT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  record_counts_json JSON NOT NULL,
  canonical_json LONGTEXT NULL,
  archive_blob LONGBLOB NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_exports_user_id (user_id, id),
  KEY idx_life_exports_owner_created (user_id, created_at, id),
  CONSTRAINT chk_life_export_payload CHECK ((export_format = 'json' AND canonical_json IS NOT NULL AND archive_blob IS NULL) OR (export_format = 'zip' AND canonical_json IS NULL AND archive_blob IS NOT NULL)),
  CONSTRAINT fk_life_export_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_imports (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  import_mode ENUM('merge', 'replace') NOT NULL,
  format_version INT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  canonical_json LONGTEXT NOT NULL,
  payload_json JSON NOT NULL,
  conflicts_json JSON NOT NULL,
  errors_json JSON NOT NULL,
  status ENUM('ready', 'conflicts', 'invalid', 'applied') NOT NULL,
  restore_point_export_id CHAR(36) NULL,
  applied_rows INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_imports_user_id (user_id, id),
  KEY idx_life_imports_owner_created (user_id, created_at, id),
  CONSTRAINT chk_life_import_state CHECK (updated_at >= created_at AND (status <> 'applied' OR restore_point_export_id IS NOT NULL)),
  CONSTRAINT fk_life_import_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_import_restore FOREIGN KEY (user_id, restore_point_export_id) REFERENCES life_exports(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_commerce_idempotency (
  user_id CHAR(36) NOT NULL,
  operation_key VARCHAR(220) NOT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, operation_key, idempotency_key),
  CONSTRAINT fk_life_commerce_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TRIGGER IF EXISTS trg_life_inventory_policy_version_before_update;
CREATE TRIGGER trg_life_inventory_policy_version_before_update BEFORE UPDATE ON life_inventory_policies FOR EACH ROW BEGIN IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.user_id <=> OLD.user_id) OR NOT (NEW.item_id <=> OLD.item_id) OR NOT (NEW.created_at <=> OLD.created_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_INVENTORY_POLICY_IDENTITY_IMMUTABLE'; ELSEIF NEW.entity_version <> OLD.entity_version + 1 OR NEW.updated_at < OLD.updated_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_INVENTORY_POLICY_VERSION_INVALID'; END IF; END;

-- A replace restore is the only operation allowed to remove immutable owner history.
-- The application enables this connection-local flag inside the restore transaction
-- and clears it in a finally block. Ordinary SQL retains every immutable boundary.
DROP TRIGGER trg_life_inventory_transactions_no_delete;
CREATE TRIGGER trg_life_inventory_transactions_no_delete BEFORE DELETE ON life_inventory_transactions FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_LEDGER_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_recipe_versions_no_delete;
CREATE TRIGGER trg_life_recipe_versions_no_delete BEFORE DELETE ON life_recipe_versions FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_recipe_components_no_delete;
CREATE TRIGGER trg_life_recipe_components_no_delete BEFORE DELETE ON life_recipe_components FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_recipe_steps_no_delete;
CREATE TRIGGER trg_life_recipe_steps_no_delete BEFORE DELETE ON life_recipe_steps FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RECIPE_VERSION_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_cooking_snapshots_no_delete;
CREATE TRIGGER trg_life_cooking_snapshots_no_delete BEFORE DELETE ON life_cooking_snapshots FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'COOKING_SNAPSHOT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_completion_snapshots_no_delete;
CREATE TRIGGER trg_life_completion_snapshots_no_delete BEFORE DELETE ON life_completion_snapshots FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_completion_inventory_no_delete;
CREATE TRIGGER trg_life_completion_inventory_no_delete BEFORE DELETE ON life_completion_inventory_events FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_completion_prepared_no_delete;
CREATE TRIGGER trg_life_completion_prepared_no_delete BEFORE DELETE ON life_completion_prepared_food_events FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_completion_reversals_no_delete;
CREATE TRIGGER trg_life_completion_reversals_no_delete BEFORE DELETE ON life_completion_reversals FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_COMPLETION_SNAPSHOT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_medicine_recurrence_rule_no_delete;
CREATE TRIGGER trg_life_medicine_recurrence_rule_no_delete BEFORE DELETE ON life_medicine_recurrence_rules FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_RECURRENCE_RULE_HISTORY_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_medicine_occurrence_no_delete;
CREATE TRIGGER trg_life_medicine_occurrence_no_delete BEFORE DELETE ON life_medicine_recurrence_occurrences FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_HISTORY_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_purchases_no_update;
CREATE TRIGGER trg_life_purchases_no_update BEFORE UPDATE ON life_purchases FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_PURCHASE_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_purchases_no_delete;
CREATE TRIGGER trg_life_purchases_no_delete BEFORE DELETE ON life_purchases FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_PURCHASE_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_purchase_items_no_update;
CREATE TRIGGER trg_life_purchase_items_no_update BEFORE UPDATE ON life_purchase_items FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_PURCHASE_ITEM_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_purchase_items_no_delete;
CREATE TRIGGER trg_life_purchase_items_no_delete BEFORE DELETE ON life_purchase_items FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_PURCHASE_ITEM_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_refunds_no_update;
CREATE TRIGGER trg_life_refunds_no_update BEFORE UPDATE ON life_refunds FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_REFUND_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_refunds_no_delete;
CREATE TRIGGER trg_life_refunds_no_delete BEFORE DELETE ON life_refunds FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_REFUND_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_refund_items_no_update;
CREATE TRIGGER trg_life_refund_items_no_update BEFORE UPDATE ON life_refund_items FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_REFUND_ITEM_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_refund_items_no_delete;
CREATE TRIGGER trg_life_refund_items_no_delete BEFORE DELETE ON life_refund_items FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_REFUND_ITEM_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_cash_expenditures_no_update;
CREATE TRIGGER trg_life_cash_expenditures_no_update BEFORE UPDATE ON life_cash_expenditures FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_CASH_EXPENDITURE_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_cash_expenditures_no_delete;
CREATE TRIGGER trg_life_cash_expenditures_no_delete BEFORE DELETE ON life_cash_expenditures FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_CASH_EXPENDITURE_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_exports_no_update;
CREATE TRIGGER trg_life_exports_no_update BEFORE UPDATE ON life_exports FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_EXPORT_IMMUTABLE'; END IF; END;
DROP TRIGGER IF EXISTS trg_life_exports_no_delete;
CREATE TRIGGER trg_life_exports_no_delete BEFORE DELETE ON life_exports FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_EXPORT_IMMUTABLE'; END IF; END;
DROP TRIGGER trg_life_medicine_occurrence_identity_no_update;
CREATE TRIGGER trg_life_medicine_occurrence_identity_no_update BEFORE UPDATE ON life_medicine_recurrence_occurrences FOR EACH ROW BEGIN IF COALESCE(@lifeops_restore_mode, 0) <> 1 THEN IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.user_id <=> OLD.user_id) OR NOT (NEW.rule_id <=> OLD.rule_id) OR NOT (NEW.original_date <=> OLD.original_date) OR NOT (NEW.original_time <=> OLD.original_time) OR NOT (NEW.created_at <=> OLD.created_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_IDENTITY_IMMUTABLE'; ELSEIF NEW.entity_version <> OLD.entity_version + 1 OR NEW.updated_at < OLD.updated_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_VERSION_INVALID'; ELSEIF OLD.status IN ('skipped', 'cancelled') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; ELSEIF OLD.status = 'completed' AND (NEW.status NOT IN ('planned', 'cancelled') OR NEW.completion_id IS NOT NULL OR NOT (NEW.title <=> OLD.title) OR NOT (NEW.source_item_id <=> OLD.source_item_id) OR NOT (NEW.quantity <=> OLD.quantity) OR NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.scheduled_date <=> OLD.scheduled_date) OR NOT (NEW.scheduled_time <=> OLD.scheduled_time) OR NOT EXISTS (SELECT 1 FROM life_completion_reversals reversal_row WHERE reversal_row.user_id = OLD.user_id AND reversal_row.completion_id = OLD.completion_id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; ELSEIF OLD.status = 'planned' AND NEW.status <> 'planned' AND (NOT (NEW.title <=> OLD.title) OR NOT (NEW.source_item_id <=> OLD.source_item_id) OR NOT (NEW.quantity <=> OLD.quantity) OR NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.scheduled_date <=> OLD.scheduled_date) OR NOT (NEW.scheduled_time <=> OLD.scheduled_time)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LIFE_MEDICINE_OCCURRENCE_TERMINAL_IMMUTABLE'; END IF; END IF; END;
