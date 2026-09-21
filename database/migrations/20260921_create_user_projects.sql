CREATE TABLE IF NOT EXISTS user_projects (
  user_id UUID NOT NULL,
  project_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_projects_pkey PRIMARY KEY (user_id, project_id),
  CONSTRAINT fk_user_projects_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_projects_project
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_projects_project_id_idx
  ON user_projects (project_id);



