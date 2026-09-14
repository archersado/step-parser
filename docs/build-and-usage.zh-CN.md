# step-parser：跨平台编译与使用

仓库名为 `step-parser`，命令行程序名仍为 `step2gltf`，Windows 原生程序名为 `step2gltf.exe`。
转换、装配合并、网格减面和 Draco 压缩均在 C++ 程序中执行；Node.js 只用于可选的浏览器预览。

## 1. 平台与验证状态

| 平台 | 构建方式 | 验证状态 |
| --- | --- | --- |
| macOS Apple Silicon | Apple Clang + `scripts/setup-macos.sh` + Make | 已在本机编译、回归测试和实际模型转换验证 |
| macOS Intel | 同一脚本，在 Intel 机器上重新编译 | 未实测 |
| Linux x86_64 / ARM64 | GCC + CMake 构建依赖，再使用 Make | 本文提供源码构建步骤，未在 Linux 实机验证 |
| Windows x64 原生 | Visual Studio 2022 / MSVC + CMake + PowerShell | 本文提供手工构建步骤，未在 Windows 实机验证 |
| Windows WSL 2 | Ubuntu 环境内按 Linux 步骤构建 | 未实测；产物是 Linux 程序，不是 Windows EXE |

文档依据当前 `main.cpp`、`preview.hxx`、`Makefile` 和固定版本依赖编写。当前仓库没有用于构建转换程序的 `CMakeLists.txt`，不能直接在项目根目录执行 `cmake -S . -B build`。

### 依赖版本

| 依赖 | 版本 / 要求 | 用途 |
| --- | --- | --- |
| C++ 编译器 | C++17，64 位 | 转换程序及依赖 |
| Open CASCADE Technology（OCCT） | 7.9.3，应用仓库中的 Draco 补丁 | STEP 读取、几何转换、网格化、glTF 导出 |
| Draco | 1.5.7，静态库 | glTF 几何压缩 |
| meshoptimizer | 0.25，静态库 | 深层设备网格减面 |
| RapidJSON | `8f4c021fa2f1e001d2376095928fc0532adf2ae6` | OCCT glTF JSON 支持 |
| CMake | 推荐 3.31.8，与 macOS 脚本一致 | 编译上述依赖；本文不覆盖 CMake 4 的兼容性 |
| Node.js / npm | 支持 `node --test` 的版本 | 仅预览页面依赖安装与测试 |
| Python 3 | 提供 `http.server` | 仅本地预览服务 |

本程序即使不传 `--preview`，编译时仍然需要 meshoptimizer。只安装系统的 OCCT 开发包不一定具备当前 API、Draco 支持及补丁，下面统一使用固定版本源码。

所有命令均从仓库根目录开始。构建路径建议不含空格，现有 Makefile 对带空格的路径支持不完整。
`.local-build/`、二进制及 `viewer/node_modules/` 不进入 Git；在不同系统、CPU 架构之间必须重新构建，不能复制 macOS 的依赖到 Windows/Linux 使用。

## 2. macOS

### 首次构建

安装 Xcode Command Line Tools，并等待安装结束：

```bash
xcode-select --install
```

进入项目目录执行：

```bash
bash scripts/setup-macos.sh
make check
./step2gltf --preview -v samples/piggy.step .local-build/piggy.glb
```

脚本下载依赖，在 `.local-build/` 下编译并安装，自动应用 `scripts/occt-draco.patch`，最后执行 Release 构建。不需要 Homebrew，也不安装到系统目录。
依赖下载需要网络；耗时取决于网络和机器性能。构建内存不足时降低并发：

```bash
JOBS=4 bash scripts/setup-macos.sh
```

`JOBS` 控制依赖编译并发，不控制模型转换线程数。脚本按当前机器架构构建，不生成同时包含 Intel 和 ARM 的通用二进制。

### 修改代码后

```bash
make release
make check
```

如果切换编译选项、依赖位置或移动整个项目，用 `make -B release` 强制重新链接，更新程序的动态库搜索路径。本次迁移后的本机目录已具备依赖，可以直接执行这些命令。

## 3. Linux（以 Ubuntu / Debian 为例）

下面需要 Bash、GCC、GNU Make、CMake、curl、tar 和 patch。其他发行版使用其包管理器安装对应工具，后续源码构建步骤相同。

### 安装工具、下载源码

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake curl ca-certificates patch
cmake --version
```

使用 CMake 3.x；如系统提供 CMake 4，请单独安装并使用 3.31.8。下列代码块在同一个 Bash 会话中依次执行：

```bash
set -euo pipefail
deps="$PWD/.local-build"
mkdir -p "$deps/downloads"

download_extract() {
    local name="$1" url="$2" directory="$3"
    if [ ! -d "$deps/$directory" ]; then
        curl -fL --retry 2 "$url" -o "$deps/downloads/$name.tar.gz"
        tar -xzf "$deps/downloads/$name.tar.gz" -C "$deps"
    fi
}

download_extract occt-7.9.3 \
    https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_9_3.tar.gz OCCT-7_9_3
download_extract rapidjson \
    https://github.com/Tencent/rapidjson/archive/8f4c021fa2f1e001d2376095928fc0532adf2ae6.tar.gz \
    rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6
download_extract draco-1.5.7 \
    https://github.com/google/draco/archive/refs/tags/1.5.7.tar.gz draco-1.5.7
download_extract meshoptimizer-0.25 \
    https://github.com/zeux/meshoptimizer/archive/refs/tags/v0.25.tar.gz meshoptimizer-0.25
```

### 编译 meshoptimizer、Draco 和 OCCT

```bash
cmake -S "$deps/meshoptimizer-0.25" -B "$deps/meshoptimizer-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/meshoptimizer" \
    -DCMAKE_INSTALL_LIBDIR=lib -DMESHOPT_BUILD_SHARED_LIBS=OFF
cmake --build "$deps/meshoptimizer-build" --parallel 4
cmake --install "$deps/meshoptimizer-build"

cmake -S "$deps/draco-1.5.7" -B "$deps/draco-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/draco" \
    -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DDRACO_TESTS=OFF -DDRACO_TRANSCODER_SUPPORTED=OFF -DDRACO_GLTF_BITSTREAM=ON
cmake --build "$deps/draco-build" --parallel 4
cmake --install "$deps/draco-build"

if ! grep -q 'aMesh.set_num_points' "$deps/OCCT-7_9_3/src/RWGltf/RWGltf_CafWriter.cxx"; then
    patch -d "$deps/OCCT-7_9_3" -p1 < scripts/occt-draco.patch
fi

cmake -S "$deps/OCCT-7_9_3" -B "$deps/occt-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$deps/occt" \
    -DCMAKE_EXPORT_NO_PACKAGE_REGISTRY=ON \
    -DBUILD_LIBRARY_TYPE=Shared -DINSTALL_DIR_LAYOUT=Unix \
    -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingData=OFF \
    -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_Visualization=OFF \
    -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_DataExchange=OFF \
    -DBUILD_MODULE_DETools=OFF -DBUILD_MODULE_Draw=OFF \
    '-DBUILD_ADDITIONAL_TOOLKITS=TKDESTEP;TKDEGLTF' \
    -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF -DUSE_TCL=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF \
    -DUSE_RAPIDJSON=ON -DUSE_DRACO=ON -D3RDPARTY_DRACO_DIR="$deps/draco" \
    -D3RDPARTY_RAPIDJSON_DIR="$deps/rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6"
cmake --build "$deps/occt-build" --parallel 4
cmake --install "$deps/occt-build"
```

补丁补全 OCCT 7.9.3 编码前的 Draco 点数，避免高压缩模式崩溃。`BUILD_ADDITIONAL_TOOLKITS` 会带入 STEP/glTF 工具包的必要依赖；不需要图形桌面来运行转换程序。配置变量可参考 [OCCT 源码构建文档](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_9_3/dox/build/build_occt/building_occt.md)。

### 编译转换程序并检查

```bash
export LD_LIBRARY_PATH="$deps/occt/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
make -B release
make check
./step2gltf --preview -v samples/piggy.step .local-build/piggy.glb
```

`LD_LIBRARY_PATH` 让加载器同时找到 OCCT 的间接依赖。新终端中先进入项目目录，再执行：

```bash
export LD_LIBRARY_PATH="$PWD/.local-build/occt/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

部署时需要可执行文件和该平台编译的 OCCT 动态库；Draco 与 meshoptimizer 在上述配置下静态链接。移动目录后重新链接或显式设置动态库路径，不能只复制一个可执行文件。

## 4. Windows

### 方式 A：WSL 2

以管理员身份在 PowerShell 执行，按提示重启并完成 Ubuntu 用户初始化：

```powershell
wsl --install -d Ubuntu
```

这是 Microsoft 提供的 [WSL 安装方式](https://learn.microsoft.com/en-us/windows/wsl/install)。进入 Ubuntu 后，按第 3 节构建；运行方式也与 Linux 相同。建议把源码及大型模型放在 WSL 的 Linux 文件系统中。

如果模型位于 Windows 的 `C:\models\input.STEP`，在 WSL 中可使用：

```bash
./step2gltf --preview -v /mnt/c/models/input.STEP .local-build/output.glb
```

此方式不产生可直接在普通 Windows 终端运行的 `.exe`。需要 Windows 原生部署时使用下面的方式 B。

### 方式 B：Windows x64 原生（待实机验证）

准备 Visual Studio 2022 或 Build Tools 2022，安装“使用 C++ 的桌面开发”、MSVC x64 工具集和 Windows SDK；另安装 CMake 3.31.8、Git。
打开 **Developer PowerShell for VS 2022**，确认 `cl.exe`、`cmake`、`git` 可用，并进入项目根目录。

本项目当前 Makefile 依赖 Unix 工具链，不要在此终端直接执行 `make`。以下使用 MSVC 手工编译当前两个源文件；这不是已验证的 Windows 发布构建。

#### 下载及编译依赖

以下 PowerShell 代码块在同一会话中顺序执行。`Run` 在原生命令失败时停止，避免旧版 PowerShell 继续执行后续步骤：

```powershell
$ErrorActionPreference = 'Stop'
$projectRoot = (Get-Location).Path
$deps = "$projectRoot/.local-build"
New-Item -ItemType Directory -Force "$deps/downloads" | Out-Null

function Run {
    param([string]$Command, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed: $LASTEXITCODE" }
}
function Get-Source {
    param([string]$Name, [string]$Url, [string]$Directory)
    if (!(Test-Path "$deps/$Directory")) {
        Invoke-WebRequest $Url -OutFile "$deps/downloads/$Name.tar.gz"
        Push-Location $deps
        try { Run cmake -E tar xzf "$deps/downloads/$Name.tar.gz" }
        finally { Pop-Location }
    }
}

Get-Source occt-7.9.3 https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_9_3.tar.gz OCCT-7_9_3
Get-Source rapidjson https://github.com/Tencent/rapidjson/archive/8f4c021fa2f1e001d2376095928fc0532adf2ae6.tar.gz rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6
Get-Source draco-1.5.7 https://github.com/google/draco/archive/refs/tags/1.5.7.tar.gz draco-1.5.7
Get-Source meshoptimizer-0.25 https://github.com/zeux/meshoptimizer/archive/refs/tags/v0.25.tar.gz meshoptimizer-0.25

Run cmake -S "$deps/meshoptimizer-0.25" -B "$deps/meshoptimizer-build" `
    -G "Visual Studio 17 2022" -A x64 `
    "-DCMAKE_INSTALL_PREFIX=$deps/meshoptimizer" -DCMAKE_INSTALL_LIBDIR=lib `
    -DMESHOPT_BUILD_SHARED_LIBS=OFF
Run cmake --build "$deps/meshoptimizer-build" --config Release --parallel 4
Run cmake --install "$deps/meshoptimizer-build" --config Release

Run cmake -S "$deps/draco-1.5.7" -B "$deps/draco-build" `
    -G "Visual Studio 17 2022" -A x64 `
    "-DCMAKE_INSTALL_PREFIX=$deps/draco" -DCMAKE_INSTALL_LIBDIR=lib `
    -DBUILD_SHARED_LIBS=OFF -DDRACO_TESTS=OFF `
    -DDRACO_TRANSCODER_SUPPORTED=OFF -DDRACO_GLTF_BITSTREAM=ON
Run cmake --build "$deps/draco-build" --config Release --parallel 4
Run cmake --install "$deps/draco-build" --config Release

if (!(Select-String -Quiet -SimpleMatch 'aMesh.set_num_points' `
    "$deps/OCCT-7_9_3/src/RWGltf/RWGltf_CafWriter.cxx")) {
    Run git apply --check --directory=.local-build/OCCT-7_9_3 scripts/occt-draco.patch
    Run git apply --directory=.local-build/OCCT-7_9_3 scripts/occt-draco.patch
}

Run cmake -S "$deps/OCCT-7_9_3" -B "$deps/occt-build" `
    -G "Visual Studio 17 2022" -A x64 `
    "-DCMAKE_INSTALL_PREFIX=$deps/occt" -DINSTALL_DIR_LAYOUT=Unix `
    -DINSTALL_DIR_BIN=bin -DINSTALL_DIR_LIB=lib -DINSTALL_DIR_INCLUDE=include/opencascade `
    -DBUILD_LIBRARY_TYPE=Shared -DCMAKE_EXPORT_NO_PACKAGE_REGISTRY=ON `
    -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingData=OFF `
    -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_Visualization=OFF `
    -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_DataExchange=OFF `
    -DBUILD_MODULE_DETools=OFF -DBUILD_MODULE_Draw=OFF `
    '-DBUILD_ADDITIONAL_TOOLKITS=TKDESTEP;TKDEGLTF' `
    -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF -DUSE_TCL=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF `
    -DUSE_RAPIDJSON=ON -DUSE_DRACO=ON "-D3RDPARTY_DRACO_DIR=$deps/draco" `
    "-D3RDPARTY_RAPIDJSON_DIR=$deps/rapidjson-8f4c021fa2f1e001d2376095928fc0532adf2ae6"
Run cmake --build "$deps/occt-build" --config Release --parallel 4
Run cmake --install "$deps/occt-build" --config Release
```

PowerShell 的续行符是反引号，其后不能再有空格。以上统一构建 **x64 Release**，不要混用 ARM64、x86、Debug 库或其他编译器生成的库。

#### 编译转换程序、回归测试

当前 `main.cpp` 使用 POSIX 的 `strcasecmp`。MSVC 命令通过 `/Dstrcasecmp=_stricmp` 映射到 Windows CRT，并强制包含所需 C 标准头，不修改源文件。参见 Microsoft 的 [编译器选项](https://learn.microsoft.com/en-us/cpp/build/reference/compiler-options-listed-by-category?view=msvc-170) 和 [`_stricmp` 文档](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/stricmp-wcsicmp-mbsicmp-stricmp-l-wcsicmp-l-mbsicmp-l?view=msvc-170)。

```powershell
$compileFlags = @('/nologo', '/std:c++17', '/EHsc', '/O2', '/MD', '/utf-8',
    '/Dstrcasecmp=_stricmp', '/FIstring.h', '/FIstdlib.h', '/I.',
    "/I$deps/occt/include/opencascade", "/I$deps/meshoptimizer/include")
$linkFlags = @("/LIBPATH:$deps/occt/lib", "/LIBPATH:$deps/meshoptimizer/lib",
    'meshoptimizer.lib', 'TKDESTEP.lib', 'TKDEGLTF.lib', 'TKXCAF.lib',
    'TKCDF.lib', 'TKLCAF.lib', 'TKRWMesh.lib', 'TKTopAlgo.lib', 'TKBRep.lib',
    'TKG2d.lib', 'TKG3d.lib', 'TKGeomBase.lib', 'TKMath.lib', 'TKMesh.lib',
    'TKXSBase.lib', 'TKernel.lib')

Run cl.exe @compileFlags main.cpp /Fe:step2gltf.exe /link @linkFlags
$env:PATH = "$deps/occt/bin;$env:PATH"
Run cl.exe @compileFlags tests/preview.cpp /Fe:.local-build/preview-check.exe /link @linkFlags TKPrim.lib
Run ./.local-build/preview-check.exe
Run ./step2gltf.exe --preview -v samples/piggy.step .local-build/piggy.glb
```

`/MD` 与 Release 依赖的动态 CRT 配置保持一致。回归测试依赖 `assert`，不要为测试命令添加 `/DNDEBUG`。
新开终端后要重新把 `.local-build/occt/bin` 加入 `PATH`，或部署时把其中所需 DLL 放在 EXE 同目录，同时安装对应的 Microsoft Visual C++ 运行库。

当前入口是窄字符 `main`，Windows 中文路径尚未验证；`/utf-8` 只设置编译时字符集，不保证运行时路径编码正确。首次验证请用英文路径，例如 `C:\work\step-parser`、`C:\models\input.STEP`。

## 5. 通用使用方式

### 输出格式与压缩

macOS/Linux：

```bash
mkdir -p .local-build/output
./step2gltf --preview -v samples/piggy.step .local-build/output/model.glb
./step2gltf --preview -v samples/piggy.step .local-build/output/model.gltf
```

Windows 原生：

```powershell
New-Item -ItemType Directory -Force .local-build/output | Out-Null
./step2gltf.exe --preview -v samples/piggy.step .local-build/output/model.glb
```

输出后缀决定格式：`.glb` 把 JSON 和几何二进制封装为一个文件；`.gltf` 使用 JSON 和外部二进制资源，交付时要一并保留 writer 生成的关联文件。
两种格式均可使用 Draco，不能靠更换后缀启用压缩，必须传 `--preview`。

选项放在两个文件路径之前，带数值的选项使用 `=`，例如 `--deep-ratio=0.15`，不支持 `--deep-ratio 0.15`。
路径包含空格时加引号；输出目录要先创建。成功退出码为 `0`，参数、读取、转换或写入失败为非零。当前 `--help` 也返回 `1`，不要将其用作构建成功检查。

### 参数说明

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--preview` | 关闭 | 启用两层装配预览、深层减面、面合并分块及 Draco 压缩 |
| `--linear=FLOAT` | `0.1` | 浅层 / 普通导出的线性网格偏差，按 OCCT 模型单位解释 |
| `--angular=FLOAT` | `0.5` | 浅层 / 普通导出的角度偏差，单位弧度 |
| `--deep-linear=FLOAT` | `1.0` | 深层设备网格偏差，需要 `--preview` |
| `--deep-angular=FLOAT` | `0.8` | 深层设备角度偏差，需要 `--preview` |
| `--deep-ratio=FLOAT` | `0.15` | 深层三角形保留目标比例；`1` 关闭减面，但仍合并并压缩 |
| `--deep-error=FLOAT` | `0.001` | 深层网格相对误差上限；默认约为设备尺度的 0.1% |
| `-v` | 关闭 | 显示读取、几何转换、读取器释放、网格化与导出的分阶段耗时 |
| `-h` / `--help` | — | 查看帮助 |

数值必须为有限正数；角度小于 π；ratio 和 error 的取值范围均为 `[0.000001, 1]`。所有 `--deep-*` 参数都需要 `--preview`。误差限制可能使实际三角形数高于目标比例。

不传 `--preview` 时保留完整装配层级，不启用上述深层减面和 Draco 压缩，仍会合并同一零件内的面。

### 装配关系、材质与尺寸

`--preview` 将 STEP 根节点视为第 1 层，保留第 2 层设备，第 3 层及更深的装配几何合并进所属设备。浏览器可在设备级选择、隐藏和进行一层爆裂。深层合并会丢弃后代节点名称、细节及部分颜色信息。

如果 STEP 只有一个产品、没有装配层级，就不会触发深层合并和减面，也无法直接获得按设备爆裂的结构。几何实体数量不等于装配节点数量。

当前保留基础颜色/材质信息，没有自动烘焙纹理或强制剥离材质的开关。业务应用可以在加载后自行替换材质和纹理。压缩模型需要加载器支持 `KHR_draco_mesh_compression`；仓库预览页面已配置本地 Draco 解码器。

**300 MB 是目前项目的目标，不是程序保证的硬上限**；没有自动追踪该体积的参数。STEP 输入大小、输出大小和转换内存不是同一回事。大型输入会占用数 GB 或更多内存，运行时间受几何复杂度、可用内存和系统负载影响。

## 6. 浏览器预览（可选）

先按对应平台的命令生成 `.local-build/piggy.glb`，然后在项目根目录安装前端依赖：

```bash
npm ci --prefix viewer
npm run check --prefix viewer
```

macOS/Linux：

```bash
npm run dev --prefix viewer
```

Windows 原生如果没有 `python3` 命令，使用 Python Launcher 从**项目根目录**启动：

```powershell
py -3 -m http.server 8086 --bind 127.0.0.1 --directory .
```

访问 [本地预览页面](http://127.0.0.1:8086/viewer/)。它默认加载 `.local-build/models/assembly-web.glb`（需自行转换放入）。使用“加载样例”或 `?model=../.local-build/piggy.glb` 查看样例；也可用“打开模型”，或通过 `?model=../.local-build/output/model.glb` 指定服务器内的模型。
拖动旋转、滚轮缩放、右键平移；在模型树中选择和隐藏节点。`piggy.step` 是单零件样例，没有可供爆裂的装配层级。

迁移后的仓库包含 `samples/piggy.step`，不包含此前的工业大模型和测量产物。已有 8086 服务占用端口时，需要确认它服务的是哪个项目；可用 `python3 -m http.server 8087 --bind 127.0.0.1 --directory .`（Windows 使用 `py -3`）改用其他端口。

## 7. 常见问题

| 现象 | 检查方法 / 处理 |
| --- | --- |
| 找不到 `RWGltf_DracoParameters.hxx` 或 meshoptimizer API | 确认使用本文固定版本，避免编译器误选系统旧版头文件 |
| Draco 导出失败或崩溃 | 确认 OCCT 配置为 `USE_DRACO=ON`，已应用 `scripts/occt-draco.patch`，并运行压缩导出/解码回归测试 |
| Linux 找不到 `.so` | 设置第 3 节的 `LD_LIBRARY_PATH`；可用 `ldd ./step2gltf` 检查依赖 |
| macOS 找不到 `.dylib` | 确认 `.local-build/occt/lib` 存在；移动目录后执行 `make -B release` |
| Windows 找不到 DLL / 链接库 | 确认 `.local-build/occt/bin` 在 `PATH`；`.lib` 位于 `occt/lib`，编译器、架构和 Release 配置一致 |
| 编译进程被终止 / 内存不足 | 降低依赖构建的 `--parallel`，macOS 脚本设置 `JOBS=2` 或 `4` |
| 转换很慢 | 用 `-v` 区分读取、几何转换和网格化；转换已经开启并行网格化，目前没有 `--threads` 参数 |
| STEP 报 `Unresolved Reference` | 来源文件 / 导入器存在引用解析问题，成功导出不代表几何完整；压缩不修复该问题 |
| 模型不能爆裂 | 检查是否存在多个装配设备节点；当前不会从独立实体自动重建设备归属 |
| 参数被拒绝 | 使用 `--name=value`，放在输入、输出文件路径之前 |

切换平台或工具链时使用新的依赖构建目录，避免复用包含旧绝对路径、生成器和架构信息的 CMake 缓存。以上保留动态 OCCT 部署方式；当前 Makefile 的旧 `STATIC=1` 链路未验证，不作为跨平台单文件发布方案。
