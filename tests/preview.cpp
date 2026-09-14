#include "preview.hxx"
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRep_Tool.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#include <RWGltf_CafWriter.hxx>
#include <RWGltf_CafReader.hxx>
#include <BRep_Builder.hxx>
#include <cassert>
#include <fstream>

int triangles(const TopoDS_Shape& shape) {
    int count = 0;
    for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
        TopLoc_Location location;
        auto mesh = BRep_Tool::Triangulation(TopoDS::Face(it.Current()), location);
        if (!mesh.IsNull()) count += mesh->NbTriangles();
    }
    return count;
}

int main() {
    Handle(TDocStd_Document) doc;
    XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
    XCAFDoc_DocumentTool::SetLengthUnit(doc, 0.001);
    auto shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    auto root = shapes->NewShape();
    auto device = shapes->NewShape();
    auto leaf = shapes->AddShape(BRepPrimAPI_MakeSphere(10).Shape(), false);
    auto face = shapes->AddSubShape(leaf, TopExp_Explorer(shapes->GetShape(leaf), TopAbs_FACE).Current());
    XCAFDoc_DocumentTool::ColorTool(doc->Main())->SetColor(
        face, Quantity_Color(Quantity_NOC_BLUE), XCAFDoc_ColorSurf);
    TDataStd_Name::Set(device, "device");
    XCAFDoc_DocumentTool::ColorTool(doc->Main())->SetColor(
        device, Quantity_Color(Quantity_NOC_RED), XCAFDoc_ColorSurf);
    gp_Trsf placement;
    placement.SetTranslation(gp_Vec(30, 20, 10));
    shapes->AddComponent(device, leaf, TopLoc_Location(placement));
    placement.SetRotation(gp_Ax1(gp_Pnt(), gp_Dir(0, 0, 1)), 0.7);
    shapes->AddComponent(root, device, TopLoc_Location(placement));
    shapes->AddComponent(root, leaf, TopLoc_Location());
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (int i = 0; i < 20; ++i) {
        placement.SetTranslation(gp_Vec(i * 30, 100, 0));
        builder.Add(compound, shapes->GetShape(leaf).Moved(TopLoc_Location(placement)));
    }
    shapes->AddComponent(root, shapes->AddShape(compound, false), TopLoc_Location());
    shapes->UpdateAssemblies();
    auto preview = makePreview(doc, .01, .1, 1, .8);
    auto result = XCAFDoc_DocumentTool::ShapeTool(preview->Main());
    double unit = 0;
    assert(XCAFDoc_DocumentTool::GetLengthUnit(preview, unit) && unit == 0.001);
    TDF_LabelSequence roots, children;
    result->GetFreeShapes(roots);
    assert(roots.Length() == 1);
    result->GetComponents(roots.First(), children);
    assert(children.Length() == 3);
    TDF_Label deep, shallow;
    result->GetReferredShape(children.First(), deep);
    result->GetReferredShape(children.Value(2), shallow);
    assert(!result->IsAssembly(deep) && !result->IsAssembly(shallow));
    assert(triangles(result->GetShape(deep)) < triangles(result->GetShape(shallow)));
    assert(triangles(shapes->GetShape(leaf)) == triangles(result->GetShape(shallow)));
    const auto reduced = simplifyPreviewShape(shapes->GetShape(leaf), 0.15f, 0.005f);
    assert(triangles(reduced) > 0 && triangles(reduced) < triangles(shapes->GetShape(leaf)));
    Handle(TDataStd_Name) name;
    assert(deep.FindAttribute(TDataStd_Name::GetID(), name));
    assert(name->Get() == "device");
    assert(children.First().FindAttribute(TDataStd_Name::GetID(), name));
    assert(name->Get() == "device");
    Quantity_ColorRGBA color;
    assert(XCAFDoc_ColorTool::GetColor(deep, XCAFDoc_ColorSurf, color));
    TDF_LabelSequence faces;
    result->GetSubShapes(shallow, faces);
    assert(faces.Length() == 1);
    assert(XCAFDoc_ColorTool::GetColor(faces.First(), XCAFDoc_ColorSurf, color));
    assert(color.GetRGB() == Quantity_Color(Quantity_NOC_BLUE));
    // Geometry bounds use analytic surfaces, independent of mesh tolerance.
    Bnd_Box before, after;
    BRepBndLib::AddOptimal(shapes->GetShape(root), before, false);
    BRepBndLib::AddOptimal(result->GetShape(roots.First()), after, true);
    // Deep output is visualization mesh; allow its 1-unit tessellation error.
    assert(before.CornerMin().Distance(after.CornerMin()) < 1.0);
    assert(before.CornerMax().Distance(after.CornerMax()) < 1.0);
    const int expectedTriangles = triangles(result->GetShape(roots.First()));
    // The exporter must retain shared shallow geometry after closing the source.
    XCAFApp_Application::GetApplication()->Close(doc);
    doc.Nullify();
    RWGltf_CafWriter writer(".local-build/preview-check.glb", true);
    writer.SetMergeFaces(true);
    writer.SetSplitIndices16(true);
    RWGltf_DracoParameters compression;
    compression.DracoCompression = true;
    compression.CompressionLevel = 0;
    compression.QuantizePositionBits = 22;
    writer.SetCompressionParameters(compression);
    assert(writer.Perform(preview, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange()));
    std::ifstream file(".local-build/preview-check.glb", std::ios::binary);
    std::string bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    int extensions = 0;
    for (size_t pos = 0; (pos = bytes.find("\"KHR_draco_mesh_compression\"", pos)) != std::string::npos; ++pos)
        ++extensions;
    assert(extensions > 5); // Used + required extensions, and more than three primitives.
    Handle(TDocStd_Document) decoded;
    XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", decoded);
    RWGltf_CafReader reader;
    reader.SetDocument(decoded);
    reader.SetSystemLengthUnit(0.001);
    assert(reader.Perform(".local-build/preview-check.glb", Message_ProgressRange()));
    auto decodedShapes = XCAFDoc_DocumentTool::ShapeTool(decoded->Main());
    decodedShapes->GetFreeShapes(roots);
    assert(roots.Length() == 1);
    assert(triangles(decodedShapes->GetShape(roots.First())) == expectedTriangles);
    Bnd_Box decodedBounds;
    BRepBndLib::Add(decodedShapes->GetShape(roots.First()), decodedBounds);
    assert(before.CornerMin().Distance(decodedBounds.CornerMin()) < 1.0);
    assert(before.CornerMax().Distance(decodedBounds.CornerMax()) < 1.0);
    std::cout << "Preview hierarchy, shared geometry, metadata and placement checks passed\n";
}
