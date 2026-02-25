/**
 * HFT Cash v6 - Ghost-Mode Kernel Execution Layer
 * Targets <5ms Kernel Execution latency via WM_LBUTTONDOWN/UP to Webull Desktop HWND.
 * Windows-only: Requires Win32 API. Stub on non-Windows.
 */
#include <napi.h>

#ifdef _WIN32
#include <windows.h>

static const char* WINDOW_TITLES[] = {"Webull Desktop", "Webull", NULL};

static HWND FindWebullWindow() {
  for (int i = 0; WINDOW_TITLES[i]; i++) {
    HWND h = FindWindowA(NULL, WINDOW_TITLES[i]);
    if (h) return h;
  }
  return NULL;
}
#endif

Napi::Boolean ExecuteClick(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int x = 0, y = 0;
  if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
    x = info[0].As<Napi::Number>().Int32Value();
    y = info[1].As<Napi::Number>().Int32Value();
  }

#ifdef _WIN32
  HWND hwnd = FindWebullWindow();
  if (!hwnd) return Napi::Boolean::New(env, false);
  LPARAM lparam = MAKELPARAM(x, y);
  SendMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lparam);
  SendMessage(hwnd, WM_LBUTTONUP, 0, lparam);
  return Napi::Boolean::New(env, true);
#else
  (void)x; (void)y;
  return Napi::Boolean::New(env, false);
#endif
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("executeClick", Napi::Function::New(env, ExecuteClick));
  return exports;
}

NODE_API_MODULE(webull_ghost, Init)
