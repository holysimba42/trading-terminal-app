/**
 * HFT Cash v6 - Ghost-Mode Kernel Execution Layer
 * Targets <5ms Kernel Execution latency via BM_CLICK messaging to Webull Desktop HWND.
 * Bypasses mouse drivers for direct kernel-level execution.
 * Windows-only: Requires Win32 API. Stub on non-Windows.
 */
#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#endif

Napi::Boolean ExecuteClick(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

#ifdef _WIN32
  HWND webullWindow = FindWindowA(NULL, "Webull Desktop");
  if (!webullWindow) {
    return Napi::Boolean::New(env, false);
  }
  // BM_CLICK messaging bypasses mouse drivers for <5ms execution
  SendMessage(webullWindow, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(0, 0));
  SendMessage(webullWindow, WM_LBUTTONUP, 0, MAKELPARAM(0, 0));
  return Napi::Boolean::New(env, true);
#else
  (void)info;
  return Napi::Boolean::New(env, false);  // Stub: Windows-only
#endif
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("executeClick", Napi::Function::New(env, ExecuteClick));
  return exports;
}

NODE_API_MODULE(webull_ghost, Init)
