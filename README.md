# ⚡ Gmail OTP Reader - 1-Click Web App

Ứng dụng Web App đọc Gmail & trích xuất mã OTP tự động chỉ bằng 1 nút bấm (hoặc phím tắt `Space` / `Enter`), sử dụng chuẩn chính thức **Google Workspace Gmail API** và `@google-cloud/local-auth`.

![Gmail OTP Reader Dashboard](public/styles.css)

## 🌟 Tính Năng Nổi Bật

- **1 Nút Bấm Khổng Lồ**: Nhấp nút **⚡ LẤY MÃ OTP NGAY** (hoặc ấn `SPACE` / `ENTER`) để lấy mã OTP mới nhất từ Gmail trong ~1 giây.
- **Tự Động Sao Chép (1-Click Auto Copy)**: Mã OTP được tự động copy vào Clipboard ngay khi nhận được.
- **Hiệu Ứng Trực Quan & Âm Thanh**: Hiển thị chữ số mã OTP khổng lồ với hiệu ứng phát sáng Neon + tiếng Beep báo hiệu.
- **Xác Thực An Toàn**: Sử dụng tệp `credentials.json` chính thức của Google OAuth2 Desktop App. Token đăng nhập được lưu lại tại `token.json` để không phải đăng nhập lại ở các lần sau.
- **Biểu Thức Regex Thông Minh**: Tự động nhận diện mã xác minh tiếng Việt & tiếng Anh (4-8 chữ số) và loại bỏ các con số năm.
- **Bảng Lịch Sử Log**: Lưu lại danh sách các mã OTP đã lấy trong phiên làm việc.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Ứng Dụng

### 1. Clone Dự Án
```bash
git clone https://github.com/nxl2010/droppi.git
cd droppi
```

### 2. Cài Đặt Thư Viện
```bash
npm install
```

### 3. Thêm Tệp Cấu Hình Google OAuth `credentials.json`
Tạo tệp `credentials.json` ở thư mục gốc của dự án (hoặc tải tệp OAuth Client ID loại **Desktop app** từ [Google Cloud Console](https://console.cloud.google.com/apis/credentials)):

```json
{
  "installed": {
    "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET"
  }
}
```

### 4. Chạy Ứng Dụng
```bash
npm start
```
Mở trình duyệt truy cập: **`http://localhost:3000`**

---

## 🛠️ Công Nghệ Sử Dụng

- **Backend**: Node.js, Express.js, `@google-cloud/local-auth`, `googleapis` (Gmail API v1)
- **Frontend**: HTML5, CSS Vanilla (Dark Glassmorphism UI), JavaScript ES6+

---

## 🔒 Bảo Mật (Security)
Tệp `credentials.json` và `token.json` chứa thông tin bảo mật cá nhân đã được thêm vào `.gitignore` để tránh bị đẩy công khai lên Git.
