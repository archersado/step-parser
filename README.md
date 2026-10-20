# step-parser

简体中文 | [English](README.en.md)

**面向大型工业 STEP 模型的原生解析、轻量化与 glTF 转换工具。**

这个包主要为了解决一个实际问题：当设备总装的 STEP 文件达到数百 MB 甚至数 GB 时，几何解析和网格生成耗时长、内存占用高，直接导出的模型又过大，难以在网页中顺畅加载和交互。

`step-parser` 把这条链路放到原生 C++ 转换程序中处理，在生成面向展示的模型时完成装配合并、网格减面和压缩。业务前端加载转换后的 GLB，保留设备级选择、隐藏和一层爆裂能力。

仓库名为 `step-parser`，可执行程序名仍为 **`step2gltf`**。

![piggy.step 样例转换后的实际预览](samples/step_preview.png)

仓库自带的 `samples/piggy.step` 转换为 GLB 后，在 viewer 中的实际渲染效果。该样例为单零件模型。

## 为什么做这个包

工业 STEP 保存的是 CAD 几何和产品结构。网页展示需要的是三角网格，两者之间需要经历读取、几何转换、网格化和导出。文件能被成功转换，并不意味着转换过程足够快，也不意味着转换结果适合浏览器。

在大型总装模型上，我们遇到了三个相互关联的问题：

- **转换耗时和内存压力。** STEP 中间数据、CAD 几何与三角网格在转换期间同时驻留，会增加内存压力；浏览器侧处理这类输入也容易受到运行环境和内存限制。
- **输出仍然太重。** 完整导出可能产生数千万个三角形和数百 MB 的 GLB，下载、解码、显存占用与绘制开销都会随之增加。
- **细节与交互粒度不匹配。** 网页通常需要查看整机、选择设备、隐藏设备和拆解总装，并不需要逐个操作设备内部的所有螺栓和细小零件。

仅继续调整全局 `--linear`、`--angular`，很难同时满足外观、体积和交互要求。因此，这个包按展示需要保留设备层级，把深层细节的处理提前到转换阶段，减少后续不必要的网格和节点开销。

## 如何优化

启用 `--preview` 后，整个流程在 `step2gltf` 内完成：

```mermaid
flowchart LR
    A[读取 STEP] --> B[转换为 CAD 几何]
    B --> C[释放读取器中间数据]
    C --> D[按装配层级处理并网格化]
    D --> E[深层减面与零件内面合并]
    E --> F[分块与 Draco 压缩]
    F --> G[输出 GLB / glTF]
```

| 优化方式 | 解决的问题 |
| --- | --- |
| 原生 C++ / OCCT 转换 | 在浏览器之外完成 STEP 读取和 CAD 几何处理，前端直接加载展示模型 |
| 提前释放中间数据 | STEP 几何转换完成后释放读取器及转换映射；预览文档就绪后关闭原文档，减少阶段间的内存重叠 |
| 按层级处理细节 | 第 3 层及更深的装配几何归入第 2 层设备，直接采用较粗网格，避免先生成这部分的完整精细网格 |
| 并行网格化与 meshoptimizer 减面 | 利用并行网格化，并在相对误差约束内进一步减少深层设备的三角形 |
| 零件内面合并 | 减少同一设备内部的绘制单元，同时保留设备节点 |
| 分块与 Draco 压缩 | 减少输出体积，并控制单个压缩网格的解码负担 |
| 分阶段计时 | 用 `-v` 区分 STEP 读取、几何转换、读取器释放、网格化和导出耗时，定位实际瓶颈 |

无需先生成完整的大体积 GLB，再运行 Node.js 脚本压缩。浏览器负责解码、渲染和交互显示。

这些优化分别作用于不同阶段：**Draco 主要减少输出体积，减面主要降低网格与渲染成本，提前释放数据主要减少内存重叠。它们不等于 STEP 读取本身获得同等倍数的加速。** 当前读取仍需载入源 CAD 数据，并非流式、恒定内存的解析器。

## 保留什么，舍弃什么

预览模式面向“设备级交互”：

- STEP 根装配为第 1 层，直属设备为第 2 层；设备可以独立选择、隐藏和爆裂。
- 第 3 层及更深的零件合并进所属设备，随设备整体移动。
- 保留设备名称、装配位置、模型单位及设备级颜色；合并后不再保留完整的后代名称、逐零件交互和全部后代颜色信息。
- 深层减面允许牺牲细小结构；默认目标保留约 15% 的深层三角形，误差上限可能使实际保留比例更高。

这适合网页展示、设备审核和装配浏览。需要精确测量、制造或完整 CAD 编辑时，应继续使用原始 STEP 数据。

**没有装配层级的 STEP 不会自动获得设备结构。** 如果源文件仅包含一个产品，即使内部有很多几何实体，也不会触发当前的深层装配合并与减面规则，无法直接按设备爆裂。

## 实测效果

以下来自同一开发机器上的工业模型测试。大小采用十进制 MB / GB；工业输入和完整基准记录不随仓库分发。

| 模型 | STEP 输入 | 基线 GLB | 优化后 GLB | 三角形：基线 → 优化后 | 保留设备 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 总装 | 约 0.99 GB | 734.25 MB | **17.72 MB** | 57,135,212 → **2,111,647** | 28 |
| 2302-FT-3301 | 约 2.08 GB | 824.34 MB | **110.11 MB** | 27,191,590 → 27,182,990 | 1 |

总装具备装配层级，因此可以合并并简化深层设备。2302 模型没有装配层级，仍保留浅层网格细节，主要通过面合并及 Draco 压缩降低体积；它说明了**文件变小与三角形变少是两件不同的事**。

在此前同一 viewer、禁用 HTTP 缓存的配对测试中，总装的 72.36 MB 中间版本加载耗时 5.77 秒，17.72 MB 减面版本为 1.28 秒；减面版本旋转时约为 60 FPS。这是当时本地浏览器的测量结果，不代表所有网络、设备或后续渲染配置的表现。

2.08 GB 模型在提前释放中间数据后的单次转换耗时约 **8 分 13 秒**，其中 CAD 几何转换约 4 分 16 秒、网格化约 2 分 47 秒。此前同文件的记录从约 6 分钟到 25 分钟不等，测试负载未受控，不能据此宣称固定的代码加速倍数。

当前目标是将大型模型输出控制在 **300 MB 以下**，但程序不保证所有输入都达到这一体积，也没有自动追踪该上限的开关。测试输入还存在 STEP 未解析引用告警；成功输出不能作为几何完整性的保证。

## 快速开始

完整的 macOS、Windows 原生、WSL 和 Linux 构建步骤见：

**[跨平台编译与使用指南](docs/build-and-usage.zh-CN.md)**

需要以 HTTP 服务部署时，可使用仓库根目录的多阶段 `Dockerfile`。镜像构建阶段会在 Linux 中从源码编译 meshoptimizer、Draco、OCCT 和当前 `step2gltf`，运行阶段提供同步的 `POST /step2gltf` 转换接口。Alibaba Cloud Linux、Ubuntu、容器参数和 API 示例见 **[转换服务容器部署](docs/container-deployment.zh-CN.md)**。

目前 macOS Apple Silicon 已完成编译、回归测试和实际模型验证；其他平台的文档步骤仍待实机验证。核心依赖为 C++17、OCCT 7.9.3、meshoptimizer 0.25、Draco 1.5.7 和 RapidJSON。

macOS 首次构建，在安装 Xcode Command Line Tools 后执行：

```bash
bash scripts/setup-macos.sh
make check
```

以下命令在项目根目录执行。如果已经完成构建，可以直接从转换步骤开始；不需要每次重新编译。

转换仓库自带样例：

```bash
./step2gltf --preview -v samples/piggy.step .local-build/piggy.glb
```

转换自己的总装模型：

```bash
mkdir -p .local-build/models
./step2gltf --preview -v /path/to/assembly.STEP .local-build/models/assembly-web.glb
```

`/path/to/assembly.STEP` 替换为你的输入路径；含空格的路径要加引号。转换成功退出码为 `0`，输出文件位于命令最后指定的位置。`-v` 会显示读取、几何转换、读取器释放、网格化和导出的耗时。

Windows 原生构建后使用 `./step2gltf.exe`，例如在 PowerShell 中：

```powershell
New-Item -ItemType Directory -Force .local-build/models | Out-Null
./step2gltf.exe --preview -v "C:/models/assembly.STEP" .local-build/models/assembly-web.glb
```

输出 `.glb` 时，JSON 与几何二进制封装在一个文件中；输出 `.gltf` 时，需要同时交付关联的二进制资源文件。纹理和业务材质可由应用在加载后自行处理，当前转换器仍保留基础材质/颜色信息。

### 常用选项

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `--encoding` | `GBK` | STEP 名称源编码；UTF-8 文件使用 `--encoding=UTF-8`，GLB 始终输出 Unicode 名称 |
| `--preview` | 关闭 | 启用设备级预览合并、深层减面与 Draco 压缩 |
| `--linear` / `--angular` | `0.1` / `0.5` | 控制浅层零件或普通导出的网格精度 |
| `--deep-linear` / `--deep-angular` | `1.0` / `0.8` | 控制深层设备的初始网格精度 |
| `--deep-ratio` | `0.15` | 深层三角形保留目标比例；`1` 关闭减面，仍合并并压缩 |
| `--deep-error` | `0.001` | 深层网格相对误差上限 |
| `-v` | 关闭 | 输出各阶段耗时 |

数值参数使用 `--name=value`，例如 `--deep-ratio=0.3`，并放在输入、输出路径之前。`--deep-*` 需要同时指定 `--preview`。线性偏差按 OCCT 模型单位解释，角度单位为弧度；参数范围见编译与使用指南。

例如，需要保留更多深层三角形时，可以提高目标比例；实际结果仍受误差上限约束：

```bash
./step2gltf --preview --deep-ratio=0.3 --deep-error=0.001 -v /path/to/assembly.STEP .local-build/models/assembly-web.glb
```

需要输出文本 glTF 时，将输出后缀改为 `.gltf`：

```bash
./step2gltf --preview -v samples/piggy.step .local-build/piggy.gltf
```

不传 `--preview` 时保留完整装配层级，不启用深层减面及 Draco 压缩，仍会合并同一零件内的面。

## 查看转换效果

仓库提供独立的 Three.js viewer，用来检查输出质量和设备交互。安装前端依赖并启动服务：

```bash
npm ci --prefix viewer
npm run dev --prefix viewer
```

访问 [总装预览](http://127.0.0.1:8086/viewer/)；默认加载 `.local-build/models/assembly-web.glb`。如果刚转换的是自带样例，访问 [样例预览](http://127.0.0.1:8086/viewer/?model=../.local-build/piggy.glb)，或点击“加载样例”。也可通过“打开模型”选择本地文件；选择 `.gltf` 时，同时选择其引用的 `.bin` 和纹理文件。

viewer 支持旋转、缩放、设备选择与隐藏、黄色高亮、聚焦选中、一层爆裂和复位。灯光、高亮和沿 X 轴分批爆裂的逻辑移植自 `engine-checker-fe` 的 `3DModel` 组件；运行本仓库的 viewer 不需要启动业务前端或后台服务。

Windows 原生环境若没有 `python3` 命令，可在项目根目录使用 `py -3 -m http.server 8086 --bind 127.0.0.1 --directory .` 启动相同的服务。

`piggy.step` 是单零件样例，没有可爆裂的装配结构。浏览器加载压缩输出时需要 Draco 解码器，仓库 viewer 已配置。

## 开发与验证

```bash
make release
make check
npm run check --prefix viewer
```

C++ 检查覆盖装配层级、共享几何、颜色、单位、位置及 Draco 导出/解码；viewer 检查覆盖设备沿轴移动、父节点变换、动画完成、位置复位与材质恢复。

| 路径 | 内容 |
| --- | --- |
| [main.cpp](main.cpp) | 命令行入口、STEP 转换、生命周期管理及 glTF 导出 |
| [preview.hxx](preview.hxx) | 装配预览处理、网格减面与分块 |
| [scripts/](scripts/) | 本地构建脚本与 OCCT Draco 补丁 |
| [tests/](tests/) | 原生转换回归检查 |
| [viewer/](viewer/) | 浏览器预览与交互验证 |
| [docs/](docs/) | 跨平台构建与使用文档 |

构建依赖与转换产物保存在 `.local-build/`，不进入 Git。不要在不同平台或 CPU 架构间复用编译产物。

## 许可证

本仓库采用 [MIT License](LICENSE)。OCCT、Draco、meshoptimizer 等依赖各自适用其许可证。
