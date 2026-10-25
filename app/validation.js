const allowedStatuses = new Set([
    "in_use",
    "under_maintenance",
    "retired"
]);
const allowedMaintenanceTypes = new Set([
    "preventive",
    "repair",
    "inspection"
]);

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
    return normalizeText(value) || null;
}

function normalizeDate(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}

function normalizeAssetInput(body = {}) {
    if (!body || typeof body !== "object") {
        body = {};
    }

    return {
        asset_code: normalizeText(body.asset_code),
        name: normalizeText(body.name),
        category_id: normalizeText(body.category_id),
        manufacturer: normalizeOptionalText(body.manufacturer),
        model: normalizeOptionalText(body.model),
        serial_number: normalizeOptionalText(body.serial_number),
        location: normalizeText(body.location),
        purchase_date: normalizeDate(body.purchase_date),
        warranty_until: normalizeDate(body.warranty_until),
        status: normalizeText(body.status)
    };
}

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function validateAssetInput(input) {
    const errors = [];

    if (!input.asset_code) {
        errors.push("Vui lòng nhập mã tài sản.");
    } else if (input.asset_code.length > 50) {
        errors.push("Mã tài sản không được vượt quá 50 ký tự.");
    }

    if (!input.name) {
        errors.push("Vui lòng nhập tên tài sản.");
    } else if (input.name.length > 150) {
        errors.push("Tên tài sản không được vượt quá 150 ký tự.");
    }

    if (!/^[1-9]\d*$/.test(input.category_id)
        || !Number.isSafeInteger(Number(input.category_id))) {
        errors.push("Vui lòng chọn loại tài sản hợp lệ.");
    } else {
        input.category_id = Number(input.category_id);
    }

    for (const [field, label, maxLength] of [
        ["manufacturer", "Hãng sản xuất", 100],
        ["model", "Model", 100],
        ["serial_number", "Số serial", 100]
    ]) {
        if (input[field] && input[field].length > maxLength) {
            errors.push(`${label} không được vượt quá ${maxLength} ký tự.`);
        }
    }

    if (!input.location) {
        errors.push("Vui lòng nhập vị trí tài sản.");
    } else if (input.location.length > 150) {
        errors.push("Vị trí không được vượt quá 150 ký tự.");
    }

    if (!allowedStatuses.has(input.status)) {
        errors.push("Vui lòng chọn trạng thái tài sản hợp lệ.");
    }

    for (const [field, label] of [
        ["purchase_date", "Ngày mua"],
        ["warranty_until", "Ngày hết hạn bảo hành"]
    ]) {
        if (input[field] && !isValidDate(input[field])) {
            errors.push(`${label} không hợp lệ.`);
        }
    }

    if (input.purchase_date
        && input.warranty_until
        && isValidDate(input.purchase_date)
        && isValidDate(input.warranty_until)
        && input.warranty_until < input.purchase_date) {
        errors.push("Ngày hết hạn bảo hành không được trước ngày mua.");
    }

    return errors;
}

function validateAssetId(value) {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function normalizeMaintenanceInput(body = {}) {
    if (!body || typeof body !== "object") {
        body = {};
    }

    return {
        maintenance_date: normalizeText(body.maintenance_date),
        maintenance_type: normalizeText(body.maintenance_type),
        description: normalizeText(body.description),
        performed_by: normalizeText(body.performed_by),
        cost: normalizeText(body.cost),
        result: normalizeOptionalText(body.result),
        next_maintenance_date: normalizeDate(body.next_maintenance_date)
    };
}

function validateMaintenanceInput(input) {
    const errors = [];

    if (!isValidDate(input.maintenance_date)) {
        errors.push("Ngày bảo trì không hợp lệ.");
    }

    if (!allowedMaintenanceTypes.has(input.maintenance_type)) {
        errors.push("Vui lòng chọn loại bảo trì hợp lệ.");
    }

    if (!input.description) {
        errors.push("Vui lòng nhập nội dung bảo trì.");
    } else if (input.description.length > 8000) {
        errors.push("Nội dung bảo trì không được vượt quá 8000 ký tự.");
    }

    if (!input.performed_by) {
        errors.push("Vui lòng nhập người thực hiện.");
    } else if (input.performed_by.length > 150) {
        errors.push("Người thực hiện không được vượt quá 150 ký tự.");
    }

    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input.cost)) {
        errors.push("Chi phí phải là số không âm, tối đa 10 chữ số nguyên và 2 chữ số thập phân.");
    } else {
        const [integer, fraction = ""] = input.cost.split(".");
        input.cost = `${integer}.${fraction.padEnd(2, "0")}`;
    }

    if (input.result && input.result.length > 8000) {
        errors.push("Kết quả không được vượt quá 8000 ký tự.");
    }

    if (input.next_maintenance_date
        && !isValidDate(input.next_maintenance_date)) {
        errors.push("Ngày bảo trì tiếp theo không hợp lệ.");
    }

    if (isValidDate(input.maintenance_date)
        && input.next_maintenance_date
        && isValidDate(input.next_maintenance_date)
        && input.next_maintenance_date < input.maintenance_date) {
        errors.push("Ngày bảo trì tiếp theo không được trước ngày bảo trì.");
    }

    return errors;
}

module.exports = {
    normalizeAssetInput,
    validateAssetInput,
    validateAssetId,
    normalizeMaintenanceInput,
    validateMaintenanceInput
};
