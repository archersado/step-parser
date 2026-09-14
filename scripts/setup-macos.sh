#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != Darwin ]; then
    echo "This script requires macOS and Xcode Command Line Tools." >&2
    exit 1
fi
xcode-select -p >/dev/null

deps="$PWD/.local-build"
mkdir -p "$deps/downloads"

download_extract() {
    local name="$1" url="$2" directory="$3"
    if [ ! -d "$deps/$directory" ]; then
        curl -fL --retry 2 "$url" -o "$deps/downloads/$name.tar.gz"
        tar -xzf "$deps/downloads/$name.tar.gz" -C "$deps"
    fi
}

download_extract cmake-3.31.8 \
    https://github.com/Kitware/CMake/releases/download/v3.31.8/cmake-3.31.8-macos-universal.tar.gz \
    cmake-3.31.8-macos-universal
download_extract occt-7.9.3 \
    https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_9_3.tar.gz \
    OCCT-7_9_3
download_extract rapidjson \
    https://github.com/Tencent/rapidjson/archive/8f4c021fa2f1e001d2376095928fc0532adf2ae6.tar.gz \
    rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6
download_extract draco-1.5.7 \
    https://github.com/google/draco/archive/refs/tags/1.5.7.tar.gz \
    draco-1.5.7
download_extract meshoptimizer-0.25 \
    https://github.com/zeux/meshoptimizer/archive/refs/tags/v0.25.tar.gz \
    meshoptimizer-0.25

cmake="$deps/cmake-3.31.8-macos-universal/CMake.app/Contents/bin/cmake"
"$cmake" -S "$deps/meshoptimizer-0.25" -B "$deps/meshoptimizer-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/meshoptimizer"
"$cmake" --build "$deps/meshoptimizer-build" --parallel "${JOBS:-8}"
"$cmake" --install "$deps/meshoptimizer-build"
# OCCT 7.9.3 omits the Draco point count, crashing the high-compression encoder.
if ! grep -q 'aMesh.set_num_points' "$deps/OCCT-7_9_3/src/RWGltf/RWGltf_CafWriter.cxx"; then
    patch -d "$deps/OCCT-7_9_3" -p1 < scripts/occt-draco.patch
fi
"$cmake" -S "$deps/draco-1.5.7" -B "$deps/draco-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/draco" \
    -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DDRACO_TESTS=OFF -DDRACO_TRANSCODER_SUPPORTED=OFF -DDRACO_GLTF_BITSTREAM=ON
"$cmake" --build "$deps/draco-build" --parallel "${JOBS:-8}"
"$cmake" --install "$deps/draco-build"
"$cmake" -S "$deps/OCCT-7_9_3" -B "$deps/occt-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/occt" \
    -DCMAKE_EXPORT_NO_PACKAGE_REGISTRY=ON \
    -DINSTALL_DIR_LAYOUT=Unix -DINSTALL_NAME_DIR=@rpath \
    -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingData=OFF \
    -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_Visualization=OFF \
    -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_DataExchange=OFF \
    -DBUILD_MODULE_DETools=OFF -DBUILD_MODULE_Draw=OFF \
    '-DBUILD_ADDITIONAL_TOOLKITS=TKDESTEP;TKDEGLTF' \
    -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF -DUSE_TCL=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF \
    -DUSE_RAPIDJSON=ON -DUSE_DRACO=ON -D3RDPARTY_DRACO_DIR="$deps/draco" \
    -D3RDPARTY_RAPIDJSON_DIR="$deps/rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6"
"$cmake" --build "$deps/occt-build" --parallel "${JOBS:-8}"
"$cmake" --install "$deps/occt-build"
make -B release
