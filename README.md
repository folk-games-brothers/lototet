# 🧧 XỔ LÔ TÔ NGÀY TẾT (vé 9×9)

Trang chơi lô tô trên **LAN**: màn hình chính (host) + trang người chơi trên điện thoại (quét QR).

## Luật chơi / cấu trúc vé
- **Vé 9 ô ngang × 9 ô dọc** (81 ô).
- **Mỗi hàng 9 ô: đục 4 ô → còn đúng 5 ô có số** → mỗi vé 45 số, không dày.
- **Mỗi cột là một chục**: cột 1 = 1–9, cột 2 = 10–19, …, cột 9 = 80–90.
- Số trong **mỗi cột xếp tăng dần từ trên xuống** (số nhỏ nhất ở hàng đầu). Vị trí các lỗ xáo trộn nên vé nào cũng khác nhau.
- Khi tạo kho **200 vé**, server so sánh chữ ký toàn bộ lưới (số + ô đục) và **sinh lại ngay nếu trùng** → đảm bảo 200 vé khác biệt. Lúc khởi động có log báo số vé trùng (luôn là 0).
- **KINH khi một hàng ngang đủ toàn bộ số** (không cần đủ cả vé).
- Khi một hàng **còn đúng 1 số**: điện thoại hiện **"Hàng N còn 1 số — đang đợi số XX"** + badge ngay trên hàng.
- Tiền giải **chia đều** cho tất cả các hàng kinh (`Tổng giải / số hàng kinh`).

## Luồng tham gia
1. Quét QR → nhập tên → nhận **vé random** trong kho **200 vé** (mã vé `V001`…`V200`).
2. Nhấn **🔄 ĐỔI VÉ** để đổi sang bộ vé khác (có thể đổi nhiều lần, trước khi chốt).
3. Ứng ý thì nhấn **🔒 CHỐT VÉ** → tên và mã vé hiện ngay trong **danh sách người chơi đã chốt** trên màn hình chính. Sau khi chốt **không đổi vé được nữa**.
4. Host bấm **XỔ SỐ NGAY**: số quay nhanh rồi **chậm dần ~6 giây** mới dừng lại (có thể chỉnh **Thời gian quay** 2–15s ở màn hình chính, đổi không cần tạo ván mới). Trong lúc quay nút bị khóa, bấm liên tục sẽ bị từ chối. Kết quả (đánh dấu vé, báo kinh) chỉ áp dụng sau khi số dừng.
5. Khi trúng hàng → điện thoại báo **KINH** (rung + pháo hoa), bấm gửi phản hồi → hiện trên màn hình chính.
6. **Kết thúc & Lưu** ghi ván vào lịch sử; **Ván mới** phát lại 200 vé.

## Tính năng
- 📱 Quét QR tự lấy IP LAN.
- 🎫 200 vé random, đổi/chốt vé.
- ✅ Danh sách **người đã chốt** trên màn hình chính (tên + mã vé + số kinh).
- 🔢 Số xổ to, rõ, hiệu ứng + tiếng beep.
- ⏳ Báo "đợi số XX" khi hàng còn 1 số.
- 🏆 Báo KINH trên điện thoại, phản hồi về màn hình chính.
- 💾 Lưu mọi lượt xổ + lịch sử ván (`data/history.json`, `data/game-state.json`).

## Cài đặt & chạy
```bash
cd E:\Tools_Vip\Tools\Loto
npm install
npm start
```
Hoặc double-click `Chay-May-Chu.cmd`. Server tại `http://localhost:3000`.

## Cấu hình trên màn hình chính
- **Số vé (tối đa)** — mặc định `200` (có thể chỉnh).
- **Tổng tiền giải (VNĐ)** — mặc định `1.000.000đ`.

## Cấu trúc
```
Loto/
├─ server.js              # Express + Socket.IO, lưới vé 9x9, đổi/chốt vé, luật KINH
├─ package.json
├─ Chay-May-Chu.cmd
├─ data/                  # history.json, game-state.json (tự tạo)
└─ public/
   ├─ index.html          # Màn hình chính (+ danh sách người đã chốt)
   ├─ play.html           # Trang người chơi (+ Đổi vé / Chốt vé)
   ├─ css/style.css
   └─ js/host.js, player.js
```

## Màn hình TV (chiếu riêng)
- Trang quản lý: `http://localhost:3000` — bấm nút **📺 Mở màn hình TV** để mở tab mới.
- Màn hình TV: `http://<IP-máy>:3000/tv.html` — đem đi toàn màn hình trên TV/máy chiếu (nhấn F11).
- TV hiện **số xổ cực to**, hiệu ứng quay đồng bộ với trang quản lý, lịch sử các số gần đây, và **banner người KINH ngay trong từng lượt** (tên, hàng, vị trí, tiền thưởng).
- Cả hai trang nhận cùng dữ liệu realtime từ server; không cần cấu hình thêm.

## Font chữ
- **Be Vietnam Pro** (thiết kế riêng cho tiếng Việt, đầy đủ dấu) cho toàn bộ nội dung.
- **Baloo 2** (nét bo tròn, vui tươi hợp ngày Tết) cho tiêu đề, số xổ to, nút bấm và số trên vé.
- Font được lưu locally tại `public/fonts/` → **chạy LAN không cần internet**.

## Lưu ý mạng
- Cổng **3000** (đổi bằng biến `PORT`). Điện thoại cùng mạng, firewall cho phép cổng 3000.
- QR dùng IP LAN đầu tiên (`getLocalIP()` trong `server.js`).
