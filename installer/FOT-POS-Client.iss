#include "version.issinc"
#define MyAppPublisher "Future of Technology"
#define MyAppDisplayName "FOT POS نقطة البيع"
#define MyAppUninstallId "{8C3E9A21-7F04-4B55-9D2E-A1B2C3D4E5F3}"
#define SourceDir "..\publish\desktop\FOT-POS-Client"
#include "FOT-POS-Upgrade-Messages.issinc"

[Setup]
AppId={{8C3E9A21-7F04-4B55-9D2E-A1B2C3D4E5F3}
AppName={#MyAppDisplayName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppDisplayName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\FOT POS\Client
DefaultGroupName=FOT POS
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=..\publish\installers
OutputBaseFilename=FOT-POS-Client-Setup
SetupIconFile=..\assets\branding\fot-pos-client.ico
UninstallDisplayIcon={app}\FOT.Pos.Client.exe
UninstallDisplayName={#MyAppDisplayName}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=force
LanguageDetectionMethod=uilanguage
ShowLanguageDialog=no
UsePreviousAppDir=yes
UsePreviousGroup=yes
UpdateUninstallLogAppName=yes
VersionInfoVersion={#MyAppVersionFull}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoProductName=FOT POS Client
VersionInfoCompany={#MyAppPublisher}

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "إنشاء اختصار على سطح المكتب"; GroupDescription: "اختصارات:"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\appsettings.json"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,createdump.exe"

[Icons]
Name: "{group}\نقطة البيع"; Filename: "{app}\FOT.Pos.Client.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\FOT POS نقطة البيع"; Filename: "{app}\FOT.Pos.Client.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\FOT.Pos.Client.exe"; Description: "تشغيل نقطة البيع الآن"; Flags: nowait postinstall skipifsilent

[Code]
#include "FOT-POS-Upgrade-Code.issinc"

var
  PrevAppVersion: String;
  ServerPage: TInputQueryWizardPage;

function AppDisplayName(): String;
begin
  Result := ExpandConstant('{#MyAppDisplayName}');
end;

function TryLoadSavedServerUrl(): String;
var
  Path: String;
  Content: AnsiString;
  Marker, Rest: String;
  P: Integer;
begin
  Result := '';
  Path := ExpandConstant('{localappdata}\FOT.Pos\server-connection.json');
  if not FileExists(Path) then Exit;
  if LoadStringFromFile(Path, Content) then
  begin
    Marker := '"ServerUrl": "';
    P := Pos(Marker, Content);
    if P > 0 then
    begin
      Rest := Copy(Content, P + Length(Marker), MaxInt);
      P := Pos('"', Rest);
      if P > 0 then Result := Copy(Rest, 1, P - 1);
    end;
  end;
end;

function NormalizeUrl(Url: String): String;
begin
  Url := Trim(Url);
  if Url = '' then begin Result := 'http://192.168.75.1:5000'; Exit; end;
  if (Pos('http://', LowerCase(Url)) <> 1) and (Pos('https://', LowerCase(Url)) <> 1) then
    Url := 'http://' + Url;
  while (Length(Url) > 0) and (Url[Length(Url)] = '/') do
    Url := Copy(Url, 1, Length(Url) - 1);
  if Pos(':', Copy(Url, 8, MaxInt)) = 0 then Url := Url + ':5000';
  Result := Url;
end;

function InitializeSetup(): Boolean;
begin
  PrevAppVersion := GetInstalledVersion();
  if IsUpgrade and (CompareVersion(PrevAppVersion, '{#MyAppVersion}') = 0) then
  begin
    if MsgBox(FmtMessage(CustomMessage('FOTSameVersionPrompt'), [AppDisplayName(), PrevAppVersion]),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDNO then
    begin Result := False; Exit; end;
  end;
  Result := True;
end;

procedure ApplyWizardTexts();
var Cap, Title, Body: String;
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
var SavedUrl: String;
begin
  ServerPage := CreateInputQueryPage(wpReady, 'عنوان الخادم الرئيسي',
    'أدخل عنوان حاسبة السيرفر على الشبكة', 'مثال: 192.168.75.1  أو  http://192.168.75.1:5000');
  ServerPage.Add('عنوان السيرفر:', False);
  SavedUrl := TryLoadSavedServerUrl();
  if SavedUrl <> '' then ServerPage.Values[0] := SavedUrl
  else ServerPage.Values[0] := 'http://192.168.75.1:5000';
  ApplyWizardTexts();
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if IsUpgrade and (PageID = wpSelectDir) then Result := True;
  if IsUpgrade and (PageID = ServerPage.ID) and (TryLoadSavedServerUrl() <> '') then Result := True;
end;

procedure SaveServerUrl();
var Dir, Url, Json: String;
begin
  if IsUpgrade and (TryLoadSavedServerUrl() <> '') then
    Exit;
  Url := NormalizeUrl(ServerPage.Values[0]);
  Dir := ExpandConstant('{localappdata}\FOT.Pos');
  ForceDirectories(Dir);
  Json := '{' + #13#10 + '  "ServerUrl": "' + Url + '"' + #13#10 + '}';
  SaveStringToFile(Dir + '\server-connection.json', Json, False);
  Json := '{' + #13#10 + '  "ApiBaseUrl": "' + Url + '",' + #13#10 + '  "ApiPort": 5000' + #13#10 + '}';
  SaveStringToFile(ExpandConstant('{app}\appsettings.json'), Json, False);
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
    if IsUpgrade then WizardForm.StatusLabel.Caption := CustomMessage('FOTUpgradeStatus')
    else WizardForm.StatusLabel.Caption := CustomMessage('FOTInstallStatus');
  end;
  if CurStep = ssPostInstall then
  begin
    SaveServerUrl();
    if IsUpgrade then
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('FOTUpgradeFinished'), [AppDisplayName(), PrevAppVersion, '{#MyAppVersion}'])
    else
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('FOTInstallFinished'), [AppDisplayName(), '', '{#MyAppVersion}']);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
  Exec('powershell.exe', '-NoProfile -Command "Get-Process FOT.Pos.Client -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
