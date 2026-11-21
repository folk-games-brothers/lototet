# Roadmap - Xổ Lô Tô Tết

## Current Features
### Core game
- Vé 9x9 (81 ô), mỗi hàng 5 số, 4 ô đục
- 200 vé random, không trùng chữ ký lưới
- Mỗi cột là một chục, số tăng dần từ trên xuống
- Xổ số theo 2 chế độ: xổ ngay hoặc tự xổ đến khi có KINH
- KINH khi một hàng ngang đủ số
- Báo "còn 1 số" cho hàng gần KINH
- Chia tiền thưởng đều cho các hàng KINH
- Tổng giải tính theo số vé bán × mức cược

### Player flow
- Quét QR để vào trang người chơi
- Nhập tên, chọn 1–4 vé
- Nhận vé random từ kho 200 vé
- Đổi vé trước khi chốt
- Chốt vé, không đổi sau khi chốt
- Tab chuyển đổi nhiều vé
- Ví tiền trên điện thoại: nạp, trừ cược, cộng thưởng
- Báo KINH, rung + pháo hoa, gửi phản hồi về màn hình chính

### Host / TV
- Màn hình chính quản lý ván
- Màn hình TV/máy chiếu hiển thị số xổ lớn
- Danh sách người đã chốt vé
- Bảng tổng kết ván: tổng giải, tiền mỗi kinh, từng người chơi, số tiền ròng
- Lưu lịch sử ván và trạng thái game
- QR code tự lấy IP LAN
- Font tiếng Việt local, không cần internet

### Operations
- Node.js + Express + Socket.IO
- Port cấu hình bằng `PORT`
- Dữ liệu lưu JSON local

## Missing / Planned Features

### Game rules & fairness
- [ ] Chế độ chơi theo luật lô tô truyền thống đầy đủ (KINH theo hàng, theo cột, toàn vé)
- [ ] Nhiều kiểu vé: 9x9, 5x5, vé nhỏ cho trẻ em
- [ ] Tùy chỉnh số lượng số trên mỗi hàng
- [ ] Tùy chỉnh số lượng vé trong kho
- [ ] Chống trùng vé nâng cao (checksum + seed)
- [ ] Lịch sử số xổ có thể xem lại theo ván
- [ ] Replay ván cũ

### Multiplayer & hosting
- [ ] Host backend cloud + frontend GitHub Pages
- [ ] Hỗ trợ `PUBLIC_URL` / `BACKEND_URL`
- [ ] CORS cho frontend tách biệt
- [ ] Chơi từ xa không cùng LAN
- [ ] Nhiều phòng chơi cùng lúc
- [ ] Mã phòng / link mời người chơi
- [ ] Giới hạn số người chơi theo phòng
- [ ] Reconnect khi mất mạng

### Player experience
- [ ] Đăng ký / đăng nhập người chơi
- [ ] Avatar người chơi
- [ ] Chat trong phòng
- [ ] Thông báo âm thanh tùy chọn
- [ ] Dark mode / theme Tết
- [ ] Hỗ trợ iOS Safari tốt hơn
- [ ] PWA / cài đặt như app
- [ ] Offline cache cơ bản

### Host experience
- [ ] Dashboard quản lý nhiều ván
- [ ] Tùy chỉnh luật chơi bằng UI
- [ ] Lịch sử ván có bộ lọc và tìm kiếm
- [ ] Export kết quả ra CSV/Excel
- [ ] In vé / xuất PDF
- [ ] Quản lý người chơi và ví tiền tập trung
- [ ] Thống kê: số lần KINH, tỷ lệ thắng, top người chơi

### Payments & wallet
- [ ] Nạp tiền thật qua QR banking
- [ ] Ví người chơi đồng bộ server thay vì localStorage
- [ ] Lịch sử giao dịch
- [ ] Giới hạn nạp/rút
- [ ] Chống gian lận ví

### Security & reliability
- [ ] Xác thực host
- [ ] Rate limit API
- [ ] Validate input chặt chẽ
- [ ] Persistent database thay vì JSON file
- [ ] Backup tự động
- [ ] Monitoring và logging
- [ ] Health check endpoint

### DevOps & quality
- [ ] Dockerfile
- [ ] Docker Compose
- [ ] CI test/lint
- [ ] Deploy workflow
- [ ] Environment-based config
- [ ] Unit/integration tests
- [ ] E2E test cho flow chơi

## Priority Suggestion
### Phase 1 - Ổn định
- Persistent storage
- Host/TV realtime 안정
- Mobile UX
- Basic tests

### Phase 2 - Mở rộng
- Cloud hosting
- Remote play
- Wallet đồng bộ
- Export lịch sử

### Phase 3 - Nâng cao
- Multi-room
- Auth
- Payments
- Analytics
EOF
git add ROADMAP.md && git -c user.name="tranthaiminhtansoft" -c user.email="tranthaiminhtansoft@users.noreply.github.com" commit -m "docs: add Loto Tet roadmap" && git push -u origin docs/add-roadmap