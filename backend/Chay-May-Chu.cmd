@echo off
chcp 65001 >nul
title XO LÔ TÔ TẾT - MAY CHU
cd /d "%~dp0"
echo.
echo  ============================================
echo    XO LÔ TÔ TẾT - DANG KHOI DONG MAY CHU
echo  ============================================
echo.
if not exist "node_modules" (
  echo  Dang cai dat dependencies lan dau...
  call npm install
)
echo.
echo  Mo trinh duyet: http://localhost:3000
echo  Dien thoai quet ma QR tren man hinh chinh.
echo.
call npm start
pause
