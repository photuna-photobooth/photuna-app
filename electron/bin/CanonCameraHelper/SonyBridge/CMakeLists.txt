# Photuna's bridge to Sony's Camera Remote SDK. Build with scripts/build-sony-bridge.ps1,
# which passes SONY_SDK_DIR (the unpacked RemoteCli folder) and builds into sdk/_build.
cmake_minimum_required(VERSION 3.21)
project(PhotunaSonyBridge LANGUAGES CXX)

if(NOT SONY_SDK_DIR)
    message(FATAL_ERROR "Set SONY_SDK_DIR to Sony's RemoteCli folder (contains app/CRSDK and external/crsdk).")
endif()

# Static C runtime, as Sony's sample uses: the bridge adds no runtime dependency.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_library(photuna_sony_bridge SHARED photuna_sony_bridge.cpp)

set_target_properties(photuna_sony_bridge PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS NO
)

# SYSTEM: Sony's headers are external, so /W4 applies to Photuna's code only.
target_include_directories(photuna_sony_bridge SYSTEM PRIVATE "${SONY_SDK_DIR}/app/CRSDK")
target_compile_definitions(photuna_sony_bridge PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_compile_options(photuna_sony_bridge PRIVATE /W4 /guard:cf)
target_link_options(photuna_sony_bridge PRIVATE /GUARD:CF)
target_link_libraries(photuna_sony_bridge PRIVATE "${SONY_SDK_DIR}/external/crsdk/Cr_Core.lib")
