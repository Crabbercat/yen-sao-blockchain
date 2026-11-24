# Tiến độ triển khai

## Trạng thái hiện tại

- Đặc tả áp dụng: `SPEC.md` phiên bản 1.0.0; đã đọc toàn bộ 1.797 dòng trước khi chỉnh sửa.
- Nhánh: `main`; commit nền: `87dd452` (`Initial project skeleton`).
- Trạng thái hiện tại: Phase 0–4 đạt exit criteria; Phase 5 chưa đạt exit criteria; Phase 6 đã có implementation nhưng chưa chốt; Phase 7 đang kiểm thử dở dang; Phase 8 chưa bắt đầu. Không coi các phase sau là đạt khi phase trước còn thiếu exit criteria.
- Không thay đổi cấu trúc thư mục cấp cao. Fabric là ledger bắt buộc; không dùng PostgreSQL hoặc in-memory để thay thế.

## Kết quả khảo sát Phase 0

| Hạng mục | Hiện trạng |
|---|---|
| Cấu trúc cấp cao | Đã có `backend/`, `blockchain/`, `database/`, `docs/`, `frontend/`, `tests/`. |
| Tài liệu | `SPEC.md` có nội dung; `README.md` rỗng. Các tài liệu kiến trúc, triển khai và bảo mật được yêu cầu chưa có. |
| Backend/frontend | `backend/package.json`, `frontend/package.json` và các thư mục mã nguồn chỉ là tệp rỗng/`.gitkeep`; chưa có Express, trang frontend, Dockerfile, test hay cấu hình khởi chạy. |
| Chaincode | Có đường dẫn `blockchain/chaincode/yen-traceability/`, nhưng tất cả tệp `.js` và `package.json` đều rỗng. Chưa có package `yen-sao-contract`, network, identity, channel hay Fabric scripts. |
| Compose/database | Chưa có `docker-compose.yml`, cấu hình PostgreSQL, migration, seed hoặc health check. |
| Kiểm thử | Chưa có test thực thi; các thư mục kiểm thử chỉ chứa `.gitkeep`. |
| Secrets/config | Có `.gitignore` cơ bản, chưa có `.env.example`; chưa thấy `.env` hay crypto material đã tạo. `SPEC.md` hiện là tệp untracked có sẵn trong worktree và được giữ nguyên. |
| Môi trường kiểm tra | Windows 10.0.26300, PowerShell 5.1; Node.js v24.21.0, npm 12.2.2, Docker Engine 29.7.2, Compose v5.5.1; WSL2 đã bật. Docker daemon trả về phiên bản thành công. |
| Lệnh kiểm tra ban đầu | `npm --prefix backend ls --depth=0`, `npm --prefix frontend ls --depth=0` và lệnh tương ứng cho chaincode đều thất bại với `EJSONPARSE` vì `package.json` rỗng; đây là hiện trạng ban đầu, không phải lỗi do thay đổi. |

### Đánh giá kiến trúc và khoảng trống

- Các yêu cầu sản phẩm, mô hình ba tổ chức Fabric, lifecycle, authorization, PDC, REST API và các test AT-01–AT-14 đã được đối chiếu trong `SPEC.md`; chưa có phần nào được chứng minh là đã triển khai.
- Giai đoạn đầu giữ nguyên modular monolith Node.js/Express, frontend HTML/CSS/Vanilla JS được Express phục vụ, PostgreSQL cho dữ liệu ứng dụng và Fabric thật cho traceability.
- Phase 1 chỉ kiểm tra readiness của backend và PostgreSQL vì Fabric thuộc Phase 2; trạng thái này không được diễn giải là Fabric sẵn sàng.
- Ưu tiên các đường dẫn/nội dung hiện có; các tệp chaincode rỗng được ghi nhận nhưng không đổi semantics hay thay kiến trúc trong Phase 1.

### Rủi ro kỹ thuật cần theo dõi

1. **Cao — peer Docker socket:** Fabric peers có quyền điều khiển Docker Engine để chạy chaincode containers; chỉ dùng lab cục bộ dùng một lần, không coi là hardening production.
2. **Trung bình — khác biệt Windows/WSL2:** các script Fabric dựa trên Bash và đường dẫn Linux; Git Bash trên Windows không chạy trực tiếp được với cách truyền đường dẫn Docker hiện tại. Quy trình deploy được kiểm tra bằng các lệnh Docker tương đương từ PowerShell.
3. **Trung bình — security test chưa có:** AT-01–AT-14, allowlist và evidence report thuộc Phase 6.

## Checklist Phase 0–8

| Phase | Checklist / đối chiếu SPEC | Trạng thái |
|---|---|---|
| 0 — Khảo sát repository | [x] Đọc toàn bộ SPEC và README; [x] kiểm kê cấu trúc/tệp; [x] xác minh OS, Node, Docker/Compose/WSL; [x] xác định khoảng trống/rủi ro; [x] liệt kê thay đổi dự kiến bên dưới. | **Đạt exit criteria** |
| 1 — Skeleton và Docker | [x] Compose + PostgreSQL 16 persistent volume; [x] Express health/ready; [x] phục vụ trang static; [x] Dockerfile; [x] `.env.example`, `.gitignore`, health checks; [x] kiểm tra config, khởi chạy services và HTTP thực tế. | **Đạt exit criteria** |
| 2 — Fabric network | [x] Pin Fabric 2.5.16/Fabric CA 1.5.17; [x] ba CA, peers, ba Raft orderers; [x] TLS, `supplychannel`, scripts; [x] kiểm tra join, health và tính bền dữ liệu sau restart. | **Đạt exit criteria** |
| 3 — Chaincode | [x] Package Node.js tương thích Fabric 2.5; [x] lifecycle/identity/role/idempotency/history/lineage; [x] PDC, transient input và endorsement policy; [x] unit và integration tests trên Fabric thật. | **Đạt exit criteria** |
| 4 — Backend | [x] PostgreSQL migrations/seed; [x] login/RBAC/identity resolver/Gateway; [x] REST API, upload/hash; [x] validation, logging, rate-limit và integration tests. | **Đạt exit criteria** |
| 5 — Frontend | [x] Login/dashboard và lifecycle forms đã có; [x] public trace/QR; [ ] kiểm thử trọn lifecycle bằng UI đã xác thực; [x] security dashboard Phase 6 đã tích hợp. | **Chưa đạt exit criteria** |
| 6 — Security test suite | [x] AT-01–AT-14, allowlist/loopback, dashboard và JSON/Markdown evidence đã có; [x] profile baseline/hardened được mô tả; [ ] hoàn tất đánh giá các test cần điều kiện riêng và độ tin cậy lưu/đọc report. | **Đã triển khai; chưa chốt** |
| 7 — Hardening/regression | [x] App/chaincode/security unit tests chạy lại; [x] backend image scan; [x] ports/readiness kiểm tra; [ ] config scan hoàn tất; [ ] quét đầy đủ các image trong lab; [ ] persistence/reset và acceptance review. | **Đang kiểm thử; chưa đạt exit criteria** |
| 8 — VMware preparation | [ ] Tài liệu topology/IP/DNS/port/TLS SAN; [ ] cấu hình endpoint/profile cho remote peers; [ ] migration checklist; [ ] giữ Docker làm baseline. | **Chưa bắt đầu** |

## Kế hoạch thay đổi theo phase

### Phase 0 — Hoàn tất

- Tạo tài liệu này để lưu hiện trạng, checklist Phase 0–8, khoảng trống và rủi ro.
- Không xóa hay thay đổi các tệp hiện có. Không sửa `SPEC.md`.

### Phase 1 — Hoàn tất

- Tạo `docker-compose.yml`, PostgreSQL 16.16 persistent volume, backend Dockerfile, Express app/server, trang static tối thiểu, `.env.example`, `.dockerignore` và init SQL.
- Tách `yen_sao_admin` (bootstrap/admin) khỏi `yen_sao_app` (không superuser); không publish cổng PostgreSQL. Backend chỉ bind cổng host trên `127.0.0.1`.
- Khởi tạo `backend/package.json` cùng lockfile; cập nhật `.gitignore` cho `.env`, storage và crypto material sinh ra.
- Thêm bốn Node.js tests cho health, readiness thành công/lỗi và static frontend; cập nhật README với lệnh PowerShell đã thử.
- Xác minh cấu hình, build/khởi chạy stack, HTTP endpoints, quyền DB runtime và persistence khi restart; **Phase 1 đạt exit criteria**.

### Phase 2 — Hoàn tất

- **Tệp thay đổi:** `blockchain/network/compose/docker-compose.yml`, `blockchain/network/config/crypto-config.yaml`, `blockchain/network/config/configtx.yaml`, `blockchain/network/config/core.yaml`, `blockchain/network/scripts/`, `blockchain/network/README.md`, `.gitignore`, `README.md`.
- **Mạng thực:** Fabric peer/orderer `2.5.16`, Fabric CA `1.5.17`; ba CA, ba peers, ba Raft orderers, TLS, LevelDB và channel `supplychannel`. Không publish cổng Fabric ra host.
- **Identities:** ba CA bootstrap/admin và bốn application identities được CA enroll; node MSP/TLS và organization admin MSP do `cryptogen` tạo. CA roots được thêm vào organization MSP.
- **Kiểm thử cấu hình:** `docker compose config --quiet` — PASS; `bash -n` cho scripts — PASS.
- **Kiểm thử runtime:** các CA, peers và orderers đều healthy; `configtxgen` tạo channel block; ba orderer trả `201` và trạng thái `active`/height `1`; ba peer báo join thành công; `health-check.sh` xác nhận mọi participant ở `supplychannel`.
- **Persistence:** restart toàn bộ Fabric services, đợi lại health checks và chạy lại `health-check.sh`; các CA, peers, orderers healthy và toàn bộ channel participation vẫn tồn tại.
- **Khắc phục trong phase:** sửa bind paths để resolve trong repo; bổ sung BCCSP/VM/system-chaincode settings; dùng organization admin MSP để join peer; chạy `osnadmin` từ pinned tools image thay vì orderer image. Chỉ xóa hai thư mục bind sai do lần chạy này tạo ngoài repo; giữ nguyên thư mục cha và `desktop.ini`.
- **Known limitation:** peer container mount Docker Engine socket để Fabric chạy chaincode containers; chỉ phù hợp disposable local lab. Chưa có chaincode nghiệp vụ, do đó chưa có giao dịch traceability hoặc kiểm thử endorsement/PDC.
- **Exit criteria:** topology/TLS/channel/joins/health và restart persistence đã được thực thi trên Fabric thật; **Phase 2 đạt**.

### Cổng phase

- Phase 5 chưa đạt: luồng tra cứu/QR đã kiểm chứng, nhưng chưa có bằng chứng hiện tại cho toàn bộ lifecycle tương tác trên trình duyệt từ khai thác đến phân phối.
- Một phần implementation và kiểm thử Phase 6–7 đã được thực hiện ở các lượt trước khi Phase 5 được đóng. Ghi nhận đây là công việc dở dang, không phải chấp thuận bỏ qua cổng phase.
- Không triển khai Phase 8 cho tới khi các exit criteria theo thứ tự trong SPEC được xác minh. VMware vẫn là mục tiêu chuẩn bị; Docker Compose là baseline hiện hành.

## Nhật ký thực thi

### Phase 0

- **Tệp thay đổi:** `docs/implementation-status.md`.
- **Lệnh đã chạy:** kiểm kê file bằng PowerShell; `node --version`; `npm --version`; `docker --version`; `docker compose version`; `docker info --format '{{.ServerVersion}}'`; `wsl --status`; `git --no-pager status --short --branch`; các lệnh `npm --prefix ... ls --depth=0`.
- **Kết quả:** kiểm kê và xác minh runtime thành công; Docker daemon hoạt động; các truy vấn npm ban đầu lỗi do manifest rỗng.
- **Known issues:** ứng dụng, database, Fabric và test chưa được dựng; README rỗng.
- **Exit criteria:** repository state và kế hoạch thay đổi đã được ghi nhận; **Phase 0 đạt**.

### Phase 1

- **Tệp thay đổi:** `.dockerignore`, `.gitignore`, `.env.example`, `docker-compose.yml`, `README.md`, `backend/Dockerfile`, `backend/package.json`, `backend/package-lock.json`, `backend/src/app.js`, `backend/src/server.js`, `backend/test/app.test.js`, `database/init/01-create-app-user.sql`, `frontend/public/index.html`.
- **Kiểm thử:** `npm --prefix backend install --no-audit --no-fund` thành công; `npm --prefix backend test` — 4/4 PASS; `docker compose config --quiet` — PASS.
- **Kiểm thử thực tế:** `docker compose up -d --force-recreate --build --wait --wait-timeout 180` — PostgreSQL và backend healthy. `GET /health` trả `200 {"status":"ok"}`; `GET /ready` trả `200` với DB `ready`; `GET /` trả HTTP 200 và HTML.
- **Least privilege:** truy vấn trong PostgreSQL xác nhận `yen_sao_app:false` (`rolsuper=false`). PostgreSQL không publish port lên host; backend chỉ publish `127.0.0.1:3000`.
- **Persistence:** tạo một bảng/hàng kiểm tra qua role app, restart PostgreSQL, đọc lại đúng một hàng, rồi xóa bảng kiểm tra. Volume dữ liệu chính được giữ nguyên.
- **Init path:** dựng một Compose project/volume tạm mới; xác nhận init SQL tạo được app role không-superuser và các endpoint hoạt động; đã xóa riêng project/volume tạm sau khi kiểm tra.
- **Khắc phục trong phase:** lần probe đầu phát hiện `internal: true` làm host không truy cập được cổng đã publish; đã bỏ cờ này, giữ bridge riêng và bind localhost. Windows PowerShell cần `Invoke-WebRequest -UseBasicParsing` để tránh prompt không tương thích non-interactive.
- **Known issues:** Fabric chưa có nên `/ready` hiện chỉ xác minh PostgreSQL; chưa có migration/schema nghiệp vụ, API domain, authentication, demo users hoặc dữ liệu Fabric. Đây là phạm vi Phase 2–4, không phải tuyên bố hệ thống hoàn chỉnh.
- **Môi trường dev cục bộ:** `.env` với hai mật khẩu ngẫu nhiên đã được tạo để chạy stack; tệp bị `.gitignore` loại trừ, không được commit. Các container hiện đang chạy; `docker compose down` giữ volume.
- **Exit criteria:** `docker compose config`, PostgreSQL/backend healthy, `/health`, `/ready`, frontend load và volume persistence đã được thực thi thành công; **Phase 1 đạt**.

### Phase 3

- **Tệp cập nhật:** `blockchain/chaincode/yen-traceability/lib/traceability-contract.js`, `blockchain/chaincode/yen-traceability/test/contract.test.js`, `blockchain/network/config/core.yaml`, `blockchain/network/scripts/seed-demo.sh`, `blockchain/network/scripts/test-chaincode.sh`.
- **Chaincode:** chuyển đổi timestamp từ protobuf `getSeconds()`/`getNanos()`; truyền commercial terms bằng transient data, từ chối các trường riêng tư trong Args công khai; xác thực idempotency dựa trên nội dung private đã chuẩn hóa.
- **Network/PDC:** cấu hình `peer.gossip.pvtData.pushAckTimeout: 3s` cùng thời hạn pull/reconciliation; restart ba peers; xác nhận peer healthy và PDC dissemination thành công.
- **Lifecycle thật:** deploy `yen-sao-contract` version `1.5`, sequence `6`; ba tổ chức approve; `querycommitted` xác nhận definition và collection policy.
- **Demo thật:** harvest `YEN-2026-0001`, handover/accept, processing, derived batch `YEN-2026-0001-A`, QC, package, private commercial terms, shipment, acceptance và distribution; transaction được commit trên `supplychannel`.
- **Kiểm thử:** chaincode unit tests 4/4 PASS; `bash -n` scripts và cả hai Compose configurations PASS. Trên Fabric thật: trace/history/lineage đúng; PDC member đọc được; OrgDistribution bị từ chối; public trace không chứa private terms; unauthorized harvest, quantity vượt mức, invalid state và proposal chỉ có một endorser đều không ghi trạng thái.
- **Khắc phục:** nguyên nhân timestamp là protobuf Timestamp dùng accessor methods. PDC dissemination ban đầu thất bại do `pushAckTimeout` không được cấu hình; bổ sung timeout đã giải quyết. Một lần đóng gói thủ công đưa library vào thư mục lồng; đã xóa staging riêng, dựng package sạch và xác minh code đang chạy trong container trước khi chốt sequence 6.
- **Môi trường:** Docker CLI từ PowerShell dùng bind mount an toàn cho đường dẫn Windows có dấu cách. WSL Docker integration hiện không khả dụng, do đó các lệnh Fabric đã được thực thi qua cùng pinned Fabric tools/runtime images trực tiếp; chưa xác nhận chạy nguyên văn các Bash wrapper từ WSL trên máy này.
- **Exit criteria:** chaincode lifecycle, transaction flow, privacy, authorization, history/lineage và endorsement đã được thực thi trên Fabric thật; **Phase 3 đạt**.

### Phase 4

- **Backend:** Express API kết nối PostgreSQL và ba peer Fabric Gateway; readiness chỉ trả `ready` khi cả DB và Fabric hoạt động. Migrations tạo schema phiên, người dùng, audit và metadata tài liệu; seed tài khoản demo chỉ chạy ngoài production.
- **Bảo vệ:** opaque bearer sessions với token hash trong DB, role checks, validation Zod, Helmet, rate limiting, structured errors/audit; organization và chaincode authorization tiếp tục được xác minh bởi Fabric, không dựa riêng vào role UI.
- **Nghiệp vụ:** harvest, handover/accept, processing, derived batch, quality, packaging, shipment/accept/distribution, history, lineage, public trace và PDC private terms qua transient data. Không ghi các terms riêng tư vào public transaction arguments.
- **Tài liệu:** MIME và magic-byte checks, giới hạn 10 MiB, tệp lưu ngoài DB trên persistent volume, SHA-256 metadata và xác minh với Fabric.
- **Kiểm thử:** backend 14/14 và chaincode 4/4 PASS. Qua API kết nối stack đang chạy, cả bốn role đã hoàn tất lifecycle thật từ lô khai thác tới `DISTRIBUTED`; public trace không trả private commercial terms. Một tệp PDF demo đã tải lên, sau đó hash được neo trong quality/package transaction và API xác nhận `matchesUploadMetadata=true`, `verifiedOnLedger=true`.
- **Khắc phục:** thử upload thật phát hiện volume uploads mới là root-owned và backend chạy non-root. Thêm bước startup giới hạn chỉ sửa owner volume uploads cho UID backend, giữ nguyên dữ liệu; xác nhận backend ghi/xóa được probe và upload thật thành công. Phát hiện API distribution kiểm tra field nội bộ không được chaincode public GetBatch trả về; thêm query `GetShipment` và ràng buộc chaincode `RecordDistribution` với shipment đã được chấp nhận, deploy chaincode v1.8 sequence 9 sau khi cả ba tổ chức approve.
- **Compose/build:** `docker compose config --quiet` PASS; `docker compose up -d --build --wait --wait-timeout 180` PASS; image install audit báo 0 vulnerabilities.
- **Exit criteria:** backend hoàn tất workflow qua Fabric thật; quyền role/organization và upload/hash được kiểm tra; **Phase 4 đạt**.

### Phase 5 — chưa đạt exit criteria

- **Tệp:** `frontend/public/index.html`, `styles.css`, `app.js`; endpoint QR PNG và public route `/trace/:batchId`; `PUBLIC_BASE_URL` để sinh link phù hợp deployment.
- **Giao diện:** responsive login, trạng thái readiness, dashboard/statistics, batch search/filter/detail/history/lineage, form lifecycle theo role, document upload/verify, public trace và tải QR. Token chỉ ở bộ nhớ trang; dữ liệu ledger được tạo bằng DOM `textContent`, không dùng `innerHTML`.
- **Kiểm thử đã chạy:** phiên trước ghi nhận đăng nhập, tạo lô harvest, dashboard, public trace và QR qua browser; backend/chaincode đã hoàn tất lifecycle qua API. Trong lần xác minh mới nhất, `YEN-API-SMOKE-2026-01` được tra cứu công khai trên Fabric, trạng thái `HARVESTED`, history và ảnh QR hiện trên UI. Browser vẫn ở màn hình đăng nhập, do đó chưa xác nhận được một phiên đăng nhập hiện hành hoặc lifecycle trọn vẹn qua UI.
- **Còn thiếu để đạt:** chạy đầy đủ các form lifecycle có phiên đã xác thực từ harvest tới distribution và kiểm chứng consumer mở QR. Lịch sử trước chỉ chứng minh các bước UI rời rạc và full lifecycle qua API; không thay thế tiêu chí browser trong SPEC.
- **Kết luận:** chưa đánh dấu Phase 5 đạt.

### Phase 6 — đã triển khai, chưa chốt

- Có catalog AT-01–AT-14, allowlist ID, API dashboard chỉ dành cho `security_admin`, target giới hạn loopback, báo cáo JSON/Markdown và evidence đã lọc dữ liệu nhạy cảm.
- **Kiểm thử hiện tại:** backend 19/19, chaincode 4/4, security runner unit 9/9 PASS. Runtime retest trước đó xác nhận AT-01 (chỉ cổng 3000 trong backend container), AT-05 (Fabric trả HTTP 404 `NOT_FOUND`) và AT-10 (Gateway/TLS readiness) PASS.
- AT-07/11/12 chưa có bằng chứng PASS: cần workspace kiểm tra endorsement cô lập, scanner offline được phê duyệt hoặc workload profile được phê duyệt. Các trạng thái `ERROR`/chưa chạy phải tiếp tục được giữ nguyên, không đổi thành PASS.
- **Open issue:** runner hiện nuốt lỗi bất đồng bộ khi hoàn tất/ghi report và biến một số lỗi đọc/JSON report thành “không tồn tại” hoặc danh sách rỗng. Cần xử lý và thêm test hồi quy trước khi chốt độ tin cậy của dashboard.

### Phase 7 — đang kiểm thử, chưa đạt exit criteria

- **Kiểm thử:** backend 19/19, chaincode 4/4, security unit 9/9 PASS; `npm audit --omit=dev` báo 0 vulnerabilities; `docker compose config --quiet` PASS.
- **Runtime:** `/health` trả `ok`; `/ready` xác nhận PostgreSQL và Fabric ready. Docker xác nhận backend chỉ publish `127.0.0.1:3000`; PostgreSQL, peers, orderers và CA chỉ có cổng nội bộ container. Lệnh readiness AT-10 kiểm tra kết nối Gateway dùng TLS roots.
- **Image scan:** Trivy 0.76.2 quét archive của backend image và không tìm thấy vulnerability trong Alpine OS packages hoặc Node packages. Đây chỉ là backend image, không đại diện cho tất cả image Fabric/PostgreSQL/helper.
- **Config scan:** Trivy filesystem/config scan kết thúc lỗi `context deadline exceeded`; không tạo report hợp lệ. Không được diễn giải lỗi này là scan sạch. Chưa quét đầy đủ toàn bộ image lab và chưa hoàn tất kiểm tra procedure persistence/reset sau thay đổi hardening.
- **Kết luận:** giữ trạng thái đang kiểm thử; chưa đạt exit criteria Phase 7.

### Phase 8 — chưa bắt đầu

- Chưa có guide VMware, port matrix, migration checklist hoặc cấu hình endpoint/profile dành cho peer từ xa.
- Nghiên cứu topology 6 VM trước đó là ghi chú, chưa được hiện thực thành tài liệu triển khai và chưa thử nghiệm multi-VM.
