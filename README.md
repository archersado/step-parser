# step-parser / step2gltf

CLI tool to convert ISO 10303 STEP (AP203/AP214) files to glTF 2.0 using OpenCascade

![AP214 STEP assembly converted to glTF](samples/step_preview.png)

## Dependencies

You need OpenCascade 7.9.3 with RapidJSON, meshoptimizer 0.25, and Draco for preview export.

## Compiling

See [跨平台编译与使用指南（中文）](docs/build-and-usage.zh-CN.md) for macOS,
Linux, Windows native MSVC and WSL instructions, pinned dependencies, runtime
library setup, CLI options and browser preview. macOS Apple Silicon is verified;
Linux and Windows instructions have not yet been tested on those platforms.

On macOS:

```sh
bash scripts/setup-macos.sh
make check
./step2gltf --preview -v samples/piggy.step .local-build/piggy.glb
```

For subsequent edits, run `make release`. The executable remains `step2gltf`
(`step2gltf.exe` on native Windows), although the repository is named `step-parser`.
The converter itself uses Make on macOS/Linux; the root has no CMake project.

## Running

Once you have compiled it,
just use it as:

```
step2gltf STEPFILENAME GLTFFILENAME
```

File extension defines glTF 2.0 variant:
 - ".gltf" - glTF JSON with a separate .bin file for binary resources.
 - ".glb"  - binary glTF.

You may also need to specify LD_LIBRARY_PATH when OpenCascade is installed to /usr/local
```
LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH step2gltf STEPFILENAME GLTFFILENAME
```

## Validating

https://github.khronos.org/glTF-Validator/

Binary glTF shall have \*.glb extension.

## Rendering gLTF

### Device-level preview conversion

Compression runs inside the C++ converter, before and during glTF export.
No Node.js postprocessing or intermediate full-detail GLB is required:

```sh
./step2gltf --preview -v models/总装.STEP .local-build/models/总装-native.glb
```

The STEP root is level 1. Direct devices remain selectable at level 2.
After STEP transfer, level-3-and-deeper geometry is copied into its owning
level-2 device and meshed directly at lower detail. Native meshoptimizer then
welds identical position/normal vertices and reduces deep triangles before
export (default target 15%, relative error limit 0.1% of device extent).
Small disconnected details may disappear; device nodes remain selectable.
Use `--deep-ratio=1` to disable reduction, or `--deep-ratio` / `--deep-error`
to balance detail and speed. The error limit can prevent reaching the ratio.
Reduced meshes are partitioned into bounded chunks before Draco encoding. Document length units are
preserved. The output has at most two
assembly levels, merged faces per device, and native Draco compression (22-bit
positions, 10-bit normals). Face merging is split into primitives using 16-bit
indices where possible, limiting browser decoder memory without adding device
nodes. A single face with more than 65,535 vertices can still exceed this
primitive limit. Root leaves and direct leaf parts retain the normal
`--linear` / `--angular` settings. Device names, placements and device colors
are retained; descendant names and face/part colors are discarded on merging.

Deep meshing defaults to `--deep-linear=1.0 --deep-angular=0.8` (OCCT model units,
normally millimeters, and radians). These are lossy preview settings; file size
is model-dependent and not guaranteed below the current 300 MB target. STEP reading still loads
the source CAD data; this reduces mesh/export cost, not the STEP parser's
initial memory footprint. Without `--preview`, the full hierarchy is retained.

The converter releases STEP reader entities and transfer maps after transfer,
before meshing. Preview export also closes the original XCAF document once
the preview document is ready, reducing overlap between intermediate data.
These changes preserve the geometry settings. Use `-v` to see separate elapsed
times for STEP reading, transfer, reader release, meshing/preview, and export;
large-file conversion time also depends on available memory and system load.

A local 2.08 GB `2302-FT-3301.STEP` run after this change took 493.50 s:
STEP read 39.72 s, transfer 255.61 s, reader release 14.77 s, meshing/preview
166.94 s, and export 16.10 s (plus process startup/exit). The 110.11 MB output
is byte-identical to the previous output. The preceding run took 1492.06 s,
but older runs also took 354.50 s; these were not controlled benchmarks and
do not establish an isolated speedup from the code change. Logs and comparison
are in `.local-build/speed-check/2302-after.log` and `2302-comparison.json`.

Run `make check` to check hierarchy, shared shallow/deep instances, names,
colors, transformed geometry bounds, and a native Draco export/decode round trip.

### Browser-oriented assembly output

```sh
./step2gltf --preview -v models/总装.STEP .local-build/models/总装-web.glb
```

The current native reduction produces **17.72 MB**, **2,111,647 triangles**,
and the same **28 devices / 29 nodes** for this assembly. The STEP parse,
deep meshing, reduction, chunking and Draco encoding all run in `step2gltf`.
The checked output is `.local-build/models/总装-web.glb`; the browser preview
URL is `http://127.0.0.1:8086/viewer/?model=../.local-build/models/总装-web.glb`.
Use **聚焦选中** to inspect a selected device at a useful scale.

A paired local Ego browser measurement with the same viewer and HTTP cache
disabled loaded the previous 72.36 MB model in 5.77 s and this output in
1.28 s. The reduced model rendered at 60 FPS (mean frame 16.67 ms, p95
17.4 ms) during rotation. These are local-machine measurements, not a
network or cross-device guarantee. Detailed evidence is saved in
`.local-build/models/browser-performance.json`. Canvas selection, one-level
explosion, hiding the selected device and restoring all devices were verified.
The explosion animation measured p95 17.4 ms and maximum 33.3 ms per frame.

### Measured model results

The industrial input models and benchmark artifacts below were measured in the
original workspace and are not included in this migrated repository. Use
`samples/piggy.step` for a self-contained conversion check.

Earlier native `--preview` results before the additional mesh reduction stage
(equivalent to current `--deep-ratio=1`), tested with the files in `models/`:

| Model | Baseline GLB | Preview GLB | Rendered triangles | Device nodes / primitives |
| --- | ---: | ---: | ---: | ---: |
| 总装.STEP | 734.25 MB | 72.36 MB | 57,135,212 → 13,571,459 | 28 / 201 |
| 2302-FT-3301.STEP | 824.34 MB | 110.11 MB | 27,191,590 → 27,182,990 | 1 / 322 |

Sizes use decimal MB. Both fit the current 300 MB target. The second file
imports as a single part, so it has no device hierarchy to explode and retains
its shallow mesh detail. STEP reports unresolved references (906 / 722);
compression does not repair those source/import issues. No geometry-completeness
claim is made for these inputs.

### Local preview

```sh
./step2gltf -v samples/piggy.step .local-build/piggy.glb
npm ci --prefix viewer
npm run dev --prefix viewer
```

Open http://127.0.0.1:8086/viewer/?model=../.local-build/piggy.glb for the sample, or choose a local GLB/glTF
with **打开模型** (include its `.bin` and textures for glTF). Files stay in the
browser. The preview uses Three.js 0.163.0 and OrbitControls, following the
reference app's `src/components/3DModel` approach, with GLTFLoader replacing
browser-side STEP parsing. It supports node selection/visibility, wireframe,
auto-rotation, and animated explosion of the root assembly's direct devices.
The viewer exposes only the first two node levels; deeper parts move with their
device. Use **一键爆裂** / **收起零件** or the slider to adjust separation.
The piggy sample has one part, so explosion is disabled. Draco and Meshopt
decoders are included; KTX2 textures are not configured in this preview.

Run `npm run check --prefix viewer` for syntax and transformed-assembly checks.
Use `?model=../.local-build/models/总装-native.glb` on the viewer URL to open a
converted device model directly.

Open https://gltf-viewer.donmccurdy.com and upload result file.

## GLTF 2.0 Specification

https://github.com/KhronosGroup/glTF/blob/master/README.md

# Implementation Details

## Meshing algorithm

The algorithm of shape triangulation is provided by the functionality of BRepMesh_IncrementalMesh class, which adds a triangulation of the shape to its topological data structure. This triangulation is used to visualize the shape in shaded mode.

![Deflection parameters of BRepMesh_IncrementalMesh algorithm](https://www.opencascade.com/doc/occt-7.1.0/overview/html/modeling_algos_image056.png)

Linear deflection limits the distance between triangles and the face interior.

![Linear deflection](https://www.opencascade.com/doc/occt-7.1.0/overview/html/modeling_algos_image057.png)

Note that if a given value of linear deflection is less than shape tolerance then the algorithm will skip this value and will take into account the shape tolerance.

The application should provide deflection parameters to compute a satisfactory mesh. Angular deflection is relatively simple and allows using a default value (12-20 degrees). Linear deflection has an absolute meaning and the application should provide the correct value for its models. Giving small values may result in a too huge mesh (consuming a lot of memory, which results in a long computation time and slow rendering) while big values result in an ugly mesh.

For an application working in dimensions known in advance it can be reasonable to use the absolute linear deflection for all models. This provides meshes according to metrics and precision used in the application (for example, it it is known that the model will be stored in meters, 0.004 m is enough for most tasks).

Source: https://www.opencascade.com/doc/occt-7.1.0/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_11_2

## engine-checker-fe reference rendering

The viewer ports the Three.js lighting, yellow selection material, download
progress and X-axis staggered explosion behavior from
`engine-checker-fe/src/components/3DModel/index.tsx` and `explosion.tsx`.
It keeps the standalone viewer and its GLTFLoader/Draco setup; it does not
import the React component or business APIs. World-space displacement handles
rotated/scaled parents, and glTF device nodes remain the selection/explosion
units regardless of how many compressed primitives each device contains.
Mesh explosion uses the reference defaults (strength 1.2, duration 1.5 s,
stagger 0.5 s and model-scale base distance), followed by an 0.8 s camera fit.

The default model and **加载总装** button load
`.local-build/models/assembly-web.glb`. Place a converted assembly there;
the generated model is ignored by Git. **加载样例** loads
`.local-build/piggy.glb`. Original GLB materials are preserved outside temporary
selection highlighting. **聚焦选中** inspects a device; **还原镜头** restores
the initial view; **显示全部 / 复位** restores visibility and assembly positions.

For the current local comparison, `step-parser` is served on port 8088:

```sh
python3 -m http.server 8088 --bind 127.0.0.1 --directory .
```

- Viewer: `http://127.0.0.1:8088/viewer/`
- Original React component: `http://127.0.0.1:8000/model-preview`

The second page runs in the separate `engine-checker-fe` checkout. Its local
`.umirc.local.ts` adds the preview route and proxies `/preview-models` to
port 8088; start it with `PORT=8000 npm run dev` in that checkout.
The component accepts a `modelUrl` for this preview; it does not require the
business file API. This local Umi configuration is ignored by that repository.
Both pages use the same 17.72 MB assembly GLB (28 devices, 2,111,647 triangles).
Run `npm run check --prefix viewer` for axis movement, transformed parents,
stagger completion, exact restoration and material restoration checks.
