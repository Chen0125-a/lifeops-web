ALTER TABLE habits
  ADD COLUMN goal_id CHAR(36) NULL AFTER user_id,
  ADD COLUMN project_id CHAR(36) NULL AFTER goal_id,
  ADD KEY idx_habits_user_goal_deleted (user_id, goal_id, deleted_at),
  ADD KEY idx_habits_user_project_deleted (user_id, project_id, deleted_at),
  ADD CONSTRAINT fk_habits_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_habits_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
