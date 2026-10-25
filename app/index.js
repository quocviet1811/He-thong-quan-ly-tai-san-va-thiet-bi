const path = require("node:path");
const express = require("express");
const session = require("express-session");
const { csrfSync } = require("csrf-sync");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const db = require("./db");
const {
    normalizeAssetInput,
    validateAssetInput,
    validateAssetId,
    normalizeMaintenanceInput,
    validateMaintenanceInput
} = require("./validation");
const app = express();
const port = Number(process.env.PORT || 4000);
const sessionSecret = process.env.SESSION_SECRET;

if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

if (!sessionSecret
    || sessionSecret.startsWith("replace_with_")
    || sessionSecret.length < 32) {
    throw new Error("Set SESSION_SECRET to a private value of at least 32 characters in the project .env file.");
}

const statusLabels = {
    in_use: "Đang sử dụng",
    under_maintenance: "Đang bảo trì",
    retired: "Đã thanh lý"
};

const maintenanceTypeLabels = {
    preventive: "Bảo trì định kỳ",
    repair: "Sửa chữa",
    inspection: "Kiểm tra"
};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
    name: "asset-management.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.SESSION_COOKIE_SECURE === "true"
            || (process.env.SESSION_COOKIE_SECURE !== "false"
                && process.env.NODE_ENV === "production"),
        maxAge: 60 * 60 * 1000
    }
}));
app.use(express.static(path.join(__dirname, "public")));

const { csrfSynchronisedProtection } = csrfSync({
    getTokenFromRequest: req => req.body?._csrf
});

app.use(csrfSynchronisedProtection);

function setFlash(req, type, message) {
    req.session.flash = { type, message };
}

function consumeFlash(req) {
    const flash = req.session.flash || null;
    delete req.session.flash;
    return flash;
}

function statusLabel(status) {
    return statusLabels[status] || "Không xác định";
}

function getPublicError(error) {
    if (error.code === "23505") {
        return "Mã tài sản đã tồn tại. Vui lòng chọn mã khác.";
    }

    if (error.code === "23503") {
        return "Loại tài sản không còn hợp lệ. Vui lòng tải lại biểu mẫu và chọn lại.";
    }

    if (error.code === "23514" || error.code === "22P02") {
        return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại các trường đã nhập.";
    }

    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
        return "Cơ sở dữ liệu hiện chưa sẵn sàng. Dữ liệu chưa được lưu.";
    }

    return "Không thể hoàn thành thao tác. Vui lòng thử lại sau.";
}

function getErrorStatus(error) {
    if (error.code === "23505" || error.code === "23503") {
        return 409;
    }

    if (error.code === "23514" || error.code === "22P02") {
        return 400;
    }

    return 503;
}

function logDatabaseError(operation, error) {
    console.error(`Unable to ${operation} asset.`, {
        code: typeof error.code === "string" ? error.code : "UNKNOWN"
    });
}

async function loadCategories() {
    const { rows } = await db.query(
        "SELECT id, name FROM asset_categories ORDER BY name"
    );
    return rows;
}

async function loadAssetById(id) {
    const { rows } = await db.query(
        `SELECT
            assets.id,
            assets.asset_code,
            assets.name,
            assets.category_id,
            asset_categories.name AS category_name,
            assets.manufacturer,
            assets.model,
            assets.serial_number,
            assets.location,
            assets.purchase_date::text AS purchase_date,
            assets.warranty_until::text AS warranty_until,
            assets.status,
            assets.created_at,
            assets.updated_at
        FROM assets
        JOIN asset_categories
            ON asset_categories.id = assets.category_id
        WHERE assets.id = $1`,
        [id]
    );

    return rows[0] || null;
}

async function loadMaintenanceRecords(assetId) {
    const { rows } = await db.query(
        `SELECT
            id,
            asset_id,
            maintenance_date::text AS maintenance_date,
            maintenance_type,
            description,
            performed_by,
            cost,
            result,
            next_maintenance_date::text AS next_maintenance_date
        FROM maintenance_records
        WHERE asset_id = $1
        ORDER BY maintenance_date DESC, id DESC`,
        [assetId]
    );

    return rows.map(record => ({
        ...record,
        maintenance_type_label:
            maintenanceTypeLabels[record.maintenance_type] || "Không xác định"
    }));
}

async function loadMaintenanceRecord(assetId, recordId) {
    const { rows } = await db.query(
        `SELECT
            id,
            asset_id,
            maintenance_date::text AS maintenance_date,
            maintenance_type,
            description,
            performed_by,
            cost,
            result,
            next_maintenance_date::text AS next_maintenance_date
        FROM maintenance_records
        WHERE asset_id = $1 AND id = $2`,
        [assetId, recordId]
    );

    return rows[0] || null;
}

function formValues(input) {
    return {
        ...input,
        purchase_date: input.purchase_date || "",
        warranty_until: input.warranty_until || ""
    };
}

function maintenanceFormValues(input) {
    return {
        ...input,
        maintenance_date: input.maintenance_date || "",
        cost: input.cost || "0.00",
        next_maintenance_date: input.next_maintenance_date || ""
    };
}

async function renderMaintenanceForm(req, res, {
    asset,
    record,
    errors = [],
    statusCode = 200
}) {
    res.status(statusCode).render("maintenance-form", {
        asset,
        record,
        errors,
        csrfToken: req.csrfToken(),
        isEdit: Boolean(record.id),
        flash: consumeFlash(req)
    });
}

async function renderAssetForm(req, res, {
    asset,
    errors = [],
    statusCode = 200
}) {
    const categories = await loadCategories();

    res.status(statusCode).render("asset-form", {
        asset,
        categories,
        errors,
        csrfToken: req.csrfToken(),
        isEdit: Boolean(asset.id),
        flash: consumeFlash(req)
    });
}

app.get("/", async (req, res) => {
    try {
        const { rows: assets } = await db.query(
            `SELECT
                assets.id,
                assets.asset_code,
                assets.name,
                asset_categories.name AS category_name,
                concat_ws(
                    ' ',
                    NULLIF(btrim(assets.manufacturer), ''),
                    NULLIF(btrim(assets.model), '')
                ) AS manufacturer_model,
                assets.location,
                assets.status
            FROM assets
            JOIN asset_categories
                ON asset_categories.id = assets.category_id
            ORDER BY assets.asset_code`
        );

        res.render("index", {
            assets: assets.map(asset => ({
                ...asset,
                statusLabel: statusLabel(asset.status)
            })),
            databaseError: false,
            flash: consumeFlash(req),
            csrfToken: req.csrfToken()
        });
    } catch (error) {
        console.error("Unable to load assets from PostgreSQL.", {
            code: typeof error.code === "string" ? error.code : "UNKNOWN"
        });
        res.status(503).render("index", {
            assets: [],
            databaseError: true,
            flash: consumeFlash(req),
            csrfToken: req.csrfToken()
        });
    }
});

app.get("/assets/new", async (req, res, next) => {
    try {
        await renderAssetForm(req, res, {
            asset: {
                asset_code: "",
                name: "",
                category_id: "",
                manufacturer: "",
                model: "",
                serial_number: "",
                location: "",
                purchase_date: "",
                warranty_until: "",
                status: "in_use"
            }
        });
    } catch (error) {
        next(error);
    }
});

app.post("/assets", async (req, res, next) => {
    const input = normalizeAssetInput(req.body);
    const errors = validateAssetInput(input);

    if (errors.length > 0) {
        try {
            await renderAssetForm(req, res, {
                asset: formValues(input),
                errors,
                statusCode: 400
            });
        } catch (error) {
            next(error);
        }
        return;
    }

    try {
        await db.query(
            `INSERT INTO assets (
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                input.asset_code,
                input.name,
                input.category_id,
                input.manufacturer,
                input.model,
                input.serial_number,
                input.location,
                input.purchase_date,
                input.warranty_until,
                input.status
            ]
        );

        setFlash(req, "success", "Đã thêm tài sản mới.");
        res.redirect(303, "/");
    } catch (error) {
        logDatabaseError("create", error);
        try {
            await renderAssetForm(req, res, {
                asset: formValues(input),
                errors: [getPublicError(error)],
                statusCode: getErrorStatus(error)
            });
        } catch (renderError) {
            next(renderError);
        }
    }
});

app.get("/assets/:id", async (req, res, next) => {
    const id = validateAssetId(req.params.id);

    if (!id) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    try {
        const asset = await loadAssetById(id);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        res.render("asset-detail", {
            asset: {
                ...asset,
                statusLabel: statusLabel(asset.status)
            },
            maintenanceRecords: await loadMaintenanceRecords(id),
            csrfToken: req.csrfToken(),
            flash: consumeFlash(req),
            errorMessage: null
        });
    } catch (error) {
        next(error);
    }
});

app.get("/assets/:id/maintenance/new", async (req, res, next) => {
    const assetId = validateAssetId(req.params.id);

    if (!assetId) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    try {
        const asset = await loadAssetById(assetId);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        await renderMaintenanceForm(req, res, {
            asset,
            record: {
                maintenance_date: "",
                maintenance_type: "preventive",
                description: "",
                performed_by: "",
                cost: "0.00",
                result: "",
                next_maintenance_date: ""
            }
        });
    } catch (error) {
        next(error);
    }
});

app.post("/assets/:id/maintenance", async (req, res, next) => {
    const assetId = validateAssetId(req.params.id);

    if (!assetId) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    const input = normalizeMaintenanceInput(req.body);
    const errors = validateMaintenanceInput(input);

    try {
        const asset = await loadAssetById(assetId);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Không thể ghi nhận bảo trì cho tài sản không tồn tại."
            });
            return;
        }

        if (errors.length > 0) {
            await renderMaintenanceForm(req, res, {
                asset,
                record: maintenanceFormValues(input),
                errors,
                statusCode: 400
            });
            return;
        }

        await db.query(
            `INSERT INTO maintenance_records (
                asset_id,
                maintenance_date,
                maintenance_type,
                description,
                performed_by,
                cost,
                result,
                next_maintenance_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                assetId,
                input.maintenance_date,
                input.maintenance_type,
                input.description,
                input.performed_by,
                input.cost,
                input.result,
                input.next_maintenance_date
            ]
        );

        setFlash(req, "success", "Đã thêm lịch sử bảo trì.");
        res.redirect(303, `/assets/${assetId}`);
    } catch (error) {
        if (error.code === "23503") {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản không còn tồn tại để ghi nhận bảo trì."
            });
            return;
        }

        logDatabaseError("create maintenance record", error);
        try {
            const asset = await loadAssetById(assetId);

            if (!asset) {
                res.status(404).render("error", {
                    title: "Không tìm thấy tài sản",
                    message: "Không thể ghi nhận bảo trì cho tài sản không tồn tại."
                });
                return;
            }

            await renderMaintenanceForm(req, res, {
                asset,
                record: maintenanceFormValues(input),
                errors: ["Không thể lưu lịch sử bảo trì. Vui lòng thử lại sau."],
                statusCode: 503
            });
        } catch (renderError) {
            next(renderError);
        }
    }
});

app.get("/assets/:id/maintenance/:recordId/edit", async (req, res, next) => {
    const assetId = validateAssetId(req.params.id);
    const recordId = validateAssetId(req.params.recordId);

    if (!assetId || !recordId) {
        res.status(400).render("error", {
            title: "Mã bảo trì không hợp lệ",
            message: "Đường dẫn tài sản hoặc lịch sử bảo trì không hợp lệ."
        });
        return;
    }

    try {
        const asset = await loadAssetById(assetId);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        const record = await loadMaintenanceRecord(assetId, recordId);

        if (!record) {
            res.status(404).render("error", {
                title: "Không tìm thấy lịch sử bảo trì",
                message: "Bản ghi không tồn tại hoặc không thuộc tài sản đang xem."
            });
            return;
        }

        await renderMaintenanceForm(req, res, {
            asset,
            record: maintenanceFormValues(record)
        });
    } catch (error) {
        next(error);
    }
});

app.post("/assets/:id/maintenance/:recordId/edit", async (req, res, next) => {
    const assetId = validateAssetId(req.params.id);
    const recordId = validateAssetId(req.params.recordId);

    if (!assetId || !recordId) {
        res.status(400).render("error", {
            title: "Mã bảo trì không hợp lệ",
            message: "Đường dẫn tài sản hoặc lịch sử bảo trì không hợp lệ."
        });
        return;
    }

    const input = normalizeMaintenanceInput(req.body);
    const errors = validateMaintenanceInput(input);

    try {
        const asset = await loadAssetById(assetId);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        const existingRecord = await loadMaintenanceRecord(assetId, recordId);

        if (!existingRecord) {
            res.status(404).render("error", {
                title: "Không tìm thấy lịch sử bảo trì",
                message: "Bản ghi không tồn tại hoặc không thuộc tài sản đang xem."
            });
            return;
        }

        if (errors.length > 0) {
            await renderMaintenanceForm(req, res, {
                asset,
                record: { ...maintenanceFormValues(input), id: recordId },
                errors,
                statusCode: 400
            });
            return;
        }

        const { rowCount } = await db.query(
            `UPDATE maintenance_records
            SET maintenance_date = $1,
                maintenance_type = $2,
                description = $3,
                performed_by = $4,
                cost = $5,
                result = $6,
                next_maintenance_date = $7
            WHERE asset_id = $8 AND id = $9`,
            [
                input.maintenance_date,
                input.maintenance_type,
                input.description,
                input.performed_by,
                input.cost,
                input.result,
                input.next_maintenance_date,
                assetId,
                recordId
            ]
        );

        if (rowCount === 0) {
            res.status(404).render("error", {
                title: "Không tìm thấy lịch sử bảo trì",
                message: "Bản ghi không tồn tại hoặc không thuộc tài sản đang xem."
            });
            return;
        }

        setFlash(req, "success", "Lịch sử bảo trì đã được cập nhật.");
        res.redirect(303, `/assets/${assetId}`);
    } catch (error) {
        logDatabaseError("update maintenance record", error);
        try {
            const asset = await loadAssetById(assetId);

            if (!asset) {
                res.status(404).render("error", {
                    title: "Không tìm thấy tài sản",
                    message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
                });
                return;
            }

            await renderMaintenanceForm(req, res, {
                asset,
                record: { ...maintenanceFormValues(input), id: recordId },
                errors: ["Không thể cập nhật lịch sử bảo trì. Vui lòng thử lại sau."],
                statusCode: 503
            });
        } catch (renderError) {
            next(renderError);
        }
    }
});

app.get("/assets/:id/edit", async (req, res, next) => {
    const id = validateAssetId(req.params.id);

    if (!id) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    try {
        const asset = await loadAssetById(id);

        if (!asset) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        await renderAssetForm(req, res, {
            asset: formValues(asset)
        });
    } catch (error) {
        next(error);
    }
});

app.post("/assets/:id/edit", async (req, res, next) => {
    const id = validateAssetId(req.params.id);

    if (!id) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    const input = normalizeAssetInput(req.body);
    const errors = validateAssetInput(input);

    if (errors.length > 0) {
        try {
            await renderAssetForm(req, res, {
                asset: { ...formValues(input), id },
                errors,
                statusCode: 400
            });
        } catch (error) {
            next(error);
        }
        return;
    }

    try {
        const { rowCount } = await db.query(
            `UPDATE assets
            SET asset_code = $1,
                name = $2,
                category_id = $3,
                manufacturer = $4,
                model = $5,
                serial_number = $6,
                location = $7,
                purchase_date = $8,
                warranty_until = $9,
                status = $10
            WHERE id = $11`,
            [
                input.asset_code,
                input.name,
                input.category_id,
                input.manufacturer,
                input.model,
                input.serial_number,
                input.location,
                input.purchase_date,
                input.warranty_until,
                input.status,
                id
            ]
        );

        if (rowCount === 0) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        setFlash(req, "success", "Thông tin tài sản đã được cập nhật.");
        res.redirect(303, `/assets/${id}`);
    } catch (error) {
        logDatabaseError("update", error);
        try {
            await renderAssetForm(req, res, {
                asset: { ...formValues(input), id },
                errors: [getPublicError(error)],
                statusCode: getErrorStatus(error)
            });
        } catch (renderError) {
            next(renderError);
        }
    }
});

app.post("/assets/:id/delete", async (req, res, next) => {
    const id = validateAssetId(req.params.id);

    if (!id) {
        res.status(400).render("error", {
            title: "Mã tài sản không hợp lệ",
            message: "Đường dẫn tài sản không hợp lệ."
        });
        return;
    }

    try {
        const { rowCount } = await db.query(
            "DELETE FROM assets WHERE id = $1",
            [id]
        );

        if (rowCount === 0) {
            res.status(404).render("error", {
                title: "Không tìm thấy tài sản",
                message: "Tài sản này không tồn tại hoặc đã được gỡ khỏi hệ thống."
            });
            return;
        }

        setFlash(req, "success", "Đã xóa tài sản.");
        res.redirect(303, "/");
    } catch (error) {
        logDatabaseError("delete", error);

        if (error.code === "23503") {
            let asset;

            try {
                asset = await loadAssetById(id);
            } catch (lookupError) {
                logDatabaseError("load after delete failure", lookupError);
                next(lookupError);
                return;
            }

            if (asset) {
                res.status(409).render("asset-detail", {
                    asset: {
                        ...asset,
                        statusLabel: statusLabel(asset.status)
                    },
                    maintenanceRecords: await loadMaintenanceRecords(id),
                    csrfToken: req.csrfToken(),
                    flash: null,
                    errorMessage: "Không thể xóa tài sản vì vẫn còn lịch sử bảo trì liên kết."
                });
                return;
            }
        }

        next(error);
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.use((error, req, res, next) => {
    if (error.code === "EBADCSRFTOKEN") {
        res.status(403).render("error", {
            title: "Yêu cầu không hợp lệ",
            message: "Phiên biểu mẫu không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang rồi thử lại."
        });
        return;
    }

    if (error.type === "entity.too.large") {
        res.status(413).render("error", {
            title: "Dữ liệu quá lớn",
            message: "Dữ liệu gửi lên vượt quá giới hạn cho phép."
        });
        return;
    }

    console.error("Unhandled application error.");
    res.status(500).render("error", {
        title: "Đã xảy ra lỗi",
        message: "Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau."
    });
});

app.listen(port, () => {
    console.log(`Asset Management app is listening on port ${port}`);
});
