!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS Cashier App" dir=in action=allow program="$INSTDIR\FOT POS Cashier.exe" enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS LAN Discovery (UDP 49500)" dir=in action=allow protocol=UDP localport=49500 profile=any'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FOT POS Cashier App"'
!macroend
