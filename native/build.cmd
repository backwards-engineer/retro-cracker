@echo off
setlocal
cd /d "%~dp0"
if not exist build mkdir build
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath`) do set "LAB_VS=%%i"
if not defined LAB_VS exit /b 1
call "%LAB_VS%\VC\Auxiliary\Build\vcvars32.bat"
if errorlevel 1 exit /b 1
for %%i in (0 1 2) do (
  cl /nologo /Od /Ob0 /Oy- /Zi /W4 /DCASE=%%i /FAcs /Fabuild\case%%i.asm /Fobuild\case%%i.obj /Fdbuild\case%%i.pdb /Febuild\case%%i.exe crackme.c user32.lib gdi32.lib /link /SUBSYSTEM:WINDOWS /INCREMENTAL:NO /OPT:NOREF /OPT:NOICF
  if errorlevel 1 exit /b 1
  dumpbin /DISASM build\case%%i.exe > build\case%%i.disasm.txt
)
echo Built three x86 crackmes with optimization disabled.
