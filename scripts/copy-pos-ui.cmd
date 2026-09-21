@echo off
set SRC=c:\Users\Future of Technology\Documents\pos\web\fot-pos\dist
set DST=C:\Program Files\FOT POS Cashier\resources\fot-pos
if not exist "%DST%\assets" mkdir "%DST%\assets"
copy /Y "%SRC%\index.html" "%DST%\index.html"
copy /Y "%SRC%\assets\*" "%DST%\assets\"
echo DONE
