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

### Player UX
- [ ] Khi người chơi vào, hiện popup nhập tên trước, sau đó vào hệ thống vé để chọn số lượng vé
- [ ] Tránh tên người chơi trùng bằng tự đặt tên theo số người hiện tại
- [ ] Khi đổi máy chơi, chỉ cần nhập đúng tên; nếu vào lại thì hiển thị 'Chào mừng bạn quay lại' và tiếp tục dò số
- [ ] Khôi phục vé theo tên + mã vé, có kiểm tra trùng tên khi tham gia
- [ ] Hiệu ứng khi một số xuất hiện: số nhảy/rớt xuống ô phía dưới (FIFO)

### TV / Host UX
- [ ] Chuyển mã QR sang màn hình TV (góc phải) để người chơi quét
- [ ] Panel bên trái TV hiển thị người tham gia và tiến độ (còn thiếu bao nhiêu hàng ngang/dọc)
- [ ] Top trên TV hiển thị người gần KINH; top tiền thắng ẩn cho đến khi admin bấm show
- [ ] Popup phổ biến luật chơi trên màn hình TV, admin có thể bật/tắt
- [ ] Khi sắp KINH, hiển thị rõ sắp vào hàng mấy (hàng 1, hàng 2, hàng 4, hàng chục...)
- [ ] Kết thúc trận đấu: hiện popup tên người thắng to rõ; nếu chơi ván tiếp thì xóa popup nhưng vẫn giữ top người thắng

### Admin & Money
- [ ] Admin xác nhận trả tiền rồi tiếp tục; nếu trả sau hoặc nợ, hệ thống ghi nhận tiền nợ dựa trên số vé và mức cược
- [ ] Admin có quyền chỉnh tiền người chơi về 0 nếu đã thu tiền trước khi bắt đầu ván
- [ ] Admin có thể chỉnh số lượng người chơi tối đa (max players)
- [ ] Admin có thể chỉnh và theo dõi số lượng người thắng (max winners / số người KINH)
- [ ] Quản lý tiền người chơi: hiển thị số tiền thắng và số tiền nợ; có field nợ; admin có thể xóa nợ; khi tăng tiền thì tăng nợ nếu checkbox 'đang chơi nợ' được bật
- [ ] Tiền tự động tính trên trang admin dựa trên số vé chọn và mức cược mỗi vé

### Realtime / Audio
- [ ] Người tham gia giữa chừng vào hàng chờ và thấy thông báo chờ lượt tiếp theo
- [ ] Thêm bot đọc số theo phong cách vui nhộn tiếng Việt, linh hoạt theo nhạc thịnh hành
- [ ] Sau khi đọc một số, nếu phát hiện người gần KINH thì la to tên người sắp KINH; nếu có nhiều người thì đọc tuần tự với ngắt nhịp rõ ràng

### Leaderboard
- [ ] Bảng xếp hạng người chơi: chưa có tiền thắng thì sắp xếp theo tên A-Z, sau đó xếp theo số tiền ăn được; top 1/2/3 có vương miện


## Implementation Areas
### Frontend
- QR on TV, rules popup, leaderboard UI, near-KINH display, number drop animation
- Player join flow, name input, ticket selection, wallet display
- TV layout: participants panel, top money/winners display
- Bot announcer UI toggle

### Backend
- Mid-game waiting queue, rejoin by name, ticket recovery
- Money calculation, debt tracking, admin adjustments
- Game end condition based on winner count
- Realtime events for players, TV, host
- State persistence and history

## Clarifications
- Tham gia giữa chừng: người chơi cũ tiếp tục chơi; người mới vào hàng chờ.
- Kết thúc ván: admin đặt ngưỡng người thắng hoặc kết thúc thủ công; có thể cấu hình mặc định.
- Tiền: hệ thống tự tính từ số vé và mức cược; admin điều chỉnh là ghi đè có lý do.
- Bảng xếp hạng: sắp xếp theo tổng tiền thắng, sau đó theo tên A-Z.
- Hiệu ứng FIFO chỉ là hiển thị và không được ảnh hưởng logic game.
- Popup luật chơi do admin bật/tắt; có thể che màn hình khi bật, admin tắt nếu gây cản trở.
