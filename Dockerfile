# syntax=docker/dockerfile:1.7

ARG DEBIAN_VERSION=bookworm-slim
ARG NODE_VERSION=22.20.0

FROM debian:${DEBIAN_VERSION} AS native-builder

ARG TARGETARCH
ARG BUILD_JOBS=4
ARG OCCT_VERSION=7.9.3
ARG OCCT_TAG=V7_9_3
ARG OCCT_SHA256=5ecf094ec6b12d5413dfb851d8c3590c354058aee556e32e408bdfbf8c357d57
ARG DRACO_VERSION=1.5.7
ARG DRACO_SHA256=bf6b105b79223eab2b86795363dfe5e5356050006a96521477973aba8f036fe1
ARG MESHOPT_VERSION=0.25
ARG MESHOPT_SHA256=68b2fef4e4eaad98e00c657c1e7f8982a7176e61dd7efdeaec67a025b8519be9
ARG RAPIDJSON_COMMIT=8f4c021fa2f1e001d2376095928fc0532adf2ae6
ARG RAPIDJSON_SHA256=3c8e1044b9b3226ff839663ff482b00750ca7dedb53026f8d8a31999865b8466

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential ca-certificates cmake curl ninja-build patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN curl -fL --retry 5 --retry-all-errors \
      "https://github.com/zeux/meshoptimizer/archive/refs/tags/v${MESHOPT_VERSION}.tar.gz" \
      -o meshoptimizer.tar.gz \
    && echo "${MESHOPT_SHA256}  meshoptimizer.tar.gz" | sha256sum -c - \
    && mkdir meshoptimizer-src \
    && tar -xzf meshoptimizer.tar.gz -C meshoptimizer-src --strip-components=1 \
    && cmake -S meshoptimizer-src -B meshoptimizer-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/meshoptimizer \
    && cmake --build meshoptimizer-build --parallel "${BUILD_JOBS}" \
    && cmake --install meshoptimizer-build \
    && rm -rf meshoptimizer.tar.gz meshoptimizer-src meshoptimizer-build

RUN curl -fL --retry 5 --retry-all-errors \
      "https://github.com/google/draco/archive/refs/tags/${DRACO_VERSION}.tar.gz" \
      -o draco.tar.gz \
    && echo "${DRACO_SHA256}  draco.tar.gz" | sha256sum -c - \
    && mkdir draco-src \
    && tar -xzf draco.tar.gz -C draco-src --strip-components=1 \
    && cmake -S draco-src -B draco-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/draco \
      -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DDRACO_TESTS=OFF -DDRACO_TRANSCODER_SUPPORTED=OFF -DDRACO_GLTF_BITSTREAM=ON \
    && cmake --build draco-build --parallel "${BUILD_JOBS}" \
    && cmake --install draco-build \
    && rm -rf draco.tar.gz draco-src draco-build

RUN curl -fL --retry 5 --retry-all-errors \
      "https://github.com/Tencent/rapidjson/archive/${RAPIDJSON_COMMIT}.tar.gz" \
      -o rapidjson.tar.gz \
    && echo "${RAPIDJSON_SHA256}  rapidjson.tar.gz" | sha256sum -c - \
    && mkdir rapidjson-src \
    && tar -xzf rapidjson.tar.gz -C rapidjson-src --strip-components=1 \
    && rm rapidjson.tar.gz

RUN curl -fL --retry 5 --retry-all-errors \
      "https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/${OCCT_TAG}.tar.gz" \
      -o occt.tar.gz \
    && echo "${OCCT_SHA256}  occt.tar.gz" | sha256sum -c - \
    && mkdir occt-src \
    && tar -xzf occt.tar.gz -C occt-src --strip-components=1 \
    && rm occt.tar.gz

COPY scripts/occt-draco.patch /tmp/occt-draco.patch
RUN patch -d occt-src -p1 < /tmp/occt-draco.patch \
    && cmake -S occt-src -B occt-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/occt \
      -DCMAKE_EXPORT_NO_PACKAGE_REGISTRY=ON -DINSTALL_DIR_LAYOUT=Unix \
      -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingData=OFF \
      -DBUILD_MODULE_ModelingAlgorithms=OFF -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_DataExchange=OFF \
      -DBUILD_MODULE_DETools=OFF -DBUILD_MODULE_Draw=OFF \
      -DBUILD_ADDITIONAL_TOOLKITS="TKDESTEP;TKDEGLTF" \
      -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF -DUSE_TCL=OFF -DUSE_TK=OFF -DUSE_XLIB=OFF \
      -DUSE_RAPIDJSON=ON -DUSE_DRACO=ON \
      -D3RDPARTY_DRACO_DIR=/opt/draco \
      -D3RDPARTY_RAPIDJSON_DIR=/build/rapidjson-src \
    && cmake --build occt-build --parallel "${BUILD_JOBS}" \
    && cmake --install occt-build \
    && rm -rf occt-src occt-build rapidjson-src

WORKDIR /src
COPY Makefile main.cpp preview.hxx ./
COPY samples/piggy.step samples/piggy.step
RUN make -B release \
      OPENCASCADEINC=/opt/occt/include/opencascade \
      OPENCASCADELIB=/opt/occt/lib \
      MESHOPTROOT=/opt/meshoptimizer \
    && LD_LIBRARY_PATH=/opt/occt/lib ./step2gltf --preview --encoding=UTF-8 samples/piggy.step /tmp/piggy.glb \
    && test -s /tmp/piggy.glb \
    && strip --strip-unneeded step2gltf \
    && find /opt/occt/lib -type f -name '*.so*' -exec strip --strip-unneeded {} +

FROM node:${NODE_VERSION}-${DEBIAN_VERSION} AS service-builder
WORKDIR /app
COPY service/package.json service/package-lock.json ./
RUN npm install --global npm@11.19.0 \
    && npm ci --ignore-scripts
COPY service/nest-cli.json service/tsconfig.json service/tsconfig.build.json ./
COPY service/src ./src
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:${NODE_VERSION}-${DEBIAN_VERSION} AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="step2gltf-service" \
      org.opencontainers.image.description="Production STEP to glTF conversion service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    STEP2GLTF_PATH=/usr/local/bin/step2gltf \
    STEP2GLTF_WORK_DIR=/var/lib/step2gltf \
    TMPDIR=/var/lib/step2gltf \
    MAX_UPLOAD_BYTES=4294967296 \
    MAX_CONCURRENT_CONVERSIONS=1 \
    MAX_QUEUED_CONVERSIONS=8 \
    CONVERSION_TIMEOUT_MS=3600000 \
    LD_LIBRARY_PATH=/opt/occt/lib

COPY --from=native-builder /src/step2gltf /usr/local/bin/step2gltf
COPY --from=native-builder /opt/occt/lib /opt/occt/lib
COPY --from=native-builder /opt/occt/share /opt/occt/share
COPY --from=service-builder --chown=node:node /app/dist /app/dist
COPY --from=service-builder --chown=node:node /app/node_modules /app/node_modules
COPY --from=service-builder --chown=node:node /app/package.json /app/package.json

RUN mkdir -p /var/lib/step2gltf \
    && chown node:node /var/lib/step2gltf \
    && chmod 700 /var/lib/step2gltf

WORKDIR /app
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/health/ready").then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))'
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
