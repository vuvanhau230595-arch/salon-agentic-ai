# Đưa Salon Agentic AI lên VPS

Mục tiêu: app chạy 24/7, có địa chỉ HTTPS, đăng bài đúng giờ kể cả khi tắt máy tính.
Mất khoảng 10–15 phút. Mật khẩu VPS **anh tự gõ** khi được hỏi — mình không cần và không nên biết.

## Trước khi làm — 3 việc

**1. Trỏ tên miền (DNS).** Tạo 1 bản ghi `A`:
- Tên: `agent` (ra `agent.theonehairsalon.vn`), giá trị: IP của VPS.
- Phải xong **trước** bước 2, nếu không Caddy chưa xin được chứng chỉ HTTPS (bản ghi có hiệu lực thì tự thử lại, không hỏng gì).

**2. Chọn VPS.** Tài liệu Salon POS ghi VPS `45.252.250.64` đang chạy POS thật. Dùng chung được vì app này nhẹ, nhưng:
- Script **chỉ thêm** 1 khối vào Caddyfile, **sao lưu bản cũ trước**, kiểm tra hợp lệ trước khi nạp, lỗi thì tự khôi phục. Không đụng vào Salon POS.
- Nếu muốn tách hẳn cho yên tâm → thuê VPS nhỏ riêng (cần Ubuntu + Node.js ≥ 22 + Caddy).

**3. VPS cần có:** Node.js từ v22 (Salon POS dùng Node 24 nên đã có), Caddy, quyền root qua SSH.

## Cài đặt (1 lệnh, trên máy Windows)

Mở PowerShell trong thư mục app rồi chạy:

```powershell
.\deploy\deploy.ps1 -Server 45.252.250.64 -Domain agent.theonehairsalon.vn
```

Script sẽ: đóng gói mã nguồn → gửi lên VPS → cài dịch vụ systemd (tự chạy lại khi lỗi hoặc khởi động lại máy) → thêm HTTPS vào Caddy → bật sao lưu mỗi ngày.

- **Không** gửi `data/`, `media/`, `.env` của máy Windows lên.
- Cuối cùng in ra **mật khẩu đăng nhập — chỉ hiện 1 lần**. Lưu vào trình quản lý mật khẩu (cũng xem lại được trong `/opt/salon-agentic-ai/.env`).

Mở `https://agent.theonehairsalon.vn`, đăng nhập (tên đăng nhập gõ gì cũng được, mật khẩu như trên).

## Nối Facebook và AI (trên VPS)

Token **chỉ để trên VPS**, không để trên máy Windows nữa:

```bash
ssh root@45.252.250.64
nano /opt/salon-agentic-ai/.env        # điền META_*, ANTHROPIC_API_KEY (xem HUONG-DAN-META.md)
systemctl restart salon-agentic-ai
```

Rồi vào **Cài đặt → 🔌 Kiểm tra kết nối Meta**. App mặc định vẫn ở chế độ **Chạy thử**, bỏ tick khi đã đối chiếu số liệu ổn.

> ⚠ **Đừng để hai nơi cùng chạy thật.** Nếu cả máy Windows và VPS đều có token và bỏ "Chạy thử", mỗi nơi có dữ liệu riêng và sẽ **đăng trùng bài**. Sau khi lên VPS: đóng `start.bat` trên Windows, hoặc xóa token trong `.env` của Windows.

## Ảnh và video

- **Cách đơn giản:** vào trang **Thư viện Media** trên web, kéo thả file (từ điện thoại cũng được). File nằm ở `/opt/salon-agentic-ai/media/<thương hiệu>/`.
- Caddy cho phép file tới ~1,1GB. Video lớn có thể bị Facebook từ chối (xem README).
- **Dùng Google Drive:** Drive for Desktop không có cho Linux; dùng `rclone` kéo thư mục Drive về `media/`. Ví dụ chạy mỗi 10 phút (anh tự `rclone config` đăng nhập Google, mình không làm thay):
  ```bash
  */10 * * * * salonagent rclone copy gdrive:Media /opt/salon-agentic-ai/media --max-age 30d
  ```
  Dùng `copy` (không phải `sync`) để rclone không bao giờ xóa file trên VPS. Thư mục Drive cần có thư mục con `the_one`, `dark_hair`, `mishang`.
- **`media/` không được sao lưu tự động** (nặng). Giữ bản gốc trên Drive/điện thoại.

## Việc thường gặp

| Việc | Lệnh (trên VPS) |
|---|---|
| Xem log | `journalctl -u salon-agentic-ai -f` |
| Khởi động lại | `systemctl restart salon-agentic-ai` |
| Trạng thái | `systemctl status salon-agentic-ai` |
| Kiểm tra sống | `curl http://127.0.0.1:3950/healthz` → `ok` |
| **Cập nhật phiên bản mới** | chạy lại `deploy.ps1` (giữ nguyên dữ liệu, `.env`, media) |
| Bản sao lưu dữ liệu | `/opt/salon-agentic-ai/backup/db-YYYYMMDD.json` (3h30 sáng, giữ 14 ngày) |
| Khôi phục sao lưu | `systemctl stop salon-agentic-ai && cp backup/db-AAAAMMDD.json data/db.json && chown salonagent:salonagent data/db.json && systemctl start salon-agentic-ai` |
| Đổi mật khẩu app | sửa `APP_PASSWORD` trong `.env` rồi `systemctl restart salon-agentic-ai` |
| Gỡ khối Caddy | khôi phục `/etc/caddy/Caddyfile.bak-…` rồi `systemctl reload caddy` |

## An toàn đã có sẵn

- App chỉ nghe `127.0.0.1`; ra internet qua Caddy (HTTPS). Không có mật khẩu thì **từ chối khởi động** nếu mở ra ngoài.
- Sai mật khẩu 5 lần trong 10 phút → khóa IP đó 10 phút.
- Chạy bằng tài khoản `salonagent` không đăng nhập được, chỉ ghi được vào `data/` và `media/`.
- `.env` chỉ root và `salonagent` đọc được.
- Đăng nhập ở trang `/login` (tên đăng nhập + mật khẩu), máy đó được nhớ 30 ngày bằng cookie; nút **Đăng xuất** ở Cài đặt → Tài khoản. Script/curl vẫn dùng được Basic Auth (`-u`). Mật khẩu chung = chủ hệ thống, ai biết đều thao tác được mọi thứ → đừng chia sẻ rộng, nên tạo tài khoản riêng.

## Nếu có lỗi

- **`deploy.ps1` báo thiếu tar/ssh/scp:** Windows → Cài đặt → Ứng dụng → Tính năng tùy chọn → thêm **OpenSSH Client**.
- **"VPS chưa cài Node.js" / "cần từ v22":** cập nhật Node trên VPS rồi chạy lại.
- **HTTPS không lên:** kiểm tra bản ghi DNS đã trỏ đúng IP chưa (`nslookup agent.theonehairsalon.vn`), rồi xem `journalctl -u caddy -n 50`.
- **Dịch vụ không chạy:** script in 30 dòng log cuối; gửi mình đoạn đó (đã che token, không chứa khóa).
