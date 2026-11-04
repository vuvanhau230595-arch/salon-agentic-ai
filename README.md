# Salon Agentic AI

Agent quản lý quảng cáo + mạng xã hội cho The One · Dark Hair · Mishang. Node 24, không cần `npm install`.

```bash
node src/server.js        # mở http://127.0.0.1:3950
npm test
```

## Agent làm gì
- Cứ 30 phút quét chiến dịch Facebook Ads theo luật của Sếp (trang **Quảng cáo**):
  tắt khi giá/tin nhắn quá cao, tắt khi tiêu tiền mà 0 tin nhắn, tắt tất cả khi chạm trần tháng.
- **Chỉ tự giảm/tắt.** Tăng ngân sách, đăng bài, trả lời bình luận → vào **Duyệt & Phê duyệt**.
- AI (Claude) soạn bài, soạn câu trả lời bình luận, phân tích chiến dịch.
- Nhật ký mọi hành động; nút **Dừng khẩn cấp** ở góc phải.

## Ảnh & video: bỏ vào đâu để agent tự lấy
Mỗi thương hiệu có một thư mục trong `media/`:

```
media/the_one/      media/dark_hair/      media/mishang/
```
- Bỏ **ảnh** (jpg, png, webp ≤ 30MB) hoặc **video** (mp4, mov ≤ 1GB) vào đúng thư mục thương hiệu, hoặc kéo thả ở trang **Thư viện Media** (dùng được từ điện thoại).
- Khi soạn kế hoạch tháng, agent tự gắn mỗi bài 1 ảnh/video: **file chưa dùng trước, cũ nhất trước**; hết file thì quay vòng file ít dùng nhất. Reel chỉ lấy video.
- AI viết nội dung hợp với file dựa vào **tên file hoặc ghi chú** (ghi chú gõ ở trang Thư viện Media). AI không "nhìn" được ảnh/video, nên hãy đặt tên có dấu, rõ nghĩa, ví dụ `Nhuộm balayage khách Lan.jpg`.
- Ở Kế hoạch tháng bạn đổi/gỡ/thêm ảnh cho từng bài. Một bài gắn 1 video hoặc tối đa 10 ảnh (không trộn).
- Đăng thật lên Facebook: 1 ảnh → đăng ảnh kèm chú thích; nhiều ảnh → 1 bài album; video → đăng video lên Page. File bị xóa/thiếu thì bài giữ nguyên lịch, không đăng, báo trong Nhật ký.
- **Nạp từ Google Drive:** mỗi thương hiệu một thư mục Drive, agent tự kéo file mới về theo lịch quét (chỉ đọc Drive, không xoá gì). Hướng dẫn tạo service account và chia sẻ thư mục: **[HUONG-DAN-DRIVE.md](HUONG-DAN-DRIVE.md)**.
- Thư mục `media/` không đưa lên git. Muốn đặt chỗ khác: `MEDIA_DIR=` trong `.env`.

## Kênh 小红书 Xiaohongshu (gói đăng thủ công)
Xiaohongshu không có API đăng bài cho tài khoản thường, nên agent làm phần việc nặng, người bấm đăng:
1. **Bật kênh** ở Thương hiệu & Kênh (tắt sẵn) và nhập **địa chỉ tiếng Trung** (`addressZh`, không ghi số điện thoại).
2. **Soạn**: Kế hoạch tháng → chọn kênh 小红书 → AI viết **tiếng Trung theo giọng salon**, mỗi bài có tiêu đề ≤ 20 chữ, hashtag và địa chỉ. Chưa có `ANTHROPIC_API_KEY` thì dùng 6 mẫu có sẵn (không bịa dịch vụ/giá). Loại *Reel* = video, *Bài đăng* = ảnh + chữ.
3. **Kiểm tra tuân thủ** (`src/compliance.js`): bài vi phạm nặng (WeChat/SĐT/link/QR, từ cực đoan 最/第一…, tiêu đề > 20 chữ) **không duyệt được**; giọng khách tự kể, lời hứa kết quả, video < 1080P, người hiện mặt chưa xác nhận đồng ý, watermark nền tảng khác chỉ cảnh báo. Danh sách luật nằm ở trang **Kênh**; chúng tổng hợp từ nguồn thứ cấp, **không phải điều khoản chính thức** nên cần đối chiếu định kỳ.
4. **Gói đăng**: Lịch đăng → 📦 Gói đăng cho tiêu đề, nội dung, hashtag, đường dẫn file + thông số video, **giờ Bắc Kinh** (= giờ Việt Nam + 1) và các bước đăng. Đăng/hẹn giờ trên trang creator rồi bấm *Đã hẹn giờ trên 小红书* hoặc *Đã đăng*. Đến giờ mà chưa đánh dấu, agent nhắc 1 lần trong Nhật ký (không đăng giả).
5. **Agent xem video** (tùy chọn): có `GEMINI_API_KEY` thì ở Thư viện Media bấm *Gemini xem file* — agent ghi lại loại dịch vụ, màu tóc, có before/after không, số người hiện mặt, watermark. Kết quả dùng làm gợi ý cho AI viết bài và cho cảnh báo quyền hình ảnh. Hết hạn mức miễn phí thì dừng và báo rõ.

Giới hạn đã biết: không gắn được vị trí (POI) của quán ở Việt Nam; hashtag trong bài là chữ thường, nên chọn lại bằng nút 话题 khi đăng; chất lượng video đăng lên bị giới hạn bởi file gốc (nền tảng khuyên 1080P trở lên).

## Mặc định an toàn
- `Chạy thử` BẬT: chỉ ghi nhật ký, không tắt/đổi/đăng thật. Bỏ chọn ở trang Quảng cáo để chạy thật.
- Chưa có key → chế độ mẫu (3 chiến dịch giả giống ảnh demo).
- Chỉ nghe `127.0.0.1`. Đưa lên VPS: đặt `HOST=0.0.0.0` và `APP_PASSWORD`.

## Nối thật
Page ID và ID tài khoản quảng cáo nhập **theo từng thương hiệu** trong app (Thương hiệu & Kênh); mỗi thương hiệu đăng được lên nhiều Page. Mishang dùng trang cá nhân nên chưa đăng tự động được (Facebook không cho). Hướng dẫn lấy token từng bước: **[HUONG-DAN-META.md](HUONG-DAN-META.md)**. Copy `.env.example` → `.env`, điền:
| Biến | Dùng cho |
|---|---|
| `META_ACCESS_TOKEN` | Facebook: đọc số liệu quảng cáo, tắt chiến dịch, đăng bài, nhận/trả lời bình luận |
| `ANTHROPIC_API_KEY` | AI viết nháp / phân tích |

Instagram, TikTok, Google Ads, Zalo OA: mới có khung (chế độ mẫu), cần viết connector trong `src/connectors/social.js`.
Sau khi điền, vào Cài đặt → "Kiểm tra kết nối Meta" (chỉ đọc). Phần Meta đã được kiểm thử bằng Meta giả lập, **chưa thử với tài khoản thật** — hãy để Chạy thử vài ngày để đối chiếu số liệu với Ads Manager trước khi chạy thật.
