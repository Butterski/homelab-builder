-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    avatar_url TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Services catalog
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(50) NOT NULL DEFAULT 'other',
    icon VARCHAR(100) DEFAULT '',
    official_website VARCHAR(500) DEFAULT '',
    docker_support BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Service hardware requirements
CREATE TABLE service_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    min_ram_mb INTEGER NOT NULL DEFAULT 256,
    recommended_ram_mb INTEGER NOT NULL DEFAULT 512,
    min_cpu_cores REAL NOT NULL DEFAULT 0.5,
    recommended_cpu_cores REAL NOT NULL DEFAULT 1.0,
    min_storage_gb INTEGER NOT NULL DEFAULT 1,
    recommended_storage_gb INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(service_id)
);

-- Hardware recommendations (generated per user request)
CREATE TABLE hardware_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    service_ids UUID[] NOT NULL DEFAULT '{}',
    tier VARCHAR(20) NOT NULL DEFAULT 'recommended',
    total_ram_mb INTEGER NOT NULL DEFAULT 0,
    total_cpu_cores REAL NOT NULL DEFAULT 0,
    total_storage_gb INTEGER NOT NULL DEFAULT 0,
    cpu_suggestion TEXT DEFAULT '',
    ram_suggestion TEXT DEFAULT '',
    storage_suggestion TEXT DEFAULT '',
    network_suggestion TEXT DEFAULT '',
    rationale TEXT DEFAULT '',
    estimated_cost_min INTEGER DEFAULT 0,
    estimated_cost_max INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User service selections
CREATE TABLE user_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, service_id)
);

-- Shopping lists
CREATE TABLE shopping_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recommendation_id UUID NOT NULL REFERENCES hardware_recommendations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    total_estimated_cost INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shopping list items
CREATE TABLE shopping_list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'other',
    estimated_price INTEGER DEFAULT 0,
    priority VARCHAR(20) DEFAULT 'essential',
    purchase_links JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_services_category ON services(category);
CREATE INDEX idx_services_is_active ON services(is_active);
CREATE INDEX idx_service_requirements_service_id ON service_requirements(service_id);
CREATE INDEX idx_user_selections_user_id ON user_selections(user_id);
CREATE INDEX idx_user_selections_service_id ON user_selections(service_id);
CREATE INDEX idx_hardware_recommendations_user_id ON hardware_recommendations(user_id);
CREATE INDEX idx_shopping_lists_recommendation_id ON shopping_lists(recommendation_id);
CREATE INDEX idx_shopping_list_items_shopping_list_id ON shopping_list_items(shopping_list_id);

-- Builds (Projects)
CREATE TABLE builds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    thumbnail TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_builds_user_id ON builds(user_id);

-- Nodes (Hardware Assets in a Build)
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    build_id UUID NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- server, router, switch
    name VARCHAR(255) NOT NULL,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    ip VARCHAR(45) DEFAULT '',
    details JSONB DEFAULT '{}', -- Hardware specs snapshot
    parent_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_nodes_build_id ON nodes(build_id);

-- Virtual Machines / Containers
CREATE TABLE virtual_machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- vm, container, lxc
    ip VARCHAR(45) DEFAULT '',
    os VARCHAR(100) DEFAULT '',
    cpu_cores INTEGER DEFAULT 0,
    ram_mb INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'stopped',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_vms_node_id ON virtual_machines(node_id);

-- Edges (Network Connections)
CREATE TABLE edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    build_id UUID NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'ethernet',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_edges_build_id ON edges(build_id);

-- Service Instances (Deployed Services)
CREATE TABLE service_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    build_id UUID NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL, -- Null if in backlog/unassigned
    catalog_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    ip VARCHAR(45) DEFAULT '',
    port INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'stopped',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_service_instances_build_id ON service_instances(build_id);
CREATE INDEX idx_service_instances_node_id ON service_instances(node_id);
