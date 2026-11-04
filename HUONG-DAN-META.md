# Nối Facebook thật — hướng dẫn từng bước

Làm 1 lần, khoảng 20 phút. **Token là chìa khóa vào tài khoản quảng cáo: chỉ để trong file `.env` trên máy/VPS của bạn, không gửi qua chat, không đưa lên GitHub** (file `.env` đã nằm trong `.gitignore`).

## Bạn cần lấy

| Thứ cần | Điền ở đâu | Lấy ở đâu |
|---|---|---|
| **Token truy cập** (`META_ACCESS_TOKEN`) | file `.env` | Bước 2 |
| **Page ID** của từng Fanpage | app → **Thương hiệu & Kênh** → ô "Page ID" (mỗi dòng 1 ID) | Cài đặt doanh nghiệp → Tài khoản → Trang → bấm tên Trang → dòng "ID" |
| **ID tài khoản quảng cáo** của từng thương hiệu | app → **Thương hiệu & Kênh** → ô "ID tài khoản quảng cáo" | Cài đặt doanh nghiệp → Tài khoản → Tài khoản quảng cáo → bấm tên → dòng "ID" |

**Mỗi thương hiệu đăng lên nhiều Page được:** thương hiệu The One có thể có 3–4 Page "The One Hair Salon…". Nhập hết Page ID vào ô của The One, mỗi bài sẽ đăng lên **tất cả** các Page đó. Nếu một Page lỗi, app chỉ thử lại Page đó (tối đa 3 lần), các Page đã đăng xong không bị đăng trùng.

**Facebook chỉ cho ứng dụng đăng lên Fanpage (Trang), không đăng được lên trang cá nhân.** Nếu một thương hiệu (ví dụ Mishang) đang dùng trang cá nhân thì cần tạo Fanpage rồi nhập Page ID. Cho đến lúc đó kênh Facebook của thương hiệu đó đang tắt.

**Token chỉ thấy tài sản trong doanh nghiệp của nó.** Nếu Page/tài khoản quảng cáo nằm ở nhiều doanh nghiệp khác nhau, cần chia sẻ quyền (Đối tác) cho doanh nghiệp chứa người dùng hệ thống, hoặc tạo token ở từng doanh nghiệp. Mỗi Page cần gán cho người dùng hệ thống với quyền quản lý.

**Quyền trên từng Page (Cài đặt doanh nghiệp → Tài khoản → Trang → chọn Page → người dùng hệ thống):** bật **Tạo nội dung** (đăng bài), **Kiểm duyệt** (trả lời bình luận) và **Tạo quảng cáo** (agent tạo quảng cáo từ bài/video của Page — cần cho "quảng cáo thử" và "video đang lên view"). Thiếu Tạo quảng cáo thì đề xuất vẫn hiện nhưng duyệt sẽ báo lỗi; trang **Kênh → Kiểm tra kết nối** cho biết Page nào đang thiếu quyền gì.

## Bước 1 — Tạo app Meta (chế độ Development là đủ)

1. Vào https://developers.facebook.com → **My Apps → Create App** → loại **Business**.
2. Gắn app vào **Business Portfolio** (Business Manager) đang sở hữu tài khoản quảng cáo và Page.
3. Thêm sản phẩm **Marketing API**.
4. App ở chế độ **Development** dùng được cho tài khoản/Page của chính bạn, **không cần App Review**.

## Bước 2 — Tạo token (khuyên dùng System User, token không hết hạn sau 60 ngày)

1. business.facebook.com → **Cài đặt doanh nghiệp → Người dùng → Người dùng hệ thống → Thêm** (vai trò **Admin**).
2. **Gán tài sản**: tài khoản quảng cáo (quyền *Quản lý chiến dịch*) và Fanpage (quyền *Toàn quyền kiểm soát*).
3. Bấm **Tạo token mới**, chọn app ở Bước 1, tick các quyền:
   - `ads_read`, `ads_management` — đọc số liệu, tắt chiến dịch, đổi ngân sách
   - `pages_show_list`, `pages_read_engagement` — đọc Page và bình luận
   - `pages_manage_posts` — đăng bài
   - `pages_manage_engagement` — trả lời bình luận
   - `pages_messaging` — **Trợ lý nhắn tin** đọc hộp thư Messenger của Page và trả lời khách (Page cũng phải cấp quyền *Nhắn tin* cho người dùng hệ thống ở Cài đặt doanh nghiệp → Trang)
4. Copy token vào `.env` ở `META_ACCESS_TOKEN`.

> Lưu ý Messenger: app Meta đang ở chế độ **Development** thì Facebook chỉ cho gửi tin tới người có vai trò trong app (admin/tester). Để trợ lý trả lời **khách thật**, app phải được Meta duyệt quyền `pages_messaging` (App Review) và chuyển sang **Live**. Trước đó, trợ lý vẫn đọc được tin và soạn sẵn câu trả lời ở mục Duyệt; lỗi gửi sẽ hiện trong Nhật ký.

## Bước 3 — Điền token và ID

Trong `.env`: `META_ACCESS_TOKEN=...`. Rồi chạy app, vào **Thương hiệu & Kênh** nhập Page ID và ID tài khoản quảng cáo cho từng thương hiệu.

## Bước 4 — Chạy lại app và kiểm tra

1. Tắt app rồi chạy lại (`start.bat`).
2. Vào **Cài đặt → 🔌 Kiểm tra kết nối Meta**. Nút này **chỉ đọc**, không đổi gì trên tài khoản. Mỗi thương hiệu có các dòng riêng cho từng Page và tài khoản quảng cáo, đều phải hiện **OK**.
3. Nếu có dòng **Lưu ý**:
   - *đơn vị tiền không phải VND* → chỉnh lại các số trong luật ở trang Quảng cáo (đang tính bằng VND);
   - *thiếu quyền* → tạo lại token với đủ quyền ở Bước 2.

## Bước 5 — Chạy thử vài ngày trước khi chạy thật

App **mặc định ở chế độ "Chạy thử"**: đọc số liệu thật nhưng **không tắt, không đổi ngân sách, không đăng bài**; chỉ ghi nhật ký "đáng lẽ sẽ làm gì". Hãy:

1. Để Chạy thử 2–3 ngày, so sánh nhật ký với Ads Manager xem số tiêu và số tin nhắn có khớp không.
2. Thấy ổn → Cài đặt → bỏ tick **Chạy thử** để agent tự tắt chiến dịch xấu thật.
3. Tăng ngân sách, đăng bài, trả lời bình luận **luôn chờ bạn duyệt**.

## Lưu ý

- **Tin nhắn** được tính từ hành động `onsite_conversion.messaging_conversation_started_7d` (chiến dịch mục tiêu Tin nhắn). Chiến dịch mục tiêu khác sẽ luôn ra 0 tin nhắn và có thể bị luật "tiêu tiền mà 0 tin nhắn" tắt nhầm → dùng luật này khi chiến dịch của bạn đều là mục tiêu Tin nhắn.
- **Đổi ngân sách** chỉ áp dụng chiến dịch đặt ngân sách ở cấp chiến dịch (CBO). Chiến dịch đặt ngân sách ở cấp nhóm quảng cáo sẽ không được đề xuất tăng.
- **"Hôm nay"** theo múi giờ của tài khoản quảng cáo.
- **Phiên bản API**: mặc định `v26.0`. Meta ngừng hỗ trợ phiên bản cũ sau vài tháng; nếu thấy lỗi lạ sau một thời gian, đặt `META_API_VERSION=` phiên bản mới trong `.env`.
- Token hết hạn/thu hồi sẽ hiện lỗi "Token hết hạn…" trong Nhật ký và trang Agent & Tác vụ.
- Instagram, TikTok, Google Ads, Zalo OA: chưa nối (đang ở chế độ mẫu).
