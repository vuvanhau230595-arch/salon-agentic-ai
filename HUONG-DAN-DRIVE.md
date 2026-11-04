# Nạp ảnh/video từ Google Drive — hướng dẫn

Mỗi thương hiệu có **một hay nhiều thư mục Google Drive** (tối đa 10; ví dụ 1 thư mục ảnh Facebook, 1 thư mục video TikTok). File nạp từ thư mục nào thì tự gắn **thẻ** theo nhãn của thư mục đó (hoặc tên thư mục trên Drive nếu không đặt nhãn) để lọc nhanh trong Thư viện Media. Anh (hoặc nhân viên) bỏ ảnh/video vào thư mục đó từ điện thoại; agent tự kéo file **mới** về Thư viện Media theo lịch quét (mặc định 30 phút/lần), tối đa 20 file mỗi lượt cho mỗi thương hiệu.

**App chỉ ĐỌC Drive:** không xoá, không sửa, không đổi tên gì trên Drive. Xoá file trên Drive thì file đã nạp vẫn còn trong app. File đã nạp không tải lại; trùng tên thì app thêm hậu tố `-1`, `-2`. Chỉ nhận ảnh **jpg/png/webp** (≤ 30MB) và video **mp4/mov** (≤ 1GB); file khác bị bỏ qua và ghi vào Nhật ký.

Làm 1 lần, khoảng 10 phút. Cần một tài khoản Google (Gmail) để vào Google Cloud.

## Bước 1 — Tạo dự án Google Cloud (nếu chưa có)

1. Vào https://console.cloud.google.com → đăng nhập Gmail.
2. Trên cùng, bấm ô chọn dự án → **New Project** → đặt tên, ví dụ `salon-media` → **Create**. Chờ vài giây rồi chọn dự án vừa tạo.

## Bước 2 — Bật Google Drive API

1. Menu trái (☰) → **APIs & Services → Library**.
2. Tìm **Google Drive API** → bấm vào → **Enable**.

## Bước 3 — Tạo service account và tải file JSON

1. Menu trái → **APIs & Services → Credentials** → **+ Create credentials → Service account**.
2. Tên: `media-sync` → **Create and continue** → bỏ qua phần vai trò (**Continue**) → **Done**.
3. Trong danh sách Service Accounts, bấm vào email vừa tạo (dạng `media-sync@salon-media.iam.gserviceaccount.com`).
4. Tab **Keys** → **Add key → Create new key** → chọn **JSON** → **Create**. Trình duyệt tải về 1 file `.json`.

> File JSON này là **chìa khoá**: ai có file là đọc được mọi thư mục đã chia sẻ cho service account. Không gửi qua chat, không đăng lên mạng. Dùng xong tải lên app thì có thể xoá khỏi máy/điện thoại.

## Bước 4 — Tải file JSON lên app

1. Mở app → **Cài đặt → Kết nối API → Google Drive (nạp media)** → **Tải file JSON service account** → chọn file vừa tải.
2. App hiện **Đã có** và **email service account**. Bấm **Sao chép** để lấy email này cho bước 5.
3. Bấm **Kiểm tra khoá** để chắc chắn app nói chuyện được với Google.

Khoá được lưu riêng trong kho bí mật của máy chủ (như token TikTok), không nằm trong bản sao lưu dữ liệu và không hiện lại trên web. Muốn đổi khoá thì tải file mới đè lên; muốn bỏ thì bấm **Gỡ khoá**.

## Bước 5 — Tạo thư mục Drive và chia sẻ cho service account

Làm cho **từng thương hiệu** (The One, Dark Hair, Mishang):

1. Trên Google Drive (điện thoại hay máy tính đều được), tạo thư mục, ví dụ `The One - Media`.
2. Mở thư mục → **Chia sẻ** → dán **email service account** (bước 4) → quyền **Người xem** là đủ → **Gửi** (bỏ tick "Thông báo" nếu muốn).
3. Bấm **Sao chép liên kết** của thư mục (dạng `https://drive.google.com/drive/folders/…`).

## Bước 6 — Dán link vào app và bật tự nạp

1. App → **Thư viện Media** → chọn thương hiệu → khối **☁ Nạp từ Google Drive**.
2. Dán link thư mục, đặt nhãn (vd: `TikTok`) → **＋ Thêm thư mục**. Thêm được nhiều thư mục; bấm ✕ để bỏ (file đã nạp vẫn còn).
3. Bấm **Kiểm tra**: app báo tên thư mục, số file, số file mới. Nếu báo "chưa được chia sẻ" thì quay lại bước 5.
4. Bấm **⬇ Nạp ngay** để kéo về lần đầu; bật **Tự nạp theo lịch quét** để từ nay agent tự làm.

Từ giờ: bỏ ảnh/video vào thư mục Drive → trong vòng một lượt quét, file xuất hiện trong Thư viện Media (Nhật ký ghi "Google Drive → The One: nạp N file mới"). Agent Nội dung sẽ tự lấy file chưa dùng để ghép bài như file tải lên tay.

## Thư mục hiện có (16/10/2026)

Trên Drive của tài khoản vuvanhau230595@gmail.com, thư mục **Salon Media** (đã chia sẻ cho service account, thư mục con tự thừa hưởng) gồm: `The One`, `Dark Hair`, `Mishang`, `Dark Hair TikTok`, `Mishang TikTok`, `Tóc nam TikTok` (gắn vào The One, thẻ #tóc-nam-tiktok). Tạo thêm thư mục con trong Salon Media thì không cần chia sẻ lại, chỉ cần dán link vào app.

## Khi gặp lỗi

| App báo | Cách xử lý |
|---|---|
| Chưa có khoá service account | Làm bước 3–4. |
| Khoá không hợp lệ hoặc bị thu hồi | Khoá bị xoá trong Google Cloud, hoặc tải nhầm file. Tạo khoá mới (bước 3.4) rồi tải lại. |
| Google Drive API chưa được bật | Làm bước 2 cho đúng dự án chứa service account. |
| Không thấy thư mục / chưa được chia sẻ | Mở thư mục trên Drive → Chia sẻ → kiểm tra đã có email service account chưa; hoặc link dán sai (phải là link THƯ MỤC, không phải link file). |
| Bỏ qua "tên file" — không phải ảnh/video | File không phải jpg/png/webp/mp4/mov (ví dụ HEIC từ iPhone: đổi cài đặt máy ảnh sang "Tương thích nhất" hoặc xuất ra JPG). |
| Bỏ qua — quá lớn | Ảnh trên 30MB hoặc video trên 1GB: nén lại rồi bỏ vào Drive với tên khác (file bỏ qua chỉ được thử lại khi nội dung đổi). |
| Agent Google Drive tự tạm dừng | 3 lượt lỗi liên tiếp. Xử lý nguyên nhân (thường là quyền) rồi bật lại ở Agent & Tác vụ. |

## Cách khác: đặt file JSON thẳng trên VPS

Nếu không muốn tải qua web: chép file JSON lên VPS (ví dụ `/opt/salon-agentic-ai/data/google-sa.json`, `chmod 600`, chủ sở hữu là tài khoản chạy dịch vụ) rồi thêm vào `.env`:

```
GOOGLE_SERVICE_ACCOUNT_FILE=/opt/salon-agentic-ai/data/google-sa.json
```

và khởi động lại dịch vụ (`systemctl restart salon-agentic-ai`). Khi đặt biến này, app ưu tiên file đó và khoá tải qua web bị bỏ qua (nút tải/gỡ trên web bị khoá).

## Video H.265 (HEVC) tự chuyển sang H.264

Video quay bằng iPhone hoặc qua app làm nét (quality restoration…) thường là H.265: Chrome/Edge trên Windows và nhiều máy Android **không phát được**, thư viện hiện khung đen. Máy chủ tự chuyển các video này sang H.264 (tải lên, nạp từ Drive hay chép tay đều được), mỗi lần một video, ưu tiên thấp để không làm chậm POS.

- Giữ nguyên tên file và ngày thêm, bài đã gắn file vẫn dùng được.
- Bản gốc H.265: file nạp từ Drive thì bản gốc vẫn ở trên Drive; file tải lên/chép tay thì giữ ở `media/.goc-hevc/` trên máy chủ.
- Đang chuyển thì thẻ file hiện "⏳ Đang chuyển H.264" (khoảng 1–3 phút cho mỗi phút video). Lỗi thì hiện "⚠ Lỗi chuyển mã", mở file bấm **Thử lại**; file gốc không bị đụng.
- Ổ đĩa máy chủ gần đầy thì tạm chờ và báo trong Nhật ký.
