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

## Planned Enhancements (User Requested)
- [ ] Move QR code to TV screen (top-right corner) for players to scan
- [ ] Players joining mid-game go to waiting queue and see "waiting for next round"
- [ ] Add bot announcer reading drawn numbers in playful Vietnamese style, adaptable to trending songs
- [ ] Prevent duplicate player names by auto-naming based on current player count; admin can rename players and adjust money (paid/debt)
- [ ] TV left panel shows participants and their progress (remaining horizontal/vertical rows)
- [ ] Money auto-calculated on admin page based on selected tickets and bet per ticket
- [ ] Bảng xếp hạng người chơi: chưa có tiền thắng thì sắp xếp theo tên A-Z, sau đó xếp theo số tiền ăn được; top 1/2/3 có vương miện
- [ ] Popup phổ biến luật chơi trên màn hình TV, admin có thể bật/tắt trong lúc chơi
- [ ] Khi đổi máy chơi, chỉ cần nhập đúng tên; khi quét QR, kiểm tra người chơi đã tham gia chưa; nếu vào lại thì hiển thị 'Chào mừng bạn quay lại' và tiếp tục dò số
- [ ] Khi người chơi vào, hiện popup nhập tên trước, sau đó vào hệ thống vé để chọn số lượng vé; admin xác nhận trả tiền rồi tiếp tục; nếu trả sau hoặc nợ, hệ thống luôn ghi nhận tiền nợ dựa trên số vé và mức cược do admin đặt
- [ ] Admin có quyền chỉnh tiền của người chơi về 0 nếu đã thu tiền trước khi bắt đầu ván
- [ ] Admin có thể chỉnh số lượng người chơi tối đa (max players)
- [ ] Admin có thể chỉnh và theo dõi số lượng người thắng (max winners / số người KINH)

- [ ] Ticket recovery by name + ticket code, with duplicate-name prevention when joining