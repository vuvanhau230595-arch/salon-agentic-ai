# TikTok — hướng dẫn

App có **hai cách** đăng TikTok. Chọn ở **Cài đặt → TikTok → Cách đăng TikTok**.

## Cách 1 (mặc định, dùng ngay): Gói đăng thủ công

**Không cần đăng ký ứng dụng TikTok, không cần chờ duyệt, không cần khóa nào.**

Agent làm phần nặng: soạn kế hoạch, chú thích + hashtag, chọn video từ Thư viện Media. Anh chỉ làm phần cuối trên TikTok Studio, khoảng 1 phút mỗi video.

**Chuẩn bị (1 lần):**
1. **Thương hiệu & Kênh** → bật kênh **TikTok** cho thương hiệu, ghi tên tài khoản TikTok vào ô "Tên / ID công khai" (ví dụ `@darkhair.vn`, để nhớ đăng đúng tài khoản).
2. Bỏ video (dọc 9:16 là tốt nhất; mp4, mov, webm) vào **Thư viện Media** của thương hiệu.

**Mỗi video:**
1. **Kế hoạch tháng** → chọn kênh TikTok → "AI soạn cả tháng". Mỗi bài tự gắn 1 video, anh xem/sửa chú thích rồi **Duyệt**.
2. Vào **Lịch đăng** → bấm **📦 Gói đăng** ở bài cần đăng. Gói gồm: chú thích (có nút sao chép), video (nút **Tải video về máy**), giờ hẹn theo giờ Việt Nam, các cảnh báo, và 6 bước.
3. Mở **TikTok Studio** (https://www.tiktok.com/tiktokstudio/upload) đăng nhập đúng tài khoản → kéo video vào → dán chú thích → bật **Lên lịch** đặt đúng giờ → đăng.
4. Quay lại app bấm **Đã hẹn giờ trên TikTok** (hoặc **Đã đăng**, có thể dán link bài). Bấm nhầm thì **Hoàn tác**.

**Lưu ý:**
- Đến giờ hẹn mà anh chưa đánh dấu, bài chuyển sang **"Đến giờ — chờ đăng tay"** và hiện trong Nhật ký để nhắc.
- Mỗi bài TikTok cần **đúng 1 video**, không duyệt được bài thiếu video. Chú thích tối đa 2200 ký tự.
- Nếu video làm bằng AI, bật **"Gắn nhãn nội dung do AI tạo"** trong Cài đặt: gói đăng sẽ nhắc anh bật mục "Nội dung do AI tạo" khi đăng.
- TikTok chỉ cho hẹn giờ trong một khoảng nhất định; nếu không đặt được đúng giờ thì chọn giờ gần nhất cho phép.

## Cách 2 (sau này, khi ứng dụng TikTok được duyệt): Tự đăng bằng API

Phần còn lại của tài liệu này nói về cách 2.

TikTok khác Facebook: **mỗi tài khoản TikTok phải tự đăng nhập một lần** để cấp quyền, và ứng dụng của anh phải được TikTok **kiểm duyệt (audit)** thì mới đăng công khai được.

> Giao diện cổng nhà phát triển TikTok có thể đổi tên mục. Nếu tên mục khác hướng dẫn dưới đây thì làm theo ý nghĩa, chụp màn hình gửi mình nếu bí.

## 1. Những gì app đã làm sẵn

- Đăng nhập TikTok (OAuth) cho **từng thương hiệu** (mỗi thương hiệu 1 tài khoản): nút **Kết nối TikTok** ở trang *Thương hiệu & Kênh*.
- Đăng **video** (mp4, mov, webm, tối đa 4GB) từ Thư viện Media bằng kiểu tải trực tiếp, chia khúc đúng quy định của TikTok.
- Token được lưu **riêng** (`data/secrets.json`, quyền 0600), không có trong bản sao lưu hay trên giao diện; tự làm mới (token truy cập 24 giờ, làm mới ~365 ngày).
- Trang công khai cho hồ sơ xét duyệt: `https://agent.theonehairsalon.vn/privacy` và `/terms` (song ngữ Việt–Anh, mở được không cần đăng nhập).
- Mặc định đăng ở chế độ **"Chỉ mình tôi" (riêng tư)**.

## 2. Đăng ký ứng dụng TikTok (anh làm, ~15 phút)

1. Vào **https://developers.tiktok.com** → đăng nhập bằng tài khoản TikTok của anh → **Manage apps → Connect an app** (tạo ứng dụng mới).
2. Điền thông tin cơ bản:
   - **App name:** ví dụ `Salon Agent` (tên hiển thị khi anh bấm cho phép).
   - **Category:** Business / Productivity (chọn mục gần nhất).
   - **Description:** *"Internal tool of our hair salon group (The One, Dark Hair, Mishang) to schedule and publish our own videos to our own TikTok accounts."*
   - **Terms of Service URL:** `https://agent.theonehairsalon.vn/terms`
   - **Privacy Policy URL:** `https://agent.theonehairsalon.vn/privacy`
   - **Platform:** Web, **Website URL:** `https://agent.theonehairsalon.vn`
3. Thêm sản phẩm **Login Kit** và đặt **Redirect URI** đúng y như sau (TikTok bắt buộc `https`, không có dấu `?` hay `#`):
   ```
   https://agent.theonehairsalon.vn/auth/tiktok/callback
   ```
4. Thêm sản phẩm **Content Posting API**, bật **Direct Post**. Quyền (scope) cần: **`user.info.basic`** và **`video.publish`**.
5. Lấy **Client key** và **Client secret** ở trang ứng dụng. **Đây là bí mật**, chỉ dán vào `.env` bằng script bên dưới, không gửi qua chat.

## 3. Đưa khóa vào app (trên máy Windows của anh)

Sao chép **Client key**, rồi trong Terminal:
```powershell
.\deploy\set-secret.ps1 -Name TIKTOK_CLIENT_KEY -FromClipboard
```
Sao chép **Client secret**, rồi:
```powershell
.\deploy\set-secret.ps1 -Name TIKTOK_CLIENT_SECRET -FromClipboard
```
Địa chỉ app (`PUBLIC_BASE_URL=https://agent.theonehairsalon.vn`) mình đã đặt sẵn trên VPS.

## 4. Kết nối tài khoản và thử đăng

1. Vào app → **Cài đặt**: thẻ *TikTok* phải báo "Đã có" cho khóa và địa chỉ, và hiện Redirect URI.
2. Vào **Thương hiệu & Kênh** → dòng TikTok của thương hiệu → **Kết nối TikTok** → đăng nhập TikTok **bằng đúng tài khoản của thương hiệu đó** → **Cho phép**.
3. **Để thử khi ứng dụng chưa được duyệt:** TikTok chỉ cho đăng **lên tài khoản đang đặt chế độ riêng tư** (Cài đặt TikTok → Quyền riêng tư → Tài khoản riêng tư). Nếu tài khoản đang công khai, lúc đăng sẽ báo lỗi *"unaudited_client_can_only_post_to_private_accounts"* (app dịch thành câu tiếng Việt).
4. Bỏ video vào Thư viện Media của thương hiệu, tạo kế hoạch/bài kênh **TikTok** (mỗi bài đúng 1 video), duyệt, bỏ "Chạy thử" rồi chạy Agent Nội dung. Video sẽ ở chế độ **riêng tư**, chỉ chủ tài khoản thấy.

## 5. Nộp kiểm duyệt (audit) để đăng công khai

- Khi bài thử chạy ổn, ở cổng nhà phát triển nộp **App review / Audit** cho Content Posting API.
- Thường cần: mô tả cách dùng, **video quay màn hình** quy trình (đăng nhập TikTok → soạn → duyệt → đăng), các trang Terms/Privacy ở trên.
- **Thời gian xét duyệt:** các nguồn bên thứ ba ước tính vài tuần, TikTok không cam kết.
- **Rủi ro cần biết:** quy định của TikTok về Direct Post yêu cầu người dùng được kiểm soát từng bài (chế độ hiển thị, bình luận/duet/stitch, nội dung thương mại). Công cụ của anh đăng **tự động theo lịch** (anh duyệt từng bài/kế hoạch trước). Nếu TikTok từ chối kiểu đăng tự động này, phương án dự phòng là chế độ **tải lên hộp thư nháp** (`video.upload`): app gửi video vào TikTok, anh bấm đăng trong ứng dụng TikTok. Mình có thể bổ sung nếu cần.
- Nhớ bật **"Gắn nhãn nội dung do AI tạo"** trong Cài đặt nếu video làm bằng AI.

## 6. Giới hạn cần biết

- Mỗi token chỉ gọi 6 lần/phút khi khởi tạo bài; có giới hạn số bài/ngày theo từng tài khoản (TikTok quyết định).
- Chỉ đăng **video** (chưa hỗ trợ bài ảnh).
- Token làm mới hết hạn sau ~365 ngày hoặc khi anh gỡ quyền: app sẽ báo **"Cần kết nối lại"**, bấm *Kết nối lại*.
- Ngắt kết nối bằng nút **Ngắt**: token bị thu hồi ở TikTok và xóa khỏi VPS.
