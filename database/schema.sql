CREATE TABLE IF NOT EXISTS asset_categories (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    category_id INTEGER NOT NULL,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    location VARCHAR(150) NOT NULL,
    purchase_date DATE,
    warranty_until DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'in_use',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assets_category
        FOREIGN KEY (category_id)
        REFERENCES asset_categories (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_assets_status
        CHECK (status IN ('in_use', 'under_maintenance', 'retired')),
    CONSTRAINT chk_assets_warranty_date
        CHECK (
            purchase_date IS NULL
            OR warranty_until IS NULL
            OR warranty_until >= purchase_date
        )
);

CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id INTEGER NOT NULL,
    maintenance_date DATE NOT NULL,
    maintenance_type VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    performed_by VARCHAR(150) NOT NULL,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    result TEXT,
    next_maintenance_date DATE,
    CONSTRAINT fk_maintenance_asset
        FOREIGN KEY (asset_id)
        REFERENCES assets (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_maintenance_cost
        CHECK (cost >= 0),
    CONSTRAINT chk_maintenance_type
        CHECK (maintenance_type IN ('preventive', 'repair', 'inspection')),
    CONSTRAINT chk_maintenance_next_date
        CHECK (
            next_maintenance_date IS NULL
            OR next_maintenance_date >= maintenance_date
        )
);

CREATE INDEX IF NOT EXISTS idx_assets_category_id
    ON assets (category_id);

CREATE INDEX IF NOT EXISTS idx_assets_status
    ON assets (status);

CREATE INDEX IF NOT EXISTS idx_maintenance_asset_date
    ON maintenance_records (asset_id, maintenance_date DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assets_updated_at ON assets;

CREATE TRIGGER trg_assets_updated_at
BEFORE UPDATE ON assets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
