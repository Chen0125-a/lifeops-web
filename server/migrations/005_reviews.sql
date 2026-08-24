ALTER TABLE period_reviews
  ADD COLUMN review_type ENUM('weekly', 'monthly', 'custom') NULL AFTER user_id,
  ADD COLUMN status ENUM('draft', 'archived') NULL AFTER period_end,
  ADD COLUMN achievements JSON NULL AFTER summary,
  ADD COLUMN problems JSON NULL AFTER achievements,
  ADD COLUMN causes JSON NULL AFTER problems,
  ADD COLUMN next_changes JSON NULL AFTER insights,
  ADD COLUMN evidence_json JSON NULL AFTER next_changes,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER evidence_json,
  ADD COLUMN updated_at DATETIME(3) NULL AFTER created_at,
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER updated_at,
  ADD KEY idx_period_reviews_user_status_deleted_updated (user_id, status, deleted_at, updated_at),
  ADD KEY idx_period_reviews_user_period (user_id, period_start, period_end);

UPDATE period_reviews
SET review_type = 'custom',
    status = 'archived',
    achievements = JSON_ARRAY(summary),
    problems = JSON_ARRAY(),
    causes = JSON_ARRAY(),
    next_changes = JSON_ARRAY(),
    evidence_json = JSON_OBJECT(
      'period', JSON_OBJECT('from', DATE_FORMAT(period_start, '%Y-%m-%d'), 'to', DATE_FORMAT(period_end, '%Y-%m-%d')),
      'goals', JSON_OBJECT('active', 0, 'completed', 0),
      'projects', JSON_OBJECT('active', 0, 'completed', 0),
      'tasks', JSON_OBJECT('total', 0, 'completed', 0, 'skipped', 0, 'cancelled', 0),
      'habits', JSON_OBJECT('entries', 0, 'done', 0, 'partial', 0, 'intentionalSkips', 0),
      'records', JSON_OBJECT('total', 0, 'ids', JSON_ARRAY()),
      'priorCommitments', JSON_ARRAY(),
      'hasFacts', EXISTS(SELECT 1 FROM review_evidence evidence WHERE evidence.review_id = period_reviews.id)
    ),
    updated_at = created_at
WHERE review_type IS NULL;

ALTER TABLE period_reviews
  MODIFY COLUMN review_type ENUM('weekly', 'monthly', 'custom') NOT NULL,
  MODIFY COLUMN status ENUM('draft', 'archived') NOT NULL,
  MODIFY COLUMN achievements JSON NOT NULL,
  MODIFY COLUMN problems JSON NOT NULL,
  MODIFY COLUMN causes JSON NOT NULL,
  MODIFY COLUMN next_changes JSON NOT NULL,
  MODIFY COLUMN evidence_json JSON NOT NULL,
  MODIFY COLUMN updated_at DATETIME(3) NOT NULL;

CREATE TABLE review_actions (
  id VARCHAR(80) NOT NULL,
  user_id CHAR(36) NOT NULL,
  review_id CHAR(36) NOT NULL,
  action_text VARCHAR(1000) NOT NULL,
  status ENUM('pending', 'converted', 'dismissed') NOT NULL DEFAULT 'pending',
  converted_target ENUM('task', 'goal-update', 'knowledge', 'public-draft') NULL,
  converted_id CHAR(36) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (review_id, id),
  KEY idx_review_actions_user_status_updated (user_id, status, updated_at),
  KEY idx_review_actions_user_converted (user_id, converted_target, converted_id),
  CONSTRAINT fk_review_actions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_actions_review FOREIGN KEY (review_id) REFERENCES period_reviews(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE goal_updates (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  review_id CHAR(36) NOT NULL,
  action_id VARCHAR(80) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_goal_updates_review_action (review_id, action_id),
  KEY idx_goal_updates_user_goal_created (user_id, goal_id, created_at),
  CONSTRAINT fk_goal_updates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_updates_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT fk_goal_updates_review_action FOREIGN KEY (review_id, action_id) REFERENCES review_actions(review_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
