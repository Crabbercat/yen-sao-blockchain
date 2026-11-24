# Yen Sao Blockchain

Prototype truy xuất nguồn gốc yến sào Cù Lao Chàm theo `SPEC.md`. Hyperledger
Fabric là ledger cho các sự kiện chuỗi cung ứng; PostgreSQL lưu tài khoản,
session, audit và metadata ứng dụng; Express phục vụ API lẫn frontend Vanilla JS.

**Tiến độ:** Phase 0–4 đã đạt exit criteria; Phase 5 chưa đạt vì còn thiếu
kiểm thử lifecycle trọn vẹn qua trình duyệt; Phase 6 đã triển khai nhưng chưa
chốt; Phase 7 đang kiểm thử; Phase 8 chưa bắt đầu. Xem
[docs/implementation-status.md](docs/implementation-status.md) để biết bằng
chứng và giới hạn hiện tại. Đây là lab/prototype một máy, không phải cấu hình
production.

## Yêu cầu

- Docker Desktop/Engine và Docker Compose.
- Node.js 22 trở lên cho các lệnh npm cục bộ.
- Bash (khuyến nghị WSL2 Debian với Docker Desktop WSL integration) để chạy
  các script dựng mạng Fabric.

## Thiết lập `.env`

Từ PowerShell tại repository root:

```powershell
Copy-Item .env.example .env
```

Thay tất cả giá trị `replace_with_...` bằng secret ngẫu nhiên riêng biệt. Đặt
`DEMO_USERS_PASSWORD` tối thiểu 12 ký tự; mật khẩu này được dùng cho các tài
khoản demo ngoài production. Không đưa `.env` hoặc crypto material vào Git.

## Khởi chạy lab mới

### 1. Dựng Fabric và chaincode

Từ WSL2 Debian, tại repository root:

```bash
./blockchain/network/scripts/check-prerequisites.sh
./blockchain/network/scripts/deploy.sh
npm --prefix blockchain/chaincode/yen-traceability ci
./blockchain/network/scripts/deploy-chaincode.sh
./blockchain/network/scripts/seed-demo.sh
```

Mạng có ba CA, ba peer, ba Raft orderer và channel `supplychannel`. Các thành
phần Fabric không publish cổng ra host; peer dùng Docker socket để khởi chạy
chaincode nên chỉ phù hợp lab cục bộ dùng một lần. Lệnh deploy chaincode mặc
định dùng version `1.0`, sequence `1` cho channel mới.

### 2. Chuẩn bị Gateway identity và chạy ứng dụng

Trên Windows PowerShell tại repository root:

```powershell
npm --prefix backend ci
npm --prefix backend run fabric:prepare
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
```

`fabric:prepare` đóng gói các identity/certificate đã enroll vào thư mục runtime
bị `.gitignore` loại trừ. Compose chạy migrations và seed demo users; dịch vụ
ứng dụng chỉ sẵn sàng khi PostgreSQL và Fabric Gateway đều kết nối được.
`PUBLIC_BASE_URL` mặc định là `http://localhost:3000`; đổi thành origin công
khai của ứng dụng khi cần tạo QR mở từ thiết bị khác.

Mở [http://localhost:3000](http://localhost:3000). Ví dụ tên đăng nhập:
`harvest.operator`, `processing.operator`, `quality.inspector`,
`distributor.operator`, `auditor`, `consumer`, `security.admin`. Dùng
`DEMO_USERS_PASSWORD` trong `.env`; mật khẩu không được hard-code trong frontend.

## Chạy kiểm thử

```powershell
npm --prefix backend test
npm --prefix blockchain/chaincode/yen-traceability test
docker compose config --quiet
```

Trang public trace dùng endpoint `/trace/<batch-id>`; ví dụ
`/trace/YEN-API-SMOKE-2026-01`. QR PNG được tạo cục bộ từ API, không gửi batch ID
qua dịch vụ bên thứ ba. Giao dịch thử đã ghi lên ledger được giữ lại; không reset
network nếu muốn bảo toàn demo hiện có.

## Vận hành và giới hạn

- `docker compose logs backend postgres` xem log ứng dụng.
- `docker compose down` dừng ứng dụng nhưng giữ các volume. Tránh `down -v` nếu
  cần giữ dữ liệu PostgreSQL hoặc tài liệu đã tải lên.
- Dừng Fabric bằng `./blockchain/network/scripts/down.sh`. Chỉ reset ledger
  theo xác nhận tường minh của script `reset-lab.sh`.
- Chaincode hiện đã commit trên lab đang chạy ở version `1.8`, sequence `9`.
  Khi nâng cấp channel này, dùng sequence kế tiếp, ví dụ:
  `CHAINCODE_VERSION=1.9 CHAINCODE_SEQUENCE=10 ./blockchain/network/scripts/deploy-chaincode.sh`.
- Security test suite AT-01–AT-14, VMware deployment guide và production
  hardening chưa hoàn tất; không xem lab hiện tại là môi trường production.
