cmake_minimum_required(VERSION 3.22)

add_subdirectory(
  ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../native/core
  ${CMAKE_CURRENT_BINARY_DIR}/depot_core
)

add_library(depot_jni SHARED depot_jni.cpp)
target_link_libraries(depot_jni PRIVATE depot_core)
