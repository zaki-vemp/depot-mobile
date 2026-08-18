cmake_minimum_required(VERSION 3.22)
project(depot_core CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(depot_core STATIC
  src/files.cpp
  src/transfers.cpp
  src/git.cpp
  src/terminal.cpp
  src/api.cpp
)

target_include_directories(depot_core PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_compile_options(depot_core PRIVATE -Wall -Wextra)

if(ANDROID)
  find_library(log-lib log)
  target_link_libraries(depot_core PUBLIC ${log-lib})
endif()
