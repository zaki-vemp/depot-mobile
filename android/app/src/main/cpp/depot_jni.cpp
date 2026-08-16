#include "depot/core.h"

#include <jni.h>

#include <string>

static JavaVM* g_vm = nullptr;
static jobject g_module = nullptr;
static jmethodID g_on_transfer = nullptr;

JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
  g_vm = vm;
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL Java_com_depot_mobile_DepotNative_nativeConfigure(JNIEnv* env, jclass,
                                                                                    jstring home, jstring trash) {
  const char* h = env->GetStringUTFChars(home, nullptr);
  const char* t = env->GetStringUTFChars(trash, nullptr);
  depot_configure(h, t);
  env->ReleaseStringUTFChars(home, h);
  env->ReleaseStringUTFChars(trash, t);
}

extern "C" JNIEXPORT jstring JNICALL Java_com_depot_mobile_DepotNative_nativeCall(JNIEnv* env, jclass, jstring method,
                                                                                 jstring args) {
  const char* m = env->GetStringUTFChars(method, nullptr);
  const char* a = env->GetStringUTFChars(args, nullptr);
  char* result = depot_call(m, a);
  env->ReleaseStringUTFChars(method, m);
  env->ReleaseStringUTFChars(args, a);
  jstring out = env->NewStringUTF(result ? result : "{\"ok\":false,\"error\":\"oom\"}");
  depot_free(result);
  return out;
}

extern "C" JNIEXPORT void JNICALL Java_com_depot_mobile_DepotNative_nativeBind(JNIEnv* env, jclass, jobject module) {
  if (g_module) {
    env->DeleteGlobalRef(g_module);
    g_module = nullptr;
  }
  g_module = env->NewGlobalRef(module);
  jclass cls = env->GetObjectClass(module);
  g_on_transfer = env->GetMethodID(cls, "onTransferNative", "(Ljava/lang/String;)V");
}

static void on_transfer_json(const char* json, void*) {
  if (!g_vm || !g_module || !g_on_transfer) {
    return;
  }
  JNIEnv* env = nullptr;
  bool attached = false;
  if (g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
      return;
    }
    attached = true;
  }
  jstring payload = env->NewStringUTF(json);
  env->CallVoidMethod(g_module, g_on_transfer, payload);
  env->DeleteLocalRef(payload);
  if (attached) {
    g_vm->DetachCurrentThread();
  }
}

extern "C" JNIEXPORT void JNICALL Java_com_depot_mobile_DepotNative_nativeStartTransfer(
    JNIEnv* env, jclass, jstring id, jstring from, jstring to, jstring op) {
  const char* i = env->GetStringUTFChars(id, nullptr);
  const char* f = env->GetStringUTFChars(from, nullptr);
  const char* t = env->GetStringUTFChars(to, nullptr);
  const char* o = env->GetStringUTFChars(op, nullptr);
  depot_start_transfer(i, f, t, o, on_transfer_json, nullptr);
  env->ReleaseStringUTFChars(id, i);
  env->ReleaseStringUTFChars(from, f);
  env->ReleaseStringUTFChars(to, t);
  env->ReleaseStringUTFChars(op, o);
}

extern "C" JNIEXPORT void JNICALL Java_com_depot_mobile_DepotNative_nativeCancelTransfer(JNIEnv* env, jclass,
                                                                                        jstring id) {
  const char* i = env->GetStringUTFChars(id, nullptr);
  depot_cancel_transfer(i);
  env->ReleaseStringUTFChars(id, i);
}
