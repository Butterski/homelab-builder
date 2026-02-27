CREATE TABLE IF NOT EXISTS steering_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL UNIQUE,
    retailer_order JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE hardware_components
ADD COLUMN IF NOT EXISTS affiliate_tag TEXT DEFAULT '';

-- Add trigger for updated_at on steering_rules
CREATE OR REPLACE FUNCTION update_steering_rules_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_steering_rules_updated_at
    BEFORE UPDATE ON steering_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_steering_rules_updated_at_column();
