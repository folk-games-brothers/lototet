@echo off
chcp 65001 >nul
title XO LÔ TÔ TẾT - KHỞI ĐỘNG
cd /d "%~dp0"
echo  Đang gọi luồng khởi động trong thư mục backend...
call "%~dp0backend\Chay-May-Chu.cmd"
