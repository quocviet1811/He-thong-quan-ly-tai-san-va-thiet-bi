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
Prometheus --monitoring--> PostgreSQL Exporter --backend--> postgres
Prometheus --monitoring--> Nginx Exporter --frontend--> nginx:8080/stub_status
Prometheus --monitoring--> Docker Stats Exporter --docker_stats--> Docker Stats Gateway
                                                        Docker Stats Gateway --docker_api--> Docker Socket Proxy
Trình duyệt --127.0.0.1:3190--> Grafana --monitoring--> Prometheus
```

- `frontend` chỉ chứa Nginx và app; Nginx không tham gia backend.
- `backend` là network `internal`, chứa app, PostgreSQL và pgAdmin.
- `admin` chỉ nối pgAdmin, ngoài cổng quản trị bind vào `127.0.0.1`.
- `monitoring` chứa Prometheus và các exporter; PostgreSQL Exporter/Nginx Exporter chỉ tham gia network ứng dụng tối thiểu cần thiết.
- Grafana và Prometheus cùng nối network `monitoring`; Grafana chỉ publish loopback trên cổng 3190.
- `docker_api` là network `internal`, chỉ nối Docker Socket Proxy và Docker Stats Gateway. `docker_stats` là network `internal`, chỉ nối gateway và exporter. Prometheus, app, PostgreSQL, Nginx và pgAdmin không thể gọi Docker API trực tiếp.
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

## Giám sát PostgreSQL bằng Prometheus

Prometheus và PostgreSQL Exporter được chạy cùng Docker Compose:

- Prometheus dùng image `prom/prometheus:v3.15.1`, lưu dữ liệu ở named volume `asset_management_16_prometheus_data` và giữ tối đa 7 ngày hoặc 1 GB dữ liệu time-series.
- PostgreSQL Exporter dùng image `prometheuscommunity/postgres-exporter:v0.20.1`, thu thập metrics từ PostgreSQL hiện có qua `postgres:5432`.
- Giao diện Prometheus chỉ bind loopback tại <http://localhost:9190>. Exporter không publish cổng ra host.
- Prometheus và exporter dùng network riêng `asset_management_16_monitoring`; exporter đồng thời kết nối network backend để truy cập PostgreSQL. PostgreSQL không được nối vào network monitoring. Đây là bridge network riêng (không `internal`) để Docker Desktop có thể publish UI Prometheus; cổng UI vẫn chỉ bind loopback và exporter không publish cổng host.
- Tài khoản `asset_monitor` chỉ được cấp quyền PostgreSQL `pg_monitor`, không cấp quyền đọc bảng nghiệp vụ. Mật khẩu riêng được đặt trong `.env` dưới `POSTGRES_EXPORTER_PASSWORD`; không dùng mật khẩu ứng dụng hoặc đưa mật khẩu vào URL datasource.
- `monitoring/prometheus/prometheus.yml` định nghĩa scrape job `prometheus`, `postgres`, `nginx` và `docker_stats`.
- Grafana dùng image cố định `grafana/grafana:12.2.1`, lưu cấu hình/dữ liệu trong named volume `asset_management_16_grafana_data`; Prometheus datasource và dashboard AssetCare được provision tự động từ các file trong `monitoring/grafana/`.
- Nginx Exporter dùng `nginx/nginx-prometheus-exporter:1.5.3`. Nginx cung cấp `stub_status` riêng trên cổng nội bộ 8080; `/stub_status` qua website ở cổng 80 trả 404. Exporter chỉ kết nối qua frontend và monitoring network, không publish cổng host.
- Docker Stats Exporter là giải pháp thay thế độc lập, **không phải cAdvisor**. cAdvisor `ghcr.io/google/cadvisor:v0.60.6` đã được thử nhưng không tạo được metrics CPU/RAM theo container trên Docker Desktop/WSL2 do thiếu containerd socket nội bộ; cAdvisor không nằm trong Compose hiện tại.
- Docker Stats Exporter dùng Node.js built-in APIs, chạy non-root, chỉ nhận snapshot đã lọc từ Docker Stats Gateway. CPU lấy từ `cpu_stats.cpu_usage.total_usage` của Docker Engine (nanoseconds chuyển thành cumulative CPU seconds; không phải CPU percentage). Bộ nhớ lấy trực tiếp từ `memory_stats.usage` (bytes). Không xuất working-set metric: trên Docker Desktop/WSL2, phép tính trừ inactive-file không đối chiếu ổn định với `docker stats` cho mọi container, nên không gắn nhãn working set cho số liệu chưa xác minh được.
- Docker Socket Proxy dùng `tecnativa/docker-socket-proxy:v0.5.0`, không `privileged`, không publish API port; chỉ proxy mount Docker socket ở chế độ read-only. `POST=0`, `CONTAINERS=1`; các nhóm `INFO`, `VERSION`, `PING`, `EVENTS` tắt. Tài liệu của proxy cho biết quyền `CONTAINERS=1` cho phép các request GET trong nhóm container, gồm cả một số API đọc rộng như logs. Vì vậy proxy chỉ nối với gateway trên network `docker_api`; gateway không có socket và chỉ thực hiện GET `/containers/json` với bộ lọc project cố định cùng GET `/containers/{id}/stats?stream=false` cho ID có nhãn project chính xác. Gateway chỉ trả snapshot đã lọc, không có endpoint chuyển tiếp tùy ý; logs, archive, exec, ghi/xóa/dừng/tạo container không được expose qua gateway.
- Docker API vẫn là quyền đọc ở cấp Docker Engine. Nếu gateway bị xâm nhập, proxy phía sau có thể đọc thêm metadata/logs của các container khác trên cùng Engine; giới hạn này không thể loại bỏ hoàn toàn bằng biến cấu hình của image proxy đã chọn. Giảm thiểu hiện tại là network nội bộ chỉ gồm proxy/gateway, exporter không nối trực tiếp vào `docker_api`, không có cổng host, không có API ghi, gateway/exporter non-root và giới hạn 64 MiB mỗi container. Không mount containerd socket và không cấp `privileged`.

Đặt mật khẩu giám sát riêng trong `.env` trước khi khởi chạy. Để tạo/cập nhật role giám sát an toàn trên database hiện tại mà không reset dữ liệu, trong PowerShell từ thư mục dự án:

```powershell
$envFile = Get-Content .\.env
$monitorPassword = ($envFile | Where-Object { $_ -match '^POSTGRES_EXPORTER_PASSWORD=' } | Select-Object -First 1) -replace '^POSTGRES_EXPORTER_PASSWORD=', ''
if (-not $monitorPassword -or $monitorPassword -eq 'replace_with_a_unique_monitoring_secret') {
    throw 'Set a unique POSTGRES_EXPORTER_PASSWORD in .env first.'
}
$psqlScript = "\set monitor_password $monitorPassword`nSELECT format('CREATE ROLE asset_monitor LOGIN PASSWORD %L', :'monitor_password') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asset_monitor') \gexec`nALTER ROLE asset_monitor LOGIN PASSWORD :'monitor_password';`nGRANT pg_monitor TO asset_monitor;"
$psqlScript | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U asset_app -d asset_management
docker compose up -d postgres-exporter prometheus
```

`pg_monitor` là role giám sát có sẵn của PostgreSQL. Mật khẩu được gửi cho `psql` qua standard input, không nằm trong command argument hoặc datasource URL. Với database mới, chạy bước tạo role sau khi PostgreSQL healthy; câu lệnh không xóa hoặc sửa các bảng nghiệp vụ.

Đặt `GRAFANA_ADMIN_PASSWORD` thành mật khẩu riêng trong `.env` (không commit file này), sau đó khởi chạy Grafana:

```powershell
docker compose up -d grafana
```

Mở <http://127.0.0.1:3190>, đăng nhập bằng username `admin` và mật khẩu trong `.env`. Dashboard `AssetCare - Monitoring` được tự động nạp cùng Prometheus datasource; các panel hiển thị target health, PostgreSQL connections, Nginx request rate, CPU theo service và raw Docker API memory theo service.

Khởi chạy thêm Docker Stats Exporter và các thành phần giới hạn API:

```powershell
docker compose up -d --build docker-socket-proxy docker-stats-gateway docker-stats-exporter
docker compose restart prometheus
```

Kiểm tra target và truy vấn metrics hiện tại:

```powershell
Invoke-RestMethod http://127.0.0.1:9190/api/v1/targets
Invoke-RestMethod -Uri 'http://127.0.0.1:9190/api/v1/query?query=up%7Bjob%3D%22postgres%22%7D'
Invoke-RestMethod -Uri 'http://127.0.0.1:9190/api/v1/query?query=pg_up'
Invoke-RestMethod -Uri 'http://127.0.0.1:9190/api/v1/query?query=pg_stat_database_numbackends'
Invoke-RestMethod -Uri 'http://127.0.0.1:9190/api/v1/query?query=nginx_up'
Invoke-RestMethod -Uri 'http://127.0.0.1:9190/api/v1/query?query=nginx_http_requests_total'
```

Truy vấn metrics container trong Prometheus:

```promql
asset16_container_cpu_usage_seconds_total{project="asset-management-16"}
rate(asset16_container_cpu_usage_seconds_total{project="asset-management-16"}[5m])
asset16_container_memory_usage_bytes{project="asset-management-16"}
asset16_container_scrape_success{project="asset-management-16"}
```

`rate(...[5m])` cho biết số CPU core trung bình đã dùng; metric CPU gốc là bộ đếm cumulative CPU seconds. Metric RAM là `memory_stats.usage` nguyên bản từ API, không phải phần trăm hoặc working set. Đây là raw API usage, không phải số hiển thị giống hệt `docker stats`; Docker CLI trừ cache và lấy mẫu ở thời điểm riêng. Trên Docker Desktop/WSL2, phép trừ inactive-file không đối chiếu ổn định với CLI cho mọi container, nên không xuất metric working set.

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
monitoring/
├── prometheus/
│   └── prometheus.yml
├── postgres-exporter/
│   └── postgres_exporter.yml
└── grafana/
    ├── dashboards/
    │   └── assetcare-overview.json
    └── provisioning/
        ├── dashboards/
        │   └── assetcare.yml
        └── datasources/
            └── prometheus.yml
├── docker-stats-gateway/
│   ├── Dockerfile
│   └── server.js
└── docker-stats-exporter/
    ├── Dockerfile
    └── server.js
.env.example
.gitignore
README.md
docker-compose.yml
pgadmin/
└── servers.json
```

Docker Compose có mười một service `app`, `postgres`, `nginx`, `pgadmin`, `postgres-exporter`, `nginx-exporter`, `prometheus`, `grafana`, `docker-socket-proxy`, `docker-stats-gateway` và `docker-stats-exporter`; sáu network `frontend`, `backend`, `admin`, `monitoring`, `docker_api` và `docker_stats`; bốn named volume riêng cho PostgreSQL, pgAdmin, Prometheus và Grafana. cAdvisor chưa được triển khai do giới hạn runtime nêu trên; Loki và Promtail chưa nằm trong phạm vi bước này.
