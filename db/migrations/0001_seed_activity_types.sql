-- Reference data the app assumes exists: the one activity this deployment
-- serves. Every slug lookup (createMember, propose, areaScenario, …) expects
-- this row; engine tunables ride the column defaults. (Created with
-- `drizzle-kit generate --custom` — data can't be expressed in the ORM schema.)
INSERT INTO activity_types (slug, display_name)
VALUES ('flag-football', 'Flag football')
ON CONFLICT (slug) DO NOTHING;
