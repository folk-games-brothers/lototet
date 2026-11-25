@echo off
chcp 65001 >nul
title XO LÔ TÔ TẾT - MÁY CHỦ
cd /d "%~dp0"
echo.
echo  ============================================
echo    XỔ LÔ TÔ TẾT - ĐANG KHỞI ĐỘNG MÁY CHỦ
echo  ============================================
echo.

if not exist "node_modules" (
  echo  Chưa có node_modules - đang cài đặt dependencies lần đầu...
  call npm install
  if errorlevel 1 (
    echo  ❌ Cài đặt thất bại. Kiểm tra lại Node.js / kết nối mạng.
    pause
    exit /b 1
  )
)

echo.
set /p "OPEN_PAGES=Bạn có muốn tự động mở sẵn 3 trang (Admin, TV, Người chơi) trên trình duyệt không? (Y/N): "
if /I "%OPEN_PAGES%"=="Y" (
  echo  🚀 Khởi động server và mở sẵn 3 trang...
  call npm run start:open
) else (
  echo  🚀 Khởi động server (không tự mở trình duyệt)...
  call npm start
)
pause
