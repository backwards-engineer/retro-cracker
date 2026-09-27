/* Original educational crackme. Build x86 with /Od; no third-party target. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#ifndef CASE
#define CASE 0
#endif
static const char *titles[] = {"PixelPaint Pro", "Orbit Racer 2000", "WaveStudio 2.4"};
static const char *messages[] = {"This copy of PixelPaint Pro is not registered.\r\nPlease enter your registration key to continue.", "Please insert the Orbit Racer 2000 CD-ROM\r\ninto drive D: and try again.", "Your 30-day evaluation period has ended.\r\nPlease register WaveStudio to continue."};
static HWND statusText, keyEdit;
static int captureMode;
static const char *capturePath;
__declspec(noinline) int CheckSerial(const char *key) { return strcmp(key, "PIXEL-1997-LAB") == 0; }
__declspec(noinline) int FindGameDisc(void) { volatile int discPresent = 0; return discPresent; }
__declspec(noinline) int TrialDaysRemaining(void) { volatile int days = 0; return days; }
__declspec(noinline) int RegistrationGate(const char *key) {
    int valid = CheckSerial(key);
    __asm {
        mov eax, valid
        test eax, eax
        jnz accepted
        xor eax, eax
        jmp done
    accepted:
        mov eax, 1
    done:
        mov valid, eax
    }
    return valid;
}
__declspec(noinline) int DiscGate(void) {
    int valid = FindGameDisc();
    __asm {
        mov eax, valid
        cmp eax, eax
        test al, al
        jnz accepted
        xor eax, eax
        jmp done
    accepted:
        mov eax, 1
    done:
        mov valid, eax
    }
    return valid;
}
__declspec(noinline) int TrialGate(const char *key) {
    if (TrialDaysRemaining() == 0) return 0;
    return RegistrationGate(key);
}
static int allowed(const char *key) {
    if (CASE == 0) return RegistrationGate(key);
    if (CASE == 1) return DiscGate();
    return TrialGate(key);
}
/* Save a screenshot of this application's own window, for the web lab. */
static int capture(HWND window, const char *path) {
    RECT r; HDC screen, memory; HBITMAP bitmap; BITMAPINFO info; BITMAPFILEHEADER fileHeader;
    DWORD bytes, written; void *pixels; HANDLE file; BOOL rendered;
    GetWindowRect(window, &r);
    ZeroMemory(&info, sizeof(info)); info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth=r.right-r.left; info.bmiHeader.biHeight=-(r.bottom-r.top);
    info.bmiHeader.biPlanes=1; info.bmiHeader.biBitCount=32; info.bmiHeader.biCompression=BI_RGB;
    screen=GetDC(window); memory=CreateCompatibleDC(screen);
    bitmap=CreateDIBSection(screen,&info,DIB_RGB_COLORS,&pixels,NULL,0); SelectObject(memory,bitmap);
    rendered=PrintWindow(window,memory,0);
    bytes=info.bmiHeader.biWidth*(-info.bmiHeader.biHeight)*4;
    ZeroMemory(&fileHeader,sizeof(fileHeader)); fileHeader.bfType=0x4d42;
    fileHeader.bfOffBits=sizeof(fileHeader)+sizeof(BITMAPINFOHEADER);fileHeader.bfSize=fileHeader.bfOffBits+bytes;
    file=CreateFileA(path,GENERIC_WRITE,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE||!rendered) { DeleteDC(memory);DeleteObject(bitmap);ReleaseDC(window,screen);return 0; }
    WriteFile(file,&fileHeader,sizeof(fileHeader),&written,NULL);
    WriteFile(file,&info.bmiHeader,sizeof(BITMAPINFOHEADER),&written,NULL);
    WriteFile(file,pixels,bytes,&written,NULL);CloseHandle(file);
    DeleteDC(memory);DeleteObject(bitmap);ReleaseDC(window,screen);return 1;
}
static LRESULT CALLBACK WindowProc(HWND w, UINT msg, WPARAM wp, LPARAM lp) {
    if(msg==WM_CREATE) {
        HFONT font=(HFONT)GetStockObject(DEFAULT_GUI_FONT); HWND child;
        statusText=CreateWindowA("STATIC",messages[CASE],WS_CHILD|WS_VISIBLE,22,24,350,45,w,NULL,NULL,NULL);
        SendMessage(statusText,WM_SETFONT,(WPARAM)font,TRUE);
        child=CreateWindowA("STATIC",CASE==0?"Registration key:":CASE==1?"Drive: D:   [ no disc detected ]":"Evaluation: 30 / 30 days",WS_CHILD|WS_VISIBLE,22,85,350,20,w,NULL,NULL,NULL);
        SendMessage(child,WM_SETFONT,(WPARAM)font,TRUE);
        keyEdit=CreateWindowExA(WS_EX_CLIENTEDGE,"EDIT","0000-0000-0000-0000",WS_CHILD|WS_VISIBLE|ES_AUTOHSCROLL,22,110,346,25,w,NULL,NULL,NULL);
        SendMessage(keyEdit,WM_SETFONT,(WPARAM)font,TRUE);if(CASE!=0)ShowWindow(keyEdit,SW_HIDE);
        child=CreateWindowA("BUTTON",CASE==1?"Retry":"Register",WS_CHILD|WS_VISIBLE|BS_DEFPUSHBUTTON,184,158,86,26,w,(HMENU)1,NULL,NULL);
        SendMessage(child,WM_SETFONT,(WPARAM)font,TRUE);
        child=CreateWindowA("BUTTON","Cancel",WS_CHILD|WS_VISIBLE,280,158,86,26,w,(HMENU)2,NULL,NULL);
        SendMessage(child,WM_SETFONT,(WPARAM)font,TRUE);
        child=CreateWindowA("STATIC","Original educational software - Cracklab",WS_CHILD|WS_VISIBLE,22,206,350,20,w,NULL,NULL,NULL);
        SendMessage(child,WM_SETFONT,(WPARAM)font,TRUE);
        if(captureMode)SetTimer(w,1,400,NULL);
        return 0;
    }
    if(msg==WM_TIMER&&captureMode){KillTimer(w,1);int ok=capture(w,capturePath);DestroyWindow(w);PostQuitMessage(ok?0:2);return 0;}
    if(msg==WM_COMMAND){if(LOWORD(wp)==2)DestroyWindow(w);if(LOWORD(wp)==1){char key[128];GetWindowTextA(keyEdit,key,sizeof(key));SetWindowTextA(statusText,allowed(key)?"Thank you! Full application unlocked.":messages[CASE]);}return 0;}
    if(msg==WM_DESTROY){PostQuitMessage(0);return 0;}
    return DefWindowProc(w,msg,wp,lp);
}
int WINAPI WinMain(HINSTANCE instance,HINSTANCE previous,LPSTR command,int show) {
    WNDCLASSA cls; HWND w; MSG msg; (void)previous;
    if(!strcmp(command,"--self-test"))return allowed("0000-0000-0000-0000")?1:0;
    if(!strncmp(command,"--capture ",10)){captureMode=1;capturePath=command+10;}
    ZeroMemory(&cls,sizeof(cls));cls.lpfnWndProc=WindowProc;cls.hInstance=instance;
    cls.lpszClassName="CracklabNative";cls.hbrBackground=(HBRUSH)(COLOR_BTNFACE+1);cls.hCursor=LoadCursor(NULL,IDC_ARROW);
    RegisterClassA(&cls);
    w=CreateWindowExA(0,cls.lpszClassName,titles[CASE],WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU,0,0,405,280,NULL,NULL,instance,NULL);
    if(!w)return 2;
    ShowWindow(w,captureMode?SW_SHOWNOACTIVATE:show);UpdateWindow(w);
    while(GetMessage(&msg,NULL,0,0)>0){TranslateMessage(&msg);DispatchMessage(&msg);}return (int)msg.wParam;
}
