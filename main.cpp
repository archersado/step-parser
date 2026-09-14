#include <iostream>
#include <cmath>
#include <chrono>
#include "preview.hxx"
#include <RWGltf_DracoParameters.hxx>
#include <XCAFApp_Application.hxx>
#include <TDocStd_Document.hxx>
// STEP Read methods
#include <STEPCAFControl_Reader.hxx>
// Meshing
#include <TopoDS_Shape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
// GLTF Write methods
#include <RWGltf_CafWriter.hxx>
#include <Message_ProgressRange.hxx>


/// @name Defines
/// @{
const Standard_Real DefaultLinDeflection = 0.1;
const Standard_Real DefaultAngDeflection = 0.5;
/// @}

/// @name BRepMesh_IncrementalMesh parameters
/// https://www.opencascade.com/doc/occt-7.1.0/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_11_2
/// @{
static Standard_Real g_theLinDeflection = DefaultLinDeflection;
static Standard_Real g_theAngDeflection = DefaultAngDeflection;
/// @}

/// @name Other parameters
/// @{
static int g_verbose_level = 0;
static bool g_preview = false;
static bool g_deepOptionSet = false;
static double g_deepLinear = 1.0;
static double g_deepAngular = 0.8;
static float g_deepRatio = 0.15f;
static float g_deepError = 0.001f;
/// @}

/// @name Command line arguments
/// @{
static const char* kHelp                = "-h";
static const char* kHelpLong            = "--help";
static const char* kLinearDeflection    = "--linear";
static const char* kAngularDeflection   = "--angular";
static const char* kVerbose             = "-v";
/// @}

/// @name Error messages
/// @{
static const char* errorInvalidOutExtension = "output filename shall have .glTF or .glb extension.";
/// @}

/// Transcode STEP to glTF
static int step2gltf(char *in, char *out)
{
    Standard_Boolean gltfIsBinary = Standard_False;

    // glTF format depends on output file extension
    const char* out_ext = strrchr(out, '.');
    if (!out_ext) {
        std::cerr << "Error: " << errorInvalidOutExtension << std::endl;
        return 1;
    } else if (strcasecmp(out_ext, ".gltf") == 0) {
        gltfIsBinary = Standard_False;
    } else if (strcasecmp(out_ext, ".glb") == 0) {
        gltfIsBinary = Standard_True;
    } else {
        std::cerr << "Error: " << errorInvalidOutExtension << std::endl;
        return 1;
    }

    const auto started = std::chrono::steady_clock::now();
    auto phaseStarted = started;
    auto reportPhase = [&](const char* name) {
        const auto now = std::chrono::steady_clock::now();
        if (g_verbose_level >= 1)
            std::cout << name << ": "
                      << std::chrono::duration<double>(now - phaseStarted).count()
                      << " s (total " << std::chrono::duration<double>(now - started).count()
                      << " s)" << std::endl;
        phaseStarted = now;
    };

    // Creating XCAF document
    Handle(TDocStd_Document) doc;
    Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
    app->NewDocument("MDTV-XCAF", doc);

    if (g_verbose_level >= 1) {
        std::cout << "Loading \"" << in << "\" ..." << std::endl;
    }

    std::vector<TopoDS_Shape> transferredShapes;
    {
        // Loading STEP file
        STEPCAFControl_Reader stepReader;
        if (IFSelect_RetDone != stepReader.ReadFile((Standard_CString)in)) {
            std::cerr << "Error: Failed to read STEP file \"" << in << "\" !" << std::endl;
            doc->Close();
            return 1;
        }
        reportPhase("STEP read");
        stepReader.SetColorMode(true);
        stepReader.SetNameMode(true);
        stepReader.SetLayerMode(true);

        if (g_verbose_level >= 1) {
            std::cout << "Parsing STEP ..." << std::endl;
        }

        // Transferring to XCAF
        if (!stepReader.Transfer( doc )) {
            std::cerr << "Error: Failed to read STEP file \"" << in << "\" !" << std::endl;
            doc->Close();
            return 1;
        }

        reportPhase("STEP transfer");
        if (!g_preview) {
            const auto& reader = stepReader.Reader();
            for (int i = 1; i <= reader.NbShapes(); ++i)
                transferredShapes.push_back(reader.Shape(i));
        }
    } // Release STEP entities and transfer maps before allocating meshes.
    reportPhase("STEP reader release");

    if (g_verbose_level >= 1) {
        std::cout << "Meshing shapes (linear " << g_theLinDeflection
                  << ", angular " << g_theAngDeflection << ") ..." << std::endl;
    }

    if (g_preview) {
        auto preview = makePreview(doc, g_theLinDeflection, g_theAngDeflection,
                                   g_deepLinear, g_deepAngular, g_deepRatio, g_deepError);
        app->Close(doc); // The application otherwise retains the source document.
        doc = preview;
    } else {
        for (const auto& shape : transferredShapes) {
            if (!shape.IsNull()) {
                BRepMesh_IncrementalMesh mesh(shape, g_theLinDeflection, false,
                                             g_theAngDeflection, true);
            }
        }
    }

    reportPhase("Meshing and preview");
    TColStd_IndexedDataMapOfStringString theFileInfo;

    if (g_verbose_level >= 1) {
        std::cout << "Saving to " << (gltfIsBinary ? "binary " : "") << "glTF ..." << std::endl;
    }

    RWGltf_CafWriter cafWriter(out, gltfIsBinary);
    cafWriter.SetMergeFaces(true); // Merge faces within each part, preserving assembly nodes.
    if (g_preview) {
        cafWriter.SetSplitIndices16(true); // Bound decoder memory per primitive.
        RWGltf_DracoParameters compression;
        compression.DracoCompression = true;
        compression.CompressionLevel = 0; // OCCT passes this as Draco speed: 0 = smallest.
        compression.QuantizePositionBits = 22;
        cafWriter.SetCompressionParameters(compression);
    }
    // SetTransformationFormat (RWGltf_WriterTrsfFormat theFormat)
    // https://dev.opencascade.org/doc/refman/html/_r_w_gltf___writer_trsf_format_8hxx.html#a24e114d176d2b2254deac8f1b3e95bf7

    if (!cafWriter.Perform(doc, theFileInfo, Message_ProgressRange())) {
        std::cerr << "Error: Failed to write " << (gltfIsBinary ? "binary " : "") << "glTF to file !" << std::endl;
        return 1;
    }

    reportPhase("glTF export");
    return 0;
}


static void show_usage(const char* app)
{
    std::cerr << "step2gltf - A tool to convert STEP to glTF with OpenCascade" << std::endl;
    std::cerr << std::endl;
    std::cerr << "Usage:" << std::endl;
    std::cerr << "    step2gltf [OPTIONS] IN_STEP_FILE OUT_GLTF_FILE" << std::endl;
    std::cerr << std::endl;
    std::cerr << "Options:" << std::endl;
    std::cerr << "    " << kLinearDeflection << "=FLOAT      Linear deflection (default: " << DefaultLinDeflection << ")" << std::endl;
    std::cerr << "    " << kAngularDeflection << "=FLOAT     Angular deflection (default: " << DefaultAngDeflection << ")" << std::endl;
    std::cerr << "    --preview           Merge level 3+ into level-2 devices and compress with Draco" << std::endl;
    std::cerr << "    --deep-linear=FLOAT Deep geometry deflection (default: 1.0, requires --preview)" << std::endl;
    std::cerr << "    --deep-angular=FLOAT Deep geometry angle in radians (default: 0.8)" << std::endl;
    std::cerr << "    --deep-ratio=FLOAT  Deep triangle target fraction (default: 0.15, 1 disables reduction)" << std::endl;
    std::cerr << "    --deep-error=FLOAT  Relative mesh error limit (default: 0.001)" << std::endl;
    std::cerr << "    -v                  Verbose output" << std::endl;
    std::cerr << "    -h, --help          Display help" << std::endl;
    std::cerr << std::endl;
    std::cerr << "Linear deflection affects final file size." << std::endl;
    std::cerr << std::endl;
    std::cerr << "IN_STEP_FILE is input file in STEP format." << std::endl;
    std::cerr << std::endl;
    std::cerr << "OUT_GLTF_FILE is output file in glTF 2.0 format." << std::endl;
    std::cerr << "File extension defines glTF 2.0 variant:" << std::endl;
    std::cerr << "    \".gltf\" - glTF file and bin file with resourses" << std::endl;
    std::cerr << "    \".glb\"  - binary glTF." << std::endl;
    std::cerr << std::endl;
    std::cerr << "Example usage:" << std::endl;
    std::cerr << "  # Create glTF from STEP file" << std::endl;
    std::cerr << "  step2gltf samples/piggy.step piggy.gltf" << std::endl;
    std::cerr << std::endl;
}


/**
 * @brief Parses command line
 *
 * @return 0 on success, 1 on failure
 */
static Standard_Integer parse_command_line(int argc, char *argv[])
{
    int i;
    char* q;
    for (i = 1; i < argc; i++) {
        char* p = argv[i];

        if (strcmp(p, kHelp) == 0 || strcmp(p, kHelpLong) == 0) {
            show_usage(argv[0]);
            return 1;
        } else if (strcmp(p, "--preview") == 0) {
            g_preview = true;
        } else if (strcmp(p, kVerbose) == 0) {
            if (g_verbose_level < 1)
                g_verbose_level = 1;
        } else if ( ( q = strchr( p, '=' ) ) != NULL ) {
            *q++ = '\0';
            char* end;
            double value = strtod(q, &end);
            if (end == q || *end || !std::isfinite(value) || value <= 0) {
                std::cerr << "Error: Invalid positive number for " << p << std::endl;
                return 1;
            }
            if( strcmp( p, kLinearDeflection ) == 0 ) {
                g_theLinDeflection = value;
            } else if ( strcmp( p, kAngularDeflection ) == 0 ) {
                g_theAngDeflection = value;
            } else if (strcmp(p, "--deep-linear") == 0) {
                g_deepLinear = value;
                g_deepOptionSet = true;
            } else if (strcmp(p, "--deep-angular") == 0) {
                g_deepAngular = value;
                g_deepOptionSet = true;
            } else if (strcmp(p, "--deep-ratio") == 0 || strcmp(p, "--deep-error") == 0) {
                if (value < 0.000001 || value > 1) {
                    std::cerr << "Error: " << p << " must be between 0.000001 and 1" << std::endl;
                    return 1;
                }
                if (strcmp(p, "--deep-ratio") == 0) g_deepRatio = float(value);
                else g_deepError = float(value);
                g_deepOptionSet = true;
            } else {
                std::cerr << "Error: Invalid argument \"" << p << "\"" << std::endl;
                show_usage(argv[0]);
                return 1;
            }
        } else {
            if (i < argc - 2) {
                std::cerr << "Error: Invalid argument \"" << p << "\"" << std::endl;
                show_usage(argv[0]);
                return 1;
            }
            break;
        }
    }

    if (g_deepOptionSet && !g_preview) {
        std::cerr << "Error: --deep-* options require --preview" << std::endl;
        return 1;
    }

    // check if we have filenames to read and write to.
    if (i != argc - 2) {
        std::cerr << "Error: Missing input and output filenames" << std::endl;
        show_usage(argv[0]);
        return 1;
    }

    return 0;
}


Standard_Integer main (int argc, char *argv[])
{
    // Parses command line
    if (parse_command_line(argc, argv) != 0) {
        return 1;
    }

    if (g_theAngDeflection >= 3.141592653589793 || g_deepAngular >= 3.141592653589793) {
        std::cerr << "Error: Angular deflection must be less than pi radians" << std::endl;
        return 1;
    }
    try {
        return step2gltf(argv[argc-2], argv[argc-1]);
    } catch (const Standard_Failure& error) {
        std::cerr << "Error: " << error.GetMessageString() << std::endl;
        return 1;
    }
}
