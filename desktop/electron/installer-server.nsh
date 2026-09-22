!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Install-WindowsService.ps1" -Upgrade'
  nsExec::ExecToLog 'sc.exe config FOTPOSServer start= auto'
  nsExec::ExecToLog 'sc.exe start FOTPOSServer'
  nsExec::ExecToLog 'schtasks.exe /Create /TN "FOTPOSServerBoot" /TR "sc.exe start FOTPOSServer" /SC ONSTART /RU SYSTEM /RL HIGHEST /F'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS API (TCP 5000)" dir=in action=allow protocol=TCP localport=5000 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS LAN Discovery (UDP 49500)" dir=in action=allow protocol=UDP localport=49500 profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS Server App" dir=in action=allow program="$INSTDIR\FOT POS Server.exe" enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FOT POS API Exe" dir=in action=allow program="$INSTDIR\Api\FOT.Pos.Api.exe" enable=yes profile=any'
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "FOTPOSServerAdmin"
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Uninstall-WindowsService.ps1"'
  nsExec::ExecToLog 'schtasks.exe /Delete /TN "FOTPOSServerBoot" /F'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FOT POS Server App"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FOT POS API Exe"'
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "FOTPOSServerAdmin"
!macroend
