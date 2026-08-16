cmake_minimum_required(VERSION 3.13)

# The library name must stay `appmodules`: with the New Architecture enabled,
# ReactNativeApplicationEntryPoint loads `libappmodules.so` at startup.
project(appmodules)

# Builds appmodules from React Native's default OnLoad.cpp plus the autolinking
# glue, and links it against JSI/Fabric/TurboModules.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# Depot's C++ core stays in its own `libdepot_jni.so` (DepotNative loads it by
# name, and it declares its own JNI_OnLoad, so it must not be merged into
# appmodules).
add_subdirectory(
  ${CMAKE_CURRENT_SOURCE_DIR}/../cpp
  ${CMAKE_CURRENT_BINARY_DIR}/depot
)
