CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  account VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_account (account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  csrf_token VARCHAR(128) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS login_rate_limits (
  rate_key CHAR(64) PRIMARY KEY,
  failure_count INT UNSIGNED NOT NULL,
  reset_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_login_rate_limits_reset (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS plans (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  scheduled_for VARCHAR(40) NULL,
  status ENUM('planned', 'done', 'skipped') NOT NULL DEFAULT 'planned',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  KEY idx_plans_user_created (user_id, created_at),
  CONSTRAINT fk_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS life_records (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NULL,
  title VARCHAR(240) NOT NULL,
  body TEXT NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  tags JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_records_user_occurred (user_id, occurred_at),
  CONSTRAINT fk_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_records_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS period_reviews (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary TEXT NOT NULL,
  insights JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_reviews_user_created (user_id, created_at),
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS review_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  review_id CHAR(36) NOT NULL,
  source_type ENUM('plan', 'record') NOT NULL,
  source_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  excerpt VARCHAR(500) NOT NULL,
  KEY idx_evidence_review (review_id),
  CONSTRAINT fk_evidence_review FOREIGN KEY (review_id) REFERENCES period_reviews(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_notes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  source_type ENUM('record', 'review') NOT NULL,
  source_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  body TEXT NOT NULL,
  tags JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_knowledge_user_created (user_id, created_at),
  CONSTRAINT fk_knowledge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS public_snapshots (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  source_type ENUM('plan', 'record', 'review', 'knowledge') NOT NULL,
  source_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  excerpt VARCHAR(2000) NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  created_at DATETIME(3) NOT NULL,
  published_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_snapshots_slug (slug),
  KEY idx_snapshots_user_created (user_id, created_at),
  KEY idx_snapshots_public_slug (visibility, slug),
  CONSTRAINT fk_snapshots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
