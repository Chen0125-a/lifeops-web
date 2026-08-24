CREATE TABLE search_documents (
  user_id CHAR(36) NOT NULL,
  document_type ENUM('goal','project','task','record','review','knowledge','public-draft','life-item','recipe','medicine','fitness','household-item','shopping-item','day-plan','cooking-record') NOT NULL,
  source_id VARCHAR(80) NOT NULL,
  title VARCHAR(500) NOT NULL,
  body_text MEDIUMTEXT NOT NULL,
  tags_text TEXT NOT NULL,
  source_text MEDIUMTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (user_id, document_type, source_id),
  KEY idx_search_documents_owner_lookup (user_id, deleted_at, document_type, updated_at, source_id),
  CONSTRAINT fk_search_documents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'goal',id,title,description,'',COALESCE(CAST(target_on AS CHAR),''),updated_at,deleted_at FROM goals;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'project',id,title,CONCAT_WS(' ',description,risk_note),'',COALESCE(goal_id,''),updated_at,deleted_at FROM projects;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'task',id,title,description,CAST(tags AS CHAR),CONCAT_WS(' ',goal_id,project_id,milestone_id,due_at),updated_at,deleted_at FROM tasks;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'record',id,title,body,CAST(tags AS CHAR),CAST(occurred_at AS CHAR),updated_at,deleted_at FROM life_records;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'review',id,CONCAT(period_start,' — ',period_end,' 回顾'),CONCAT_WS(' ',CAST(achievements AS CHAR),CAST(problems AS CHAR),CAST(causes AS CHAR),CAST(insights AS CHAR),CAST(next_changes AS CHAR)),'',review_type,updated_at,deleted_at FROM period_reviews;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'knowledge',id,title,body,CAST(tags AS CHAR),CAST(source_links AS CHAR),updated_at,deleted_at FROM knowledge_notes;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'public-draft',id,title,CONCAT_WS(' ',excerpt,body),CAST(tags AS CHAR),CONCAT_WS(' ',category,status),updated_at,NULL FROM public_drafts;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,CASE WHEN item_kind='medicine' THEN 'medicine' WHEN item_kind IN ('household_consumable','household_durable') THEN 'household-item' ELSE 'life-item' END,id,name,notes,CAST(aliases AS CHAR),CONCAT_WS(' ',item_kind,base_unit),updated_at,deleted_at FROM life_items;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT r.user_id,'recipe',r.id,r.name,CONCAT_WS(' ',r.description,r.storage_notes),CAST(r.tag_ids AS CHAR),COALESCE((SELECT GROUP_CONCAT(i.name SEPARATOR ' ') FROM life_recipe_components c JOIN life_recipe_versions v ON v.user_id=c.user_id AND v.id=c.recipe_version_id JOIN life_items i ON i.user_id=c.user_id AND i.id=c.item_id WHERE v.id=r.current_version_id),''),r.updated_at,r.deleted_at FROM life_recipes r;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'fitness',id,name,CAST(steps_json AS CHAR),CAST(equipment_json AS CHAR),intensity,updated_at,NULL FROM fitness_activities;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT user_id,'day-plan',id,CONCAT(plan_date,' 日计划'),CAST(items_json AS CHAR),'',CAST(plan_date AS CHAR),updated_at,NULL FROM life_day_plans;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT s.user_id,'cooking-record',s.id,COALESCE((SELECT r.name FROM life_recipes r WHERE r.user_id=s.user_id AND r.id=s.recipe_id),s.recipe_id),s.note,'',CONCAT_WS(' ',s.status,s.recipe_id),COALESCE(s.completed_at,s.created_at),NULL FROM life_cooking_sessions s;
INSERT INTO search_documents (user_id,document_type,source_id,title,body_text,tags_text,source_text,updated_at,deleted_at)
SELECT s.user_id,'shopping-item',s.id,COALESCE((SELECT i.name FROM life_items i WHERE i.user_id=s.user_id AND i.id=s.item_id),s.item_id),s.store_group,'',CONCAT_WS(' ',s.needed_on,s.status,s.unit),s.updated_at,NULL FROM life_shopping_items s;

CREATE TRIGGER trg_search_goals_insert AFTER INSERT ON goals FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'goal',NEW.id,NEW.title,NEW.description,'',COALESCE(CAST(NEW.target_on AS CHAR),''),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_goals_update AFTER UPDATE ON goals FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'goal',NEW.id,NEW.title,NEW.description,'',COALESCE(CAST(NEW.target_on AS CHAR),''),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_projects_insert AFTER INSERT ON projects FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'project',NEW.id,NEW.title,CONCAT_WS(' ',NEW.description,NEW.risk_note),'',COALESCE(NEW.goal_id,''),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_projects_update AFTER UPDATE ON projects FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'project',NEW.id,NEW.title,CONCAT_WS(' ',NEW.description,NEW.risk_note),'',COALESCE(NEW.goal_id,''),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_tasks_insert AFTER INSERT ON tasks FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'task',NEW.id,NEW.title,NEW.description,CAST(NEW.tags AS CHAR),CONCAT_WS(' ',NEW.goal_id,NEW.project_id,NEW.milestone_id,NEW.due_at),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_tasks_update AFTER UPDATE ON tasks FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'task',NEW.id,NEW.title,NEW.description,CAST(NEW.tags AS CHAR),CONCAT_WS(' ',NEW.goal_id,NEW.project_id,NEW.milestone_id,NEW.due_at),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_records_insert AFTER INSERT ON life_records FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'record',NEW.id,NEW.title,NEW.body,CAST(NEW.tags AS CHAR),CAST(NEW.occurred_at AS CHAR),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_records_update AFTER UPDATE ON life_records FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'record',NEW.id,NEW.title,NEW.body,CAST(NEW.tags AS CHAR),CAST(NEW.occurred_at AS CHAR),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_reviews_insert AFTER INSERT ON period_reviews FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'review',NEW.id,CONCAT(NEW.period_start,' — ',NEW.period_end,' 回顾'),CONCAT_WS(' ',CAST(NEW.achievements AS CHAR),CAST(NEW.problems AS CHAR),CAST(NEW.causes AS CHAR),CAST(NEW.insights AS CHAR),CAST(NEW.next_changes AS CHAR)),'',NEW.review_type,NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_reviews_update AFTER UPDATE ON period_reviews FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'review',NEW.id,CONCAT(NEW.period_start,' — ',NEW.period_end,' 回顾'),CONCAT_WS(' ',CAST(NEW.achievements AS CHAR),CAST(NEW.problems AS CHAR),CAST(NEW.causes AS CHAR),CAST(NEW.insights AS CHAR),CAST(NEW.next_changes AS CHAR)),'',NEW.review_type,NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_knowledge_insert AFTER INSERT ON knowledge_notes FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'knowledge',NEW.id,NEW.title,NEW.body,CAST(NEW.tags AS CHAR),CAST(NEW.source_links AS CHAR),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_knowledge_update AFTER UPDATE ON knowledge_notes FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'knowledge',NEW.id,NEW.title,NEW.body,CAST(NEW.tags AS CHAR),CAST(NEW.source_links AS CHAR),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_drafts_insert AFTER INSERT ON public_drafts FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'public-draft',NEW.id,NEW.title,CONCAT_WS(' ',NEW.excerpt,NEW.body),CAST(NEW.tags AS CHAR),CONCAT_WS(' ',NEW.category,NEW.status),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_drafts_update AFTER UPDATE ON public_drafts FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'public-draft',NEW.id,NEW.title,CONCAT_WS(' ',NEW.excerpt,NEW.body),CAST(NEW.tags AS CHAR),CONCAT_WS(' ',NEW.category,NEW.status),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_drafts_delete AFTER DELETE ON public_drafts FOR EACH ROW
DELETE FROM search_documents WHERE user_id=OLD.user_id AND document_type='public-draft' AND source_id=OLD.id;

CREATE TRIGGER trg_search_items_kind BEFORE UPDATE ON life_items FOR EACH ROW
DELETE FROM search_documents WHERE user_id=OLD.user_id AND source_id=OLD.id AND document_type<>CASE WHEN NEW.item_kind='medicine' THEN 'medicine' WHEN NEW.item_kind IN ('household_consumable','household_durable') THEN 'household-item' ELSE 'life-item' END;
CREATE TRIGGER trg_search_items_insert AFTER INSERT ON life_items FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,CASE WHEN NEW.item_kind='medicine' THEN 'medicine' WHEN NEW.item_kind IN ('household_consumable','household_durable') THEN 'household-item' ELSE 'life-item' END,NEW.id,NEW.name,NEW.notes,CAST(NEW.aliases AS CHAR),CONCAT_WS(' ',NEW.item_kind,NEW.base_unit),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_items_update AFTER UPDATE ON life_items FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,CASE WHEN NEW.item_kind='medicine' THEN 'medicine' WHEN NEW.item_kind IN ('household_consumable','household_durable') THEN 'household-item' ELSE 'life-item' END,NEW.id,NEW.name,NEW.notes,CAST(NEW.aliases AS CHAR),CONCAT_WS(' ',NEW.item_kind,NEW.base_unit),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_recipes_insert AFTER INSERT ON life_recipes FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'recipe',NEW.id,NEW.name,CONCAT_WS(' ',NEW.description,NEW.storage_notes),CAST(NEW.tag_ids AS CHAR),'',NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_recipes_update AFTER UPDATE ON life_recipes FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'recipe',NEW.id,NEW.name,CONCAT_WS(' ',NEW.description,NEW.storage_notes),CAST(NEW.tag_ids AS CHAR),COALESCE((SELECT GROUP_CONCAT(i.name SEPARATOR ' ') FROM life_recipe_components c JOIN life_recipe_versions v ON v.user_id=c.user_id AND v.id=c.recipe_version_id JOIN life_items i ON i.user_id=c.user_id AND i.id=c.item_id WHERE v.id=NEW.current_version_id),''),NEW.updated_at,NEW.deleted_at)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_fitness_insert AFTER INSERT ON fitness_activities FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'fitness',NEW.id,NEW.name,CAST(NEW.steps_json AS CHAR),CAST(NEW.equipment_json AS CHAR),NEW.intensity,NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_fitness_update AFTER UPDATE ON fitness_activities FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'fitness',NEW.id,NEW.name,CAST(NEW.steps_json AS CHAR),CAST(NEW.equipment_json AS CHAR),NEW.intensity,NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_day_plans_insert AFTER INSERT ON life_day_plans FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'day-plan',NEW.id,CONCAT(NEW.plan_date,' 日计划'),CAST(NEW.items_json AS CHAR),'',CAST(NEW.plan_date AS CHAR),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_day_plans_update AFTER UPDATE ON life_day_plans FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'day-plan',NEW.id,CONCAT(NEW.plan_date,' 日计划'),CAST(NEW.items_json AS CHAR),'',CAST(NEW.plan_date AS CHAR),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_cooking_insert AFTER INSERT ON life_cooking_sessions FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'cooking-record',NEW.id,COALESCE((SELECT r.name FROM life_recipes r WHERE r.user_id=NEW.user_id AND r.id=NEW.recipe_id),NEW.recipe_id),NEW.note,'',CONCAT_WS(' ',NEW.status,NEW.recipe_id),COALESCE(NEW.completed_at,NEW.created_at),NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_cooking_update AFTER UPDATE ON life_cooking_sessions FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'cooking-record',NEW.id,COALESCE((SELECT r.name FROM life_recipes r WHERE r.user_id=NEW.user_id AND r.id=NEW.recipe_id),NEW.recipe_id),NEW.note,'',CONCAT_WS(' ',NEW.status,NEW.recipe_id),COALESCE(NEW.completed_at,NEW.created_at),NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);

CREATE TRIGGER trg_search_shopping_insert AFTER INSERT ON life_shopping_items FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'shopping-item',NEW.id,COALESCE((SELECT i.name FROM life_items i WHERE i.user_id=NEW.user_id AND i.id=NEW.item_id),NEW.item_id),NEW.store_group,'',CONCAT_WS(' ',NEW.needed_on,NEW.status,NEW.unit),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
CREATE TRIGGER trg_search_shopping_update AFTER UPDATE ON life_shopping_items FOR EACH ROW
INSERT INTO search_documents VALUES (NEW.user_id,'shopping-item',NEW.id,COALESCE((SELECT i.name FROM life_items i WHERE i.user_id=NEW.user_id AND i.id=NEW.item_id),NEW.item_id),NEW.store_group,'',CONCAT_WS(' ',NEW.needed_on,NEW.status,NEW.unit),NEW.updated_at,NULL)
ON DUPLICATE KEY UPDATE title=VALUES(title),body_text=VALUES(body_text),tags_text=VALUES(tags_text),source_text=VALUES(source_text),updated_at=VALUES(updated_at),deleted_at=VALUES(deleted_at);
