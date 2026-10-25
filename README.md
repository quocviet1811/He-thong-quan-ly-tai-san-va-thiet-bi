# Hệ thống Quản lý Tài sản / Thiết bị

Dự án Đề tài 16 của sinh viên Nông Quốc Việt (DTC245200869), thuộc môn Triển khai và Quản trị Hệ thống Phần mềm.

## Giai đoạn hiện tại

Ứng dụng sử dụng Node.js, Express.js, EJS và PostgreSQL. Có thể xem danh sách/chi tiết, thêm, sửa và xóa tài sản; xem, thêm và sửa lịch sử bảo trì của tài sản.

## Yêu cầu

- Docker Desktop với Docker Compose v2

## Chạy bằng Docker Compose

Từ thư mục dự án, tạo file `.env` riêng từ mẫu nếu chưa có:

```powershell
Copy-Item .\.env.example .\.env
```

Đặt các mật khẩu PostgreSQL và pgAdmin riêng, rồi tạo `SESSION_SECRET` ngẫu nhiên tối thiểu 32 ký tự trong `.env`. Có thể tạo secret bằng PowerShell:

```powershell
([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)))
```

Không commit `.env`. Xác nhận cấu hình rồi khởi chạy:

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Xem nhật ký và kiểm tra ứng dụng từ bên trong container:

```powershell
docker compose logs --tail 100 app postgres
docker compose exec app node -e "fetch('http://127.0.0.1:4000/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) }).catch(e => { console.error(e.message); process.exit(1) })"
docker compose exec app node -e "const { Client } = require('pg'); const c = new Client(); c.connect().then(() => c.query('SELECT count(*)::int AS assets FROM assets')).then(r => { console.log(r.rows[0]); return c.end() }).catch(e => { console.error(e.message); process.exit(1) })"
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" -c "SELECT count(*) AS assets FROM assets"'
```

Truy cập website qua Nginx tại <http://localhost:8186> và giao diện pgAdmin tại <http://localhost:8187>. Có thể đổi hai cổng bằng `NGINX_HOST_PORT` và `PGADMIN_HOST_PORT` trong `.env`. Cả hai cổng chỉ bind trên loopback; PostgreSQL và Express không publish cổng ra host.

## Mạng Docker

```text
Trình duyệt --127.0.0.1:8186--> nginx --frontend--> app:4000
                                          app --backend (internal)--> postgres:5432
pgAdmin --backend (internal)-----------------------> postgres:5432
Trình duyệt --127.0.0.1:8187--> pgAdmin --admin network
```

- `frontend` chỉ chứa Nginx và app; Nginx không tham gia backend.
- `backend` là network `internal`, chứa app, PostgreSQL và pgAdmin.
- `admin` chỉ nối pgAdmin, ngoài cổng quản trị bind vào `127.0.0.1`.
- App kết nối database qua hostname service `postgres`, không dùng IP hoặc port host.

### Đăng nhập và kết nối pgAdmin

Đăng nhập giao diện pgAdmin bằng `PGADMIN_DEFAULT_EMAIL` và `PGADMIN_DEFAULT_PASSWORD` trong `.env`. Đây là tài khoản pgAdmin, **khác** tài khoản PostgreSQL.

Với volume cấu hình pgAdmin mới, [pgadmin/servers.json](./pgadmin/servers.json) tự đăng ký server `Asset Management 16` khi cấu hình pgAdmin được khởi tạo lần đầu. File chỉ chứa host/database/username, không chứa mật khẩu; `SavePassword` tắt. Khi kết nối, pgAdmin yêu cầu nhập mật khẩu PostgreSQL từ `.env`. Image chỉ import server JSON khi database cấu hình pgAdmin mới được tạo; sửa JSON sau khi volume `asset_management_16_pgadmin_data` đã khởi tạo không tự nhập lại server.

Nếu server chưa có trong cây **Servers**, chọn **Register → Server**:

- **General → Name:** `Asset Management 16`
- **Connection → Host name/address:** `postgres`
- **Port:** `5432`
- **Maintenance database:** giá trị `POSTGRES_DB` trong `.env`
- **Username:** giá trị `POSTGRES_USER` trong `.env`
- **Password:** giá trị `POSTGRES_PASSWORD` trong `.env`

Không lưu mật khẩu trong file JSON cấu hình máy chủ; nhập mật khẩu PostgreSQL khi pgAdmin yêu cầu. Nếu đổi `POSTGRES_DB` hoặc `POSTGRES_USER` trong `.env`, cập nhật các trường tương ứng trong `pgadmin/servers.json`.

### Session cookie và reverse proxy

Compose đặt `TRUST_PROXY=1` để Express chỉ tin một proxy phía trước (Nginx) khi diễn giải `X-Forwarded-Proto`. Demo hiện dùng HTTP trên loopback, vì vậy `SESSION_COOKIE_SECURE=false` để session và CSRF hoạt động qua HTTP. Khi cấu hình HTTPS, đặt `SESSION_COOKIE_SECURE=true`. Cookie vẫn có `HttpOnly` và `SameSite=Lax`.

Các thao tác ghi dùng session cookie `HttpOnly`, `SameSite=Lax` và CSRF synchronizer token. Cờ `Secure` mặc định bật trong production, trừ khi `SESSION_COOKIE_SECURE=false` được đặt rõ cho demo HTTP local; khi dùng HTTPS phải đặt giá trị này thành `true`. Ứng dụng hiện dùng session store trong bộ nhớ, phù hợp cho giai đoạn phát triển/demo đơn tiến trình; chưa phù hợp để chạy nhiều instance hoặc triển khai production lâu dài.

### Khởi tạo database và lưu trữ

- Khi volume PostgreSQL mới và rỗng được khởi tạo lần đầu, image chính thức chạy `database/schema.sql` rồi `database/seed.sql` từ `/docker-entrypoint-initdb.d`.
- Entrypoint chỉ chạy các script khởi tạo khi thư mục dữ liệu PostgreSQL còn trống. Sửa schema/seed sau khi volume đã được khởi tạo **không** tự áp dụng thay đổi và không tự nạp lại seed.
- Dữ liệu được giữ trong named volume `asset_management_16_postgres_data` sau khi container restart hoặc recreate. `docker compose down` giữ volume; không dùng `docker compose down -v` nếu chưa có kế hoạch sao lưu và xóa dữ liệu rõ ràng.
- Cấu hình pgAdmin được giữ trong named volume `asset_management_16_pgadmin_data`.
- PostgreSQL không publish cổng host. Không mount hoặc dùng volume/network của dự án khác.

Kiểm tra Nginx, security headers, session cookie và danh sách tài sản từ host:

```powershell
Invoke-WebRequest http://localhost:8186/ -UseBasicParsing
Invoke-WebRequest http://localhost:8186/assets/1 -UseBasicParsing
Invoke-WebRequest http://localhost:8186/styles.css -UseBasicParsing
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt" -c "SELECT count(*) AS assets FROM assets"'
```

## Quản lý tài sản

- Mở `/assets/new` để thêm tài sản; mở từng tài sản để xem chi tiết hoặc chỉnh sửa.
- Xóa chỉ dùng biểu mẫu `POST` có xác nhận và CSRF token. PostgreSQL từ chối xóa tài sản còn lịch sử bảo trì.
- Backend kiểm tra độ dài, trạng thái, ID, ngày mua/bảo hành và loại tài sản. Các câu lệnh ghi dùng parameterized queries.
- Thông báo kết quả dùng POST/Redirect/GET. Mã tài sản trùng được trả về dưới dạng lỗi thân thiện.

## Lịch sử bảo trì

- Chi tiết tài sản hiển thị các lần bảo trì mới nhất trước; mỗi bản ghi chỉ được truy vấn và sửa trong phạm vi tài sản đang xem.
- Dùng `/assets/:id/maintenance/new` để thêm và `/assets/:id/maintenance/:recordId/edit` để chỉnh sửa.
- Ngày, loại, nội dung, người thực hiện, chi phí và ngày bảo trì kế tiếp được kiểm tra ở backend trước khi ghi.
- Không có chức năng xóa lịch sử bảo trì; tài sản có lịch sử tiếp tục được bảo vệ bởi khóa ngoại `ON DELETE RESTRICT`.

## Cấu trúc

```text
app/
├── index.js
├── db.js
├── validation.js
├── package.json
├── package-lock.json
├── Dockerfile
├── .dockerignore
├── public/
│   └── styles.css
└── views/
    ├── index.ejs
    ├── asset-form.ejs
    ├── asset-detail.ejs
    ├── maintenance-form.ejs
    └── error.ejs
database/
├── schema.sql
└── seed.sql
nginx/
└── default.conf
.env.example
.gitignore
README.md
docker-compose.yml
pgadmin/
└── servers.json
```

Docker Compose có bốn service `app`, `postgres`, `nginx` và `pgadmin`; ba network `frontend`, `backend` và `admin`; hai named volume riêng cho PostgreSQL và pgAdmin. Monitoring/logging chưa nằm trong phạm vi hiện tại.
