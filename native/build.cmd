@echo off
rem Compile HearMeOutHelper.exe with the C# compiler that ships in Windows.
rem No SDK, no Visual Studio, no download needed: csc v4.0.30319 is on every
rem Windows 10/11 machine. Output lands in ..\bin\helper\.

setlocal
set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo error: csc.exe not found under %SystemRoot%\Microsoft.NET
  exit /b 1
)

if not exist "%~dp0..\bin\helper" mkdir "%~dp0..\bin\helper"

"%CSC%" /nologo /target:winexe /optimize+ /out:"%~dp0..\bin\helper\HearMeOutHelper.exe" /r:System.dll /r:System.Windows.Forms.dll "%~dp0HearMeOutHelper.cs"

if errorlevel 1 exit /b 1
echo built bin\helper\HearMeOutHelper.exe
endlocal
