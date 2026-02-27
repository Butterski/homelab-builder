DROP TRIGGER IF EXISTS update_steering_rules_updated_at ON steering_rules;
DROP FUNCTION IF EXISTS update_steering_rules_updated_at_column;

ALTER TABLE hardware_components
DROP COLUMN IF EXISTS affiliate_tag;

DROP TABLE IF EXISTS steering_rules;
