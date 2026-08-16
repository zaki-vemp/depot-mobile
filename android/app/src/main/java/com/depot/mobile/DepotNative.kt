package com.depot.mobile

object DepotNative {
  init {
    System.loadLibrary("depot_jni")
  }

  external fun nativeConfigure(home: String, trash: String)

  external fun nativeCall(method: String, args: String): String

  external fun nativeBind(module: DepotModule)

  external fun nativeStartTransfer(id: String, from: String, to: String, op: String)

  external fun nativeCancelTransfer(id: String)
}
