!macro customInstall
  CreateDirectory "$SMPROGRAMS\FOT POS"
  CreateShortCut "$SMPROGRAMS\FOT POS\FOT POS Cashier.lnk" "$INSTDIR\FOT POS.exe" "--pos"
  CreateShortCut "$SMPROGRAMS\FOT POS\FOT POS Admin.lnk" "$INSTDIR\FOT POS.exe" "--admin"
  CreateShortCut "$DESKTOP\FOT POS Cashier.lnk" "$INSTDIR\FOT POS.exe" "--pos"
  nsExec::ExecToLog 'cmd /c sc.exe query FOTPOSServer >nul 2>&1 && sc.exe start FOTPOSServer'
!macroend
