# YouTube Shorts — hướng dẫn

Agent Nội dung tải video (YouTube Shorts) lên **kênh YouTube của từng thương hiệu** bằng YouTube Data API v3. Mỗi thương hiệu nối **1 kênh**.

> Giao diện Google Cloud hay đổi tên mục. Nếu tên mục khác hướng dẫn thì làm theo ý nghĩa, chụp màn hình gửi mình nếu bí.

## 1. Những gì app đã làm sẵn

- Đăng nhập Google (OAuth 2.0) cho từng thương hiệu: nút **Kết nối YouTube** ở trang **Kênh**.
- Tải video (mp4, mov, webm) từ Thư viện Media bằng kiểu tải **resumable** (đứt mạng thì tải tiếp phần còn thiếu).
- Tiêu đề lấy **dòng đầu của chú thích**, bỏ emoji và hashtag, tối đa 100 ký tự, còn chỗ thì thêm `#Shorts`. Mô tả là cả chú thích (tối đa 5000 byte). Danh mục **Howto & Style**, đánh dấu **không dành cho trẻ em**.
- Chế độ hiển thị chọn ở **Cài đặt → Kết nối API → YouTube** (mặc định **Công khai**).
- Token và Client secret lưu **riêng** trong `data/secrets.json` (quyền 0600), không có trong bản sao lưu, không hiện trên giao diện, không ghi ra nhật ký.

## 2. Tạo dự án Google Cloud và bật YouTube Data API v3 (~5 phút)

1. Vào **https://console.cloud.google.com** → đăng nhập → ô chọn dự án trên cùng → **New Project** → tên ví dụ `Salon Agent` → **Create**.
2. Chọn đúng dự án vừa tạo → **APIs & Services → Library** → tìm **YouTube Data API v3** → **Enable**.
   Nếu quên bước này, lúc kết nối hoặc đăng app sẽ báo *"Dự án Google Cloud chưa bật YouTube Data API v3"*.

## 3. Màn hình đồng ý OAuth (OAuth consent screen)

1. **APIs & Services → OAuth consent screen** (có nơi gọi là **Google Auth Platform → Branding / Audience**).
2. **User type:** chọn **External** → điền:
   - **App name:** `Salon Agent`
   - **User support email** và **Developer contact:** email của anh.
   - **App home page:** `https://agent.theonehairsalon.vn`
   - **Privacy policy:** `https://agent.theonehairsalon.vn/privacy` · **Terms of service:** `https://agent.theonehairsalon.vn/terms` (2 trang này app đã có sẵn, mở được không cần đăng nhập).
3. **Scopes (Data access):** thêm 2 quyền:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
4. **Test users (Audience):** thêm **`vuvanhau230595@gmail.com`**, tài khoản sở hữu kênh **"THE ONE HAIR SALON"**. Kênh của thương hiệu khác thuộc tài khoản Google khác thì thêm cả tài khoản đó.
5. **Quan trọng: chuyển sang Production.** Khi ứng dụng còn ở chế độ **Testing**, refresh token Google cấp **chỉ sống 7 ngày**. Sau 7 ngày app sẽ báo *"Cần kết nối lại"*. Vào **Audience → Publishing status → Publish app** để chuyển sang **In production**.
   - Ứng dụng dùng quyền YouTube nên Google có thể yêu cầu **xác minh ứng dụng (verification)**. Khi chưa xác minh, lúc đăng nhập sẽ có màn hình *"Google hasn't verified this app"*: bấm **Advanced → Go to Salon Agent (unsafe)**. Công cụ nội bộ, ít người dùng thì vẫn dùng được như vậy.

## 4. Tạo OAuth client loại Web application

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. **Application type:** **Web application**, tên ví dụ `Salon Agent Web`.
3. **Authorized redirect URIs** → **Add URI** → dán **đúng y như sau** (app cũng hiện địa chỉ này ở Cài đặt → Kết nối API → YouTube, có nút Sao chép):
   ```
   https://agent.theonehairsalon.vn/api/youtube/callback
   ```
   Địa chỉ được ghép từ `PUBLIC_BASE_URL` trên VPS + `/api/youtube/callback`. Sai 1 ký tự (thiếu `s` ở https, thừa `/` cuối) thì Google báo **redirect_uri_mismatch**.
4. **Create** → Google hiện **Client ID** (đuôi `.apps.googleusercontent.com`) và **Client secret** (bắt đầu `GOCSPX-`). **Client secret là bí mật**, không gửi qua chat.

## 5. Dán khoá vào app và kết nối kênh

1. Vào app → **Cài đặt → Kết nối API → YouTube (Shorts)** → dán **Client ID** và **Client secret** → **Lưu khoá**. (Hoặc đặt `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` trong `.env` trên VPS bằng `deploy\set-secret.ps1`; khoá trong `.env` được ưu tiên.)
2. Chọn **Chế độ hiển thị** video (mặc định Công khai).
3. Vào trang **Kênh** → dòng **YouTube** của thương hiệu → **Kết nối YouTube** → chọn tài khoản `vuvanhau230595@gmail.com` → chọn kênh **THE ONE HAIR SALON** (nếu Google hỏi kênh) → tick **đủ các quyền** → **Continue**.
4. App quay về trang Kênh, dòng YouTube hiện tên kênh. Bấm **⟳ Kiểm tra kết nối** để kiểm tra thật (chỉ đọc).
5. **Thương hiệu & Kênh** → bật (tick **Dùng**) kênh YouTube cho thương hiệu. Tạo bài/kế hoạch kênh **YouTube** (mỗi bài **đúng 1 video**, nên dọc 9:16, dưới 3 phút để thành Shorts), duyệt, tắt "Chạy thử" rồi chạy Agent Nội dung.

## 6. Kiểm tra (audit) YouTube API — gỡ khoá riêng tư

- **Dự án Google Cloud chưa qua kiểm tra (audit) của YouTube API thì MỌI video tải lên bằng API bị khoá ở chế độ riêng tư**, dù app chọn Công khai. Video vẫn lên kênh nhưng chỉ chủ kênh thấy; trong YouTube Studio sẽ ghi bị hạn chế.
- Nộp đơn audit tại: **https://support.google.com/youtube/contact/yt_api_form** (chọn mục kiểm tra/audit cho dự án API).
- Thường cần: Project number của dự án Google Cloud, mô tả công cụ (*"Internal tool of our hair salon group to upload our own short videos to our own YouTube channels"*), địa chỉ app, trang Privacy/Terms, đôi khi video quay màn hình quy trình (kết nối → soạn → duyệt → đăng).
- Thời gian xét duyệt: Google không cam kết, thường vài ngày tới vài tuần. Sau khi được duyệt, video **tải lên sau đó** mới công khai được; video cũ bị khoá thì vào YouTube Studio đổi lại.

## 7. Giới hạn cần biết

- **Hạn mức:** mỗi dự án mặc định **10.000 đơn vị/ngày**, mỗi video tải lên tốn khoảng **1.600 đơn vị** → khoảng **6 video/ngày** cho **tất cả** thương hiệu dùng chung dự án. Hết hạn mức app báo *quotaExceeded*, giữ bài lại và thử lại ở lần quét sau (không tính là lỗi). Hạn mức đặt lại lúc 0h giờ Thái Bình Dương (khoảng 14–15h giờ Việt Nam). Cần nhiều hơn thì xin tăng hạn mức qua form ở mục 6.
- **uploadLimitExceeded:** giới hạn riêng của kênh (số video/ngày), không phải hạn mức API. Chờ khoảng 24 giờ. Kênh nên **xác minh số điện thoại** (youtube.com/verify).
- **invalid_grant / "Cần kết nối lại":** quyền bị thu hồi, đổi mật khẩu Google, hoặc ứng dụng còn ở chế độ Testing (7 ngày). Bấm **Kết nối YouTube** lại ở trang Kênh.
- **Ngắt kết nối:** nút **Ngắt kết nối** ở trang Kênh, app thu hồi quyền ở Google và xoá token khỏi VPS. Video đã đăng vẫn còn.
- Chỉ đăng **video**, chưa hỗ trợ bài cộng đồng/ảnh.
