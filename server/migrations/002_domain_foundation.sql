CREATE TABLE IF NOT EXISTS goals (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('active', 'paused', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  priority TINYINT UNSIGNED NOT NULL DEFAULT 2,
  starts_on DATE NULL,
  target_on DATE NULL,
  progress_mode ENUM('manual', 'task-ratio', 'milestone-ratio') NOT NULL DEFAULT 'manual',
  manual_progress DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_goals_user_deleted_updated (user_id, deleted_at, updated_at),
  KEY idx_goals_user_status_target (user_id, status, target_on),
  CONSTRAINT chk_goals_priority CHECK (priority BETWEEN 1 AND 3),
  CONSTRAINT chk_goals_progress CHECK (manual_progress BETWEEN 0.00 AND 100.00),
  CONSTRAINT fk_goals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('active', 'paused', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  starts_on DATE NULL,
  target_on DATE NULL,
  progress DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  next_task_id CHAR(36) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_projects_user_goal_deleted (user_id, goal_id, deleted_at),
  KEY idx_projects_user_status_target (user_id, status, target_on),
  CONSTRAINT chk_projects_progress CHECK (progress BETWEEN 0.00 AND 100.00),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_projects_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS milestones (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  due_on DATE NULL,
  completed_at DATETIME(3) NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_milestones_user_project_position (user_id, project_id, position),
  KEY idx_milestones_user_deleted_due (user_id, deleted_at, due_on),
  CONSTRAINT fk_milestones_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NULL,
  project_id CHAR(36) NULL,
  milestone_id CHAR(36) NULL,
  legacy_plan_id CHAR(36) NULL,
  legacy_scheduled_for VARCHAR(40) NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  due_at DATETIME(3) NULL,
  estimate_minutes INT UNSIGNED NULL,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 2,
  tags JSON NOT NULL,
  status ENUM('inbox', 'planned', 'doing', 'done', 'skipped', 'cancelled') NOT NULL DEFAULT 'inbox',
  completed_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_tasks_user_legacy_plan (user_id, legacy_plan_id),
  KEY idx_tasks_user_status_due (user_id, status, due_at),
  KEY idx_tasks_user_project_deleted (user_id, project_id, deleted_at),
  KEY idx_tasks_user_goal_deleted (user_id, goal_id, deleted_at),
  KEY idx_tasks_milestone (milestone_id),
  CONSTRAINT chk_tasks_priority CHECK (priority BETWEEN 1 AND 3),
  CONSTRAINT chk_tasks_time_range CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_legacy_plan FOREIGN KEY (legacy_plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at DATETIME(3) NULL,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_checklist_user_task_position (user_id, task_id, position),
  KEY idx_checklist_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT fk_checklist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_checklist_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_recurrence_rules (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  frequency ENUM('daily', 'weekly', 'monthly') NOT NULL,
  interval_value INT UNSIGNED NOT NULL DEFAULT 1,
  weekdays JSON NULL,
  month_day TINYINT UNSIGNED NULL,
  until_on DATE NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_recurrence_user_task (user_id, task_id),
  KEY idx_recurrence_user_until (user_id, until_on),
  CONSTRAINT chk_recurrence_interval CHECK (interval_value >= 1),
  CONSTRAINT chk_recurrence_month_day CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
  CONSTRAINT fk_recurrence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_recurrence_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_schedule_user_starts_ends (user_id, starts_at, ends_at),
  KEY idx_schedule_user_task_deleted (user_id, task_id, deleted_at),
  CONSTRAINT chk_schedule_time_range CHECK (ends_at > starts_at),
  CONSTRAINT fk_schedule_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS habits (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL,
  measure ENUM('boolean', 'count', 'duration', 'quantity') NOT NULL DEFAULT 'boolean',
  unit VARCHAR(64) NULL,
  target_value DECIMAL(18,6) NULL,
  status ENUM('active', 'paused', 'archived') NOT NULL DEFAULT 'active',
  paused_at DATETIME(3) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_habits_user_status_deleted (user_id, status, deleted_at),
  KEY idx_habits_user_updated (user_id, updated_at),
  CONSTRAINT chk_habits_target CHECK (target_value IS NULL OR target_value >= 0),
  CONSTRAINT fk_habits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS habit_schedules (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  habit_id CHAR(36) NOT NULL,
  schedule_type ENUM('daily', 'weekdays', 'times-per-week', 'interval') NOT NULL,
  weekdays JSON NULL,
  times_per_week TINYINT UNSIGNED NULL,
  interval_days INT UNSIGNED NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  KEY idx_habit_schedules_user_habit_start (user_id, habit_id, starts_on),
  KEY idx_habit_schedules_user_deleted_end (user_id, deleted_at, ends_on),
  CONSTRAINT chk_habit_schedule_times CHECK (times_per_week IS NULL OR times_per_week BETWEEN 1 AND 7),
  CONSTRAINT chk_habit_schedule_interval CHECK (interval_days IS NULL OR interval_days >= 1),
  CONSTRAINT chk_habit_schedule_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT fk_habit_schedules_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_habit_schedules_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS habit_entries (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  habit_id CHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  status ENUM('done', 'partial', 'intentional-skip', 'missed') NOT NULL,
  value DECIMAL(18,6) NULL,
  note TEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_habit_entries_user_habit_date (user_id, habit_id, entry_date),
  KEY idx_habit_entries_user_date_status (user_id, entry_date, status),
  CONSTRAINT chk_habit_entries_value CHECK (value IS NULL OR value >= 0),
  CONSTRAINT fk_habit_entries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_habit_entries_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS media_assets (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  mime_type VARCHAR(120) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  checksum CHAR(64) NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uq_media_assets_storage_key (storage_key),
  KEY idx_media_assets_user_visibility_created (user_id, visibility, created_at),
  KEY idx_media_assets_user_deleted_updated (user_id, deleted_at, updated_at),
  CONSTRAINT fk_media_assets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id CHAR(36) NULL,
  request_id VARCHAR(190) NULL,
  details JSON NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_audit_events_user_occurred (user_id, occurred_at),
  KEY idx_audit_events_user_entity (user_id, entity_type, entity_id),
  CONSTRAINT fk_audit_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  scope VARCHAR(120) NOT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT UNSIGNED NULL,
  response_body JSON NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_idempotency_user_scope_key (user_id, scope, idempotency_key),
  KEY idx_idempotency_user_expires (user_id, expires_at),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO tasks (
  id,
  user_id,
  legacy_plan_id,
  legacy_scheduled_for,
  title,
  description,
  tags,
  status,
  completed_at,
  version,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  UUID(),
  plans.user_id,
  plans.id,
  plans.scheduled_for,
  plans.title,
  '',
  JSON_ARRAY(),
  plans.status,
  plans.completed_at,
  1,
  plans.created_at,
  plans.updated_at,
  NULL
FROM plans
WHERE NOT EXISTS (
  SELECT 1
  FROM tasks
  WHERE tasks.legacy_plan_id = plans.id
);
