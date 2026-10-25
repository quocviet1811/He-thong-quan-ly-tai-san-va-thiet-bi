BEGIN;

INSERT INTO asset_categories (name, description)
VALUES
    ('Máy tính', 'Máy tính để bàn và máy tính xách tay'),
    ('Thiết bị mạng', 'Thiết bị kết nối và hạ tầng mạng'),
    ('Thiết bị văn phòng', 'Thiết bị phục vụ công việc văn phòng'),
    ('Thiết bị trình chiếu', 'Màn hình và thiết bị trình chiếu')
ON CONFLICT (name) DO NOTHING;

INSERT INTO assets (
    asset_code,
    name,
    category_id,
    manufacturer,
    model,
    serial_number,
    location,
    purchase_date,
    warranty_until,
    status
)
VALUES
    (
        'AST-COMP-001',
        'Máy tính xách tay văn phòng',
        (SELECT id FROM asset_categories WHERE name = 'Máy tính'),
        'Dell',
        'Latitude 5440',
        'DEMO-LAT-001',
        'Phòng Hành chính',
        DATE '2025-03-15',
        DATE '2028-03-14',
        'in_use'
    ),
    (
        'AST-COMP-002',
        'Máy tính để bàn kế toán',
        (SELECT id FROM asset_categories WHERE name = 'Máy tính'),
        'HP',
        'Pro Tower 400',
        'DEMO-HPT-002',
        'Phòng Kế toán',
        DATE '2024-08-20',
        DATE '2027-08-19',
        'in_use'
    ),
    (
        'AST-NET-001',
        'Bộ chuyển mạch mạng tầng 1',
        (SELECT id FROM asset_categories WHERE name = 'Thiết bị mạng'),
        'TP-Link',
        'TL-SG3428',
        'DEMO-SW-001',
        'Tủ mạng tầng 1',
        DATE '2024-05-10',
        DATE '2027-05-09',
        'in_use'
    ),
    (
        'AST-OFF-001',
        'Máy in đa chức năng',
        (SELECT id FROM asset_categories WHERE name = 'Thiết bị văn phòng'),
        'Brother',
        'MFC-L8900CDW',
        'DEMO-PRN-001',
        'Phòng Hành chính',
        DATE '2023-11-01',
        DATE '2026-10-31',
        'under_maintenance'
    ),
    (
        'AST-DIS-001',
        'Máy chiếu phòng họp',
        (SELECT id FROM asset_categories WHERE name = 'Thiết bị trình chiếu'),
        'Epson',
        'EB-FH52',
        'DEMO-PRJ-001',
        'Phòng họp lớn',
        DATE '2025-01-12',
        DATE '2027-01-11',
        'in_use'
    )
ON CONFLICT (asset_code) DO NOTHING;

INSERT INTO maintenance_records (
    asset_id,
    maintenance_date,
    maintenance_type,
    description,
    performed_by,
    cost,
    result,
    next_maintenance_date
)
SELECT
    assets.id,
    sample.maintenance_date,
    sample.maintenance_type,
    sample.description,
    sample.performed_by,
    sample.cost,
    sample.result,
    sample.next_maintenance_date
FROM (
    VALUES
        (
            'AST-COMP-001',
            DATE '2025-09-15',
            'preventive',
            'Vệ sinh thiết bị, kiểm tra pin và cập nhật hệ điều hành.',
            'Bộ phận Kỹ thuật',
            250000::NUMERIC(12, 2),
            'Thiết bị hoạt động bình thường.',
            DATE '2026-03-15'
        ),
        (
            'AST-COMP-002',
            DATE '2025-06-20',
            'inspection',
            'Kiểm tra ổ cứng, bộ nhớ và hệ thống làm mát.',
            'Bộ phận Kỹ thuật',
            0::NUMERIC(12, 2),
            'Không phát hiện lỗi cần sửa chữa.',
            DATE '2025-12-20'
        ),
        (
            'AST-NET-001',
            DATE '2025-04-10',
            'preventive',
            'Vệ sinh tủ mạng, kiểm tra cổng kết nối và sao lưu cấu hình.',
            'Bộ phận Hạ tầng',
            150000::NUMERIC(12, 2),
            'Các cổng mạng hoạt động bình thường.',
            DATE '2025-10-10'
        ),
        (
            'AST-OFF-001',
            DATE '2025-10-01',
            'repair',
            'Kiểm tra cụm kéo giấy và thay linh kiện hao mòn.',
            'Trung tâm Bảo hành Demo',
            850000::NUMERIC(12, 2),
            'Đang chờ hoàn tất thay thế linh kiện.',
            DATE '2026-04-01'
        ),
        (
            'AST-DIS-001',
            DATE '2025-07-12',
            'inspection',
            'Kiểm tra bóng đèn, độ nét hình ảnh và các cổng kết nối.',
            'Bộ phận Kỹ thuật',
            0::NUMERIC(12, 2),
            'Thiết bị hoạt động bình thường.',
            DATE '2026-01-12'
        )
) AS sample (
    asset_code,
    maintenance_date,
    maintenance_type,
    description,
    performed_by,
    cost,
    result,
    next_maintenance_date
)
JOIN assets ON assets.asset_code = sample.asset_code
WHERE NOT EXISTS (
    SELECT 1
    FROM maintenance_records AS existing
    WHERE existing.asset_id = assets.id
      AND existing.maintenance_date = sample.maintenance_date
      AND existing.maintenance_type = sample.maintenance_type
      AND existing.description = sample.description
);

COMMIT;
