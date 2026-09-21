#include "version.issinc"
#define MyAppPublisher "Future of Technology"
#define MyAppDisplayName "FOT POS Server"
#define MyAppUninstallId "{8C3E9A21-7F04-4B55-9D2E-A1B2C3D4E5F1}"
#define SourceDir "..\publish\desktop\FOT-POS-Server"
#include "FOT-POS-Upgrade-Messages.issinc"

[Setup]
AppId={{8C3E9A21-7F04-4B55-9D2E-A1B2C3D4E5F1}
AppName={#MyAppDisplayName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppDisplayName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright=Copyright © Future of Technology
DefaultDirName={autopf}\FOT POS\Server
DefaultGroupName=FOT POS
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=..\publish\installers
OutputBaseFilename=FOT-POS-Server-Setup
SetupIconFile=..\assets\branding\fot-pos-server.ico
UninstallDisplayIcon={app}\FOT.Pos.Server.exe
UninstallDisplayName={#MyAppDisplayName}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=force
RestartApplications=no
LanguageDetectionMethod=uilanguage
ShowLanguageDialog=no
UsePreviousAppDir=yes
UsePreviousGroup=yes
UpdateUninstallLogAppName=yes
VersionInfoVersion={#MyAppVersionFull}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoProductName={#MyAppDisplayName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=مثبت/محدّث FOT POS Server

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "إنشاء اختصارات على سطح المكتب"; GroupDescription: "اختصارات:"; Flags: checkedonce
Name: "launchserver"; Description: "تشغيل مراقب الخادم بعد التثبيت"; GroupDescription: "بعد الانتهاء:"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\Api\appsettings.json"; DestDir: "{app}\Api"; Flags: onlyifdoesntexist
Source: "{#SourceDir}\Api\appsettings.Development.json"; DestDir: "{app}\Api"; Flags: onlyifdoesntexist skipifsourcedoesntexist
Source: "{#SourceDir}\Admin\appsettings.json"; DestDir: "{app}\Admin"; Flags: onlyifdoesntexist skipifsourcedoesntexist
Source: "{#SourceDir}\Client\appsettings.json"; DestDir: "{app}\Client"; Flags: onlyifdoesntexist
Source: "{#SourceDir}\appsettings.json"; DestDir: "{app}"; Flags: onlyifdoesntexist skipifsourcedoesntexist
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,createdump.exe"

[Icons]
Name: "{group}\الخادم الرئيسي"; Filename: "{app}\FOT.Pos.Server.exe"
Name: "{group}\لوحة التحكم"; Filename: "{app}\Admin\FOT.Pos.Admin.exe"; WorkingDir: "{app}\Admin"
Name: "{group}\نقطة البيع"; Filename: "{app}\Client\FOT.Pos.Client.exe"; WorkingDir: "{app}\Client"
Name: "{autodesktop}\FOT POS Server"; Filename: "{app}\FOT.Pos.Server.exe"; Tasks: desktopicon
Name: "{autodesktop}\FOT POS لوحة التحكم"; Filename: "{app}\Admin\FOT.Pos.Admin.exe"; WorkingDir: "{app}\Admin"; Tasks: desktopicon
Name: "{autodesktop}\FOT POS نقطة البيع"; Filename: "{app}\Client\FOT.Pos.Client.exe"; WorkingDir: "{app}\Client"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Install-WindowsService.ps1"" -Upgrade"; Flags: runhidden waituntilterminated; StatusMsg: "جاري التحديث…"; Check: IsUpgrade
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Install-WindowsService.ps1"""; Flags: runhidden waituntilterminated; StatusMsg: "جاري التثبيت…"; Check: IsFreshInstall
Filename: "{app}\FOT.Pos.Server.exe"; Description: "تشغيل مراقب الخادم الآن"; Flags: nowait postinstall skipifsilent; Tasks: launchserver

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Uninstall-WindowsService.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "FOTPOSUninstallSvc"

[Code]
#include "FOT-POS-Upgrade-Code.issinc"

var
  PrevAppVersion: String;

function AppDisplayName(): String;
begin
  Result := ExpandConstant('{#MyAppDisplayName}');
end;

function InitializeSetup(): Boolean;
begin
  PrevAppVersion := GetInstalledVersion();
  if IsUpgrade and (CompareVersion(PrevAppVersion, ExpandConstant('{#MyAppVersion}')) = 0) then
  begin
    if MsgBox(FmtMessage(CustomMessage('FOTSameVersionPrompt'), [AppDisplayName(), PrevAppVersion]),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDNO then
    begin
      Result := False;
      Exit;
    end;
  end;
  Result := True;
end;

procedure ApplyWizardTexts();
var
  Cap, Title, Body: String;
begin
  if IsUpgrade then
  begin
    Cap := FmtMessage(CustomMessage('FOTUpgradeCaption'), [AppDisplayName()]);
    Title := FmtMessage(CustomMessage('FOTUpgradeWelcomeTitle'), [AppDisplayName()]);
    Body := FmtMessage(CustomMessage('FOTUpgradeWelcomeBody'), [AppDisplayName(), PrevAppVersion, '{#MyAppVersion}', CustomMessage('FOTReleaseNotes')]);
  end
  else
  begin
    Cap := FmtMessage(CustomMessage('FOTInstallCaption'), [AppDisplayName()]);
    Title := FmtMessage(CustomMessage('FOTInstallWelcomeTitle'), [AppDisplayName()]);
    Body := FmtMessage(CustomMessage('FOTInstallWelcomeBody'), [AppDisplayName(), '', '{#MyAppVersion}', CustomMessage('FOTReleaseNotes')]);
  end;
  WizardForm.Caption := Cap;
  WizardForm.WelcomeLabel1.Caption := Title;
  WizardForm.WelcomeLabel2.Caption := Body;
end;

procedure InitializeWizard();
begin
  ApplyWizardTexts();
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpgrade and (PageID = wpSelectDir);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    if IsUpgrade then
    begin
      WizardForm.ReadyLabel.Caption := CustomMessage('FOTUpgradeReadyLabel');
      WizardForm.NextButton.Caption := CustomMessage('FOTUpdateButton');
    end
    else
    begin
      WizardForm.ReadyLabel.Caption := CustomMessage('FOTInstallReadyLabel');
      WizardForm.NextButton.Caption := CustomMessage('FOTInstallButton');
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    if IsUpgrade then
      WizardForm.StatusLabel.Caption := CustomMessage('FOTUpgradeStatus')
    else
      WizardForm.StatusLabel.Caption := CustomMessage('FOTInstallStatus');
  end;
  if CurStep = ssPostInstall then
  begin
    if IsUpgrade then
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('FOTUpgradeFinished'), [AppDisplayName(), PrevAppVersion, '{#MyAppVersion}'])
    else
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('FOTInstallFinished'), [AppDisplayName(), '', '{#MyAppVersion}']);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe', '-NoProfile -Command "Stop-Service -Name FOTPOSServer -Force -ErrorAction SilentlyContinue; Get-Process FOT.Pos.Api,FOT.Pos.Server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
