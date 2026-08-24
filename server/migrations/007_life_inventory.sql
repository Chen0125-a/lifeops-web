CREATE TABLE life_inventory_batches (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  base_unit VARCHAR(80) NOT NULL,
  original_quantity DECIMAL(30,12) NOT NULL,
  remaining_quantity DECIMAL(30,12) NOT NULL,
  purchased_on DATE NULL,
  expires_on DATE NULL,
  location_id CHAR(36) NULL,
  actual_unit_cost_minor BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_inventory_batches_user_id (user_id, id),
  KEY idx_life_inventory_batches_user_item_expiry (user_id, item_id, expires_on, purchased_on),
  KEY idx_life_inventory_batches_user_location (user_id, location_id),
  CONSTRAINT chk_life_inventory_batches_original CHECK (original_quantity > 0),
  CONSTRAINT chk_life_inventory_batches_remaining CHECK (remaining_quantity >= 0),
  CONSTRAINT fk_life_inventory_batches_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_inventory_batches_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_inventory_batches_location FOREIGN KEY (user_id, location_id) REFERENCES life_locations(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE life_inventory_transactions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  transaction_kind ENUM('purchase', 'consume', 'return', 'waste', 'adjustment', 'reversal') NOT NULL,
  quantity DECIMAL(30,12) NOT NULL,
  unit VARCHAR(80) NOT NULL,
  base_quantity DECIMAL(30,12) NOT NULL,
  delta_base_quantity DECIMAL(30,12) NOT NULL,
  batch_id CHAR(36) NULL,
  occurred_at DATETIME(3) NOT NULL,
  reverses_transaction_id CHAR(36) NULL,
  warning ENUM('negative_inventory') NULL,
  note TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_life_inventory_transactions_user_id (user_id, id),
  UNIQUE KEY uq_life_inventory_transactions_reversal (user_id, reverses_transaction_id),
  KEY idx_life_inventory_transactions_user_item_occurred (user_id, item_id, occurred_at, created_at),
  KEY idx_life_inventory_transactions_user_batch (user_id, batch_id),
  CONSTRAINT chk_life_inventory_transactions_quantity CHECK (quantity <> 0),
  CONSTRAINT chk_life_inventory_transactions_base CHECK (base_quantity > 0),
  CONSTRAINT chk_life_inventory_transactions_delta CHECK (delta_base_quantity <> 0),
  CONSTRAINT fk_life_inventory_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_inventory_transactions_item FOREIGN KEY (user_id, item_id) REFERENCES life_items(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_inventory_transactions_batch FOREIGN KEY (user_id, batch_id) REFERENCES life_inventory_batches(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_life_inventory_transactions_reverses FOREIGN KEY (user_id, reverses_transaction_id) REFERENCES life_inventory_transactions(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_life_inventory_transactions_no_update
BEFORE UPDATE ON life_inventory_transactions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_LEDGER_IMMUTABLE';

CREATE TRIGGER trg_life_inventory_transactions_no_delete
BEFORE DELETE ON life_inventory_transactions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVENTORY_LEDGER_IMMUTABLE';

CREATE TABLE life_inventory_allocations (
  user_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  batch_id CHAR(36) NOT NULL,
  quantity DECIMAL(30,12) NOT NULL,
  position INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (transaction_id, batch_id),
  KEY idx_life_inventory_allocations_user_batch (user_id, batch_id),
  CONSTRAINT chk_life_inventory_allocations_quantity CHECK (quantity > 0),
  CONSTRAINT fk_life_inventory_allocations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_life_inventory_allocations_transaction FOREIGN KEY (user_id, transaction_id) REFERENCES life_inventory_transactions(user_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_life_inventory_allocations_batch FOREIGN KEY (user_id, batch_id) REFERENCES life_inventory_batches(user_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
