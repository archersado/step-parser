# step2gltf 转换服务容器部署

根目录 `Dockerfile` 会在 Linux builder 中编译当前仓库的 `step2gltf`，不是复制开发机上的可执行文件。构建链固定为 OCCT 7.9.3、Draco 1.5.7、meshoptimizer 0.25 和指定 RapidJSON 提交，并对下载归档执行 SHA-256 校验。OCCT 构建前会应用 `scripts/occt-draco.patch`，随后运行 `samples/piggy.step` 预览转换作为镜像构建期 smoke test。

最终镜像基于 Debian Bookworm 的 Node.js 22 官方镜像，是标准 Linux OCI 镜像，可运行在安装了 Docker/containerd 的 Alibaba Cloud Linux 3、Ubuntu 22.04/24.04 等宿主机上。镜像支持 `linux/amd64` 和 `linux/arm64`；阿里云 ECS 通常使用 `linux/amd64`。

## 构建镜像

单架构本地构建：

```bash
IMAGE=step2gltf-service:latest \
PLATFORMS=linux/amd64 \
BUILD_JOBS=4 \
./scripts/build-image.sh
```

首次构建需要下载并编译 OCCT，耗时和内存占用明显高于普通 Node.js 镜像。建议 builder 至少使用 4 核 CPU、8 GB 内存和 20 GB 可用磁盘；资源不足时把 `BUILD_JOBS` 降为 `2`。

构建并推送 amd64/arm64 多架构镜像：

```bash
IMAGE=registry.cn-hangzhou.aliyuncs.com/example/step2gltf-service:1.0.0 \
PLATFORMS=linux/amd64,linux/arm64 \
BUILD_JOBS=4 \
VERSION=1.0.0 \
./scripts/build-image.sh
```

当 `PLATFORMS` 包含多个架构时脚本使用 `--push`，需先登录目标镜像仓库。单架构使用 `--load`，构建结果进入本机 Docker。

## 启动

开发或单机验证可以使用 Compose：

```bash
docker compose up --build -d
curl --fail http://127.0.0.1:3000/health/ready
```

直接启动生产容器：

```bash
docker run -d \
  --name step2gltf \
  --restart unless-stopped \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /var/lib/step2gltf:rw,noexec,nosuid,size=8g,uid=1000,gid=1000,mode=0700 \
  -p 3000:3000 \
  -e MAX_CONCURRENT_CONVERSIONS=1 \
  -e MAX_QUEUED_CONVERSIONS=8 \
  -e CONVERSION_TIMEOUT_MS=3600000 \
  step2gltf-service:latest
```

临时目录必须同时容纳上传的 STEP 和生成的 GLB。示例的 8 GB 只是起点，应按最大输入、输出和并发任务调整；生产环境也可以把 `/var/lib/step2gltf` 挂载到独立临时盘。大型模型转换会使用大量内存，默认只允许一个转换进程并行运行。

## API

存活和就绪探针：

```text
GET /health/live
GET /health/ready
```

转换接口：

```text
POST /step2gltf
Content-Type: multipart/form-data
```

表单字段 `file` 必须是 `.step` 或 `.stp` 文件。成功响应为 GLB 二进制，媒体类型为 `model/gltf-binary`。

普通转换：

```bash
curl --fail-with-body \
  --form 'file=@/path/to/model.step' \
  --output model.glb \
  'http://127.0.0.1:3000/step2gltf?encoding=gbk&linear=0.1&angular=0.5'
```

设备级预览、深层减面和 Draco 压缩：

```bash
curl --fail-with-body \
  --form 'file=@/path/to/assembly.step' \
  --output assembly.glb \
  'http://127.0.0.1:3000/step2gltf?encoding=utf8&preview=true&deep-ratio=0.15&deep-error=0.001'
```

支持的查询参数：

| 参数 | 说明 |
| --- | --- |
| `encoding` | `gbk`、`gb2312`、`utf8` 或 `none`；未指定时 CLI 默认 GBK |
| `linear` / `angular` | 普通或浅层网格偏差；角度必须小于 π |
| `preview` | `true/false` 或 `1/0` |
| `deep-linear` / `deep-angular` | 深层初始网格精度，需要 `preview=true` |
| `deep-ratio` / `deep-error` | `(0, 1]`，需要 `preview=true` |
| `verbose` | 是否记录转换器阶段输出 |

为兼容 JavaScript 调用方，深层参数也接受 `deepLinear`、`deepAngular`、`deepRatio`、`deepError`。

## 运行配置

| 环境变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP 端口 |
| `MAX_UPLOAD_BYTES` | `4294967296` | 单个上传文件上限 |
| `MAX_CONCURRENT_CONVERSIONS` | `1` | 并行转换进程数 |
| `MAX_QUEUED_CONVERSIONS` | `8` | 等待队列上限，超出返回 503 |
| `CONVERSION_TIMEOUT_MS` | `3600000` | 单次转换超时 |
| `STEP2GLTF_WORK_DIR` | `/var/lib/step2gltf` | 上传和输出临时目录 |
| `STEP2GLTF_PATH` | `/usr/local/bin/step2gltf` | 镜像内转换器路径，通常无需修改 |

接口在接收上传时直接写临时文件，不会把数 GB STEP 完整保存在 Node.js 堆内。客户端断开或转换超时后，服务会终止子进程并清理任务目录。容器使用非 root `node` 用户、只读根文件系统、tini、健康检查、并发限制和优雅退出。

反向代理、Ingress 和调用端的请求体上限及超时也必须同步调大。例如 Nginx 需要配置足够的 `client_max_body_size`、`proxy_read_timeout` 和 `proxy_send_timeout`。
