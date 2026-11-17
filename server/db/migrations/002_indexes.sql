-- Secondary indexes for administrative filters, character lookups, and cleanup queries.
CREATE INDEX IF NOT EXISTS idx_admin_log_target ON admin_log(target);
CREATE INDEX IF NOT EXISTS idx_char_self_switches_map ON character_self_switches(map_id);
CREATE INDEX IF NOT EXISTS idx_characters_class ON characters(class_id);
CREATE INDEX IF NOT EXISTS idx_characters_respawn_map ON characters(respawn_map);
CREATE INDEX IF NOT EXISTS idx_character_skills_skill ON character_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_character_quests_quest ON character_quests(quest_id);
