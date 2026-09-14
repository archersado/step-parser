#pragma once

#include <BRepBuilderAPI_Copy.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <Quantity_ColorRGBA.hxx>
#include <RWMesh_FaceIterator.hxx>
#include <BRep_Builder.hxx>
#include <meshoptimizer.h>
#include <vector>
#include <limits>
#include <algorithm>
#include <iostream>

// Reduce the merged device before the glTF writer sees it. All coordinates
// are device-local; RWMesh applies face placements, mirrored winding and normals.
inline TopoDS_Shape simplifyPreviewShape(const TopoDS_Shape& shape, float ratio, float error)
{
    if (ratio == 1) return shape;
    struct Vertex { float position[3], normal[3]; };
    std::vector<Vertex> vertices;
    std::vector<unsigned int> indices;
    for (RWMesh_FaceIterator face(shape); face.More(); face.Next()) {
        if (vertices.size() + face.NbNodes() > std::numeric_limits<unsigned int>::max())
            Standard_Failure::Raise("Device exceeds mesh index limit");
        const auto offset = static_cast<unsigned int>(vertices.size());
        if (!face.HasNormals()) face.Triangulation()->ComputeNormals();
        for (int n = 1; n <= face.NbNodes(); ++n) {
            const gp_Pnt p = face.NodeTransformed(n);
            const gp_Dir normal = face.NormalTransformed(n);
            vertices.push_back({{float(p.X()), float(p.Y()), float(p.Z())},
                                {float(normal.X()), float(normal.Y()), float(normal.Z())}});
        }
        for (int t = 1; t <= face.NbTriangles(); ++t) {
            const auto triangle = face.TriangleOriented(t);
            for (int c = 1; c <= 3; ++c) indices.push_back(offset + triangle.Value(c) - 1);
        }
    }
    if (indices.empty()) return shape;
    const auto original = indices.size();
    std::vector<unsigned int> remap(vertices.size());
    const auto count = meshopt_generateVertexRemap(remap.data(), indices.data(), indices.size(),
        vertices.data(), vertices.size(), sizeof(Vertex));
    meshopt_remapIndexBuffer(indices.data(), indices.data(), indices.size(), remap.data());
    meshopt_remapVertexBuffer(vertices.data(), vertices.data(), vertices.size(), sizeof(Vertex), remap.data());
    vertices.resize(count);
    const float weights[] = {0.01f, 0.01f, 0.01f};
    float actualError = 0;
    const auto reduced = meshopt_simplifyWithAttributes(indices.data(), indices.data(), indices.size(),
        vertices[0].position, vertices.size(), sizeof(Vertex), vertices[0].normal, sizeof(Vertex),
        weights, 3, nullptr, std::max(size_t(3), size_t(original / 3 * ratio) * 3), error,
        meshopt_SimplifyPermissive | meshopt_SimplifyPrune, &actualError);
    if (!reduced) return shape; // Keep even the smallest selectable device visible.
    indices.resize(reduced);
    meshopt_optimizeVertexCache(indices.data(), indices.data(), indices.size(), vertices.size());
    std::cout << "Deep triangles " << original / 3 << " -> " << reduced / 3
              << ", relative error " << actualError << std::endl;

    // A bounded number of triangle corners also bounds unique vertices, including
    // single CAD faces too large for OCCT's face-boundary splitting to handle.
    TopoDS_Compound result;
    BRep_Builder builder;
    builder.MakeCompound(result);
    remap.assign(vertices.size(), std::numeric_limits<unsigned int>::max());
    for (size_t start = 0; start < indices.size(); start += 65532) {
        const auto end = std::min(start + 65532, indices.size());
        std::vector<unsigned int> used, local;
        for (size_t i = start; i < end; ++i) {
            auto& mapped = remap[indices[i]];
            if (mapped == std::numeric_limits<unsigned int>::max()) {
                mapped = static_cast<unsigned int>(used.size());
                used.push_back(indices[i]);
            }
            local.push_back(mapped);
        }
        Handle(Poly_Triangulation) mesh = new Poly_Triangulation(
            static_cast<int>(used.size()), static_cast<int>(local.size() / 3), false, true);
        for (size_t i = 0; i < used.size(); ++i) {
            const auto& v = vertices[used[i]];
            mesh->SetNode(static_cast<int>(i + 1), gp_Pnt(v.position[0], v.position[1], v.position[2]));
            mesh->SetNormal(static_cast<int>(i + 1), gp_Vec3f(v.normal[0], v.normal[1], v.normal[2]));
            remap[used[i]] = std::numeric_limits<unsigned int>::max();
        }
        for (size_t i = 0; i < local.size(); i += 3)
            mesh->SetTriangle(static_cast<int>(i / 3 + 1), Poly_Triangle(local[i] + 1, local[i + 1] + 1, local[i + 2] + 1));
        TopoDS_Face face;
        builder.MakeFace(face, mesh);
        builder.Add(result, face);
    }
    return result;
}

// Root = level 1. Each direct device becomes one selectable part; its
// descendants are meshed coarsely before export, never meshed at full detail.
inline Handle(TDocStd_Document) makePreview(
    const Handle(TDocStd_Document)& source, double linear, double angular,
    double deepLinear, double deepAngular, float ratio = 0.15f, float error = 0.001f)
{
    Handle(TDocStd_Document) output;
    XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", output);
    double unit;
    if (XCAFDoc_DocumentTool::GetLengthUnit(source, unit))
        XCAFDoc_DocumentTool::SetLengthUnit(output, unit);
    auto inputShapes = XCAFDoc_DocumentTool::ShapeTool(source->Main());
    auto shapes = XCAFDoc_DocumentTool::ShapeTool(output->Main());
    auto colors = XCAFDoc_DocumentTool::ColorTool(output->Main());
    auto definition = [](const TDF_Label& label) {
        TDF_Label target;
        return XCAFDoc_ShapeTool::GetReferredShape(label, target) ? target : label;
    };
    auto copyMetadata = [&](const TDF_Label& from, const TDF_Label& to) {
        Handle(TDataStd_Name) name;
        if (from.FindAttribute(TDataStd_Name::GetID(), name)) {
            const auto& value = name->Get();
            // XCAF auto-generated reference names must not replace device names.
            if (value.Length() < 3 || value.Value(1) != '=' || value.Value(2) != '>')
                TDataStd_Name::Set(to, value);
        }
        for (auto type : {XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_ColorCurv}) {
            Quantity_ColorRGBA color;
            if (XCAFDoc_ColorTool::GetColor(from, type, color))
                colors->SetColor(to, color, type);
        }
    };
    auto makePart = [&](const TDF_Label& label, bool deep) {
        // Independent geometry prevents shared shallow/deep instances from
        // overwriting each other's triangulations.
        TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(label);
        if (deep) shape = BRepBuilderAPI_Copy(shape, true, false).Shape();
        BRepMesh_IncrementalMesh mesh(shape, deep ? deepLinear : linear, false,
                                     deep ? deepAngular : angular, true);
        if (!mesh.IsDone()) Standard_Failure::Raise("Preview meshing failed");
        if (deep) shape = simplifyPreviewShape(shape, ratio, error);
        TDF_Label part = shapes->AddShape(shape, false);
        copyMetadata(definition(label), part);
        copyMetadata(label, part);
        if (!deep) {
            TDF_LabelSequence subshapes;
            XCAFDoc_ShapeTool::GetSubShapes(definition(label), subshapes);
            for (int i = 1; i <= subshapes.Length(); ++i) {
                const auto& subshape = subshapes.Value(i);
                TDF_Label out = shapes->AddSubShape(part, XCAFDoc_ShapeTool::GetShape(subshape));
                if (!out.IsNull()) copyMetadata(subshape, out);
            }
        }
        // ponytail: device-level colors only; copy descendant face styles if
        // per-fastener colors become necessary in the merged preview.
        return part;
    };
    TDF_LabelSequence roots;
    inputShapes->GetFreeShapes(roots);
    int devices = 0;
    for (int i = 1; i <= roots.Length(); ++i) {
        TDF_Label root = definition(roots.Value(i));
        if (!XCAFDoc_ShapeTool::IsAssembly(root)) {
            makePart(roots.Value(i), false);
            continue;
        }
        TDF_Label outRoot = shapes->NewShape();
        copyMetadata(root, outRoot);
        TDF_LabelSequence children;
        XCAFDoc_ShapeTool::GetComponents(root, children);
        for (int j = 1; j <= children.Length(); ++j) {
            const TDF_Label& child = children.Value(j);
            TDF_Label def = definition(child);
            if (XCAFDoc_ShapeTool::GetShape(def).IsNull()) continue;
            TDF_Label part = makePart(def, XCAFDoc_ShapeTool::IsAssembly(def));
            TDF_Label instance = shapes->AddComponent(outRoot, part,
                XCAFDoc_ShapeTool::GetLocation(roots.Value(i)) *
                XCAFDoc_ShapeTool::GetLocation(child));
            copyMetadata(def, instance);
            copyMetadata(child, instance);
            ++devices;
            std::cout << "Preview device " << devices << std::endl;
        }
    }
    shapes->UpdateAssemblies();
    return output;
}
