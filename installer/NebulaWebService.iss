#define MyAppPublisher "Future of Technology"
#define MyAppDisplayName "NebulaWebService (ماستر كارد PAX)"
#define SourceDir "..\publish\nebula-package"

[Setup]
AppId={{A4E8B921-6F03-4D12-9C7E-1B2C3D4E5F6A}}
AppName={#MyAppDisplayName}
AppVersion=1.0.0
AppPublisher={#MyAppPublisher}
DefaultDirName={pf32}\NebulaWebService
DefaultGroupName=FOT POS
DisableProgramGroupPage=yes
OutputDir=..\publish\installers
OutputBaseFilename=NebulaWebService-Setup
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=no
UninstallDisplayName={#MyAppDisplayName}

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\NebulaWebService\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.log"
Source: "{#SourceDir}\Install-NebulaWebService.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\تشغيل خدمة الماستر كارد"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Service NebulaWebService"""; WorkingDir: "{app}"
Name: "{group}\إعادة تثبيت الخدمة"; Filename: "{app}\Install-NebulaWebService.bat"; WorkingDir: "{app}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Install-NebulaWebService.ps1"" -SkipCopy -TargetDir ""{app}"""; StatusMsg: "جاري تثبيت خدمة الماستر كارد..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Stop-Service NebulaWebService -Force -ErrorAction SilentlyContinue; if (Test-Path '{app}\webservice64.exe') {{ & '{app}\webservice64.exe' uninstall }}"""; Flags: runhidden waituntilterminated
