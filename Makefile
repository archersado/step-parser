STATIC ?= 0

UNAME := $(shell uname -a)
OCCTINCLUDE := $(firstword $(wildcard $(CURDIR)/.local-build/occt/include/opencascade /opt/homebrew/opt/opencascade/include/opencascade /opt/homebrew/include/opencascade /usr/local/include/opencascade /usr/include/opencascade))
OPENCASCADEINC ?= $(if $(OCCTINCLUDE),$(OCCTINCLUDE),/usr/include/opencascade)
OPENCASCADELIB ?= $(patsubst %/include/opencascade,%/lib,$(OPENCASCADEINC))

ifneq ($(STATIC),1)
ifneq ($(wildcard $(OPENCASCADELIB)/libTKDESTEP.*),)
OCCLIBS = -lTKDESTEP -lTKDEGLTF -lTKXCAF -lTKCDF -lTKLCAF -lTKRWMesh \
-lTKTopAlgo -lTKBRep -lTKG2d -lTKG3d -lTKGeomBase -lTKMath -lTKMesh -lTKXSBase -lTKernel
else
OCCLIBS= \
-lTKXCAF -lTKXDESTEP -lTKCDF -lTKRWMesh \
-lTKTopAlgo -lTKBRep -lTKG2d -lTKG3d -lTKGeomBase \
-lTKMath -lTKMesh -lTKSTEP -lTKSTEP209 \
-lTKSTEPAttr -lTKSTEPBase -lTKSTL -lTKXSBase -lTKernel
endif
else
OCCLIBS = $(wildcard $(OPENCASCADELIB)/libTK*.a)
endif

$(info Using OPENCASCADEINC as "${OPENCASCADEINC}")
$(info Using OPENCASCADELIB as "${OPENCASCADELIB}")

CXXFLAGS += -std=c++17 -I$(OPENCASCADEINC)
MESHOPTROOT ?= $(CURDIR)/.local-build/meshoptimizer
CXXFLAGS += -I$(MESHOPTROOT)/include
LDFLAGS += -L$(OPENCASCADELIB)
LDFLAGS += -L$(MESHOPTROOT)/lib -lmeshoptimizer

ifneq ($(STATIC),1)
LDFLAGS += -Wl,-rpath,$(OPENCASCADELIB) $(OCCLIBS)
else
LDFLAGS += -Wl,--start-group -Wl,-Bstatic $(OCCLIBS) -Wl,--end-group
LDFLAGS += -lfontconfig -lfreetype -lexpatw -lpng -lz -Wl,-Bdynamic  -lpthread -ldl
endif

ifeq (Darwin,$(findstring Darwin,$(UNAME)))
CXX=clang++ -stdlib=libc++
else
CXX=g++
endif

#---------------------------------------------------------------------
#targets
#---------------------------------------------------------------------

ifeq "$(MAKECMDGOALS)" ""
 CXXFLAGS += -ggdb3
endif
ifeq "$(MAKECMDGOALS)" "profile"
 CXXFLAGS += -pg -ggdb3
 LDFLAGS += -pg
endif

# Determine where we should output the object files.
OUTDIR = debug
ifeq "$(MAKECMDGOALS)" "debug"
 OUTDIR = debug
 CXXFLAGS += -ggdb3
endif
ifeq "$(MAKECMDGOALS)" "release"
 OUTDIR = release
 CXXFLAGS += -O3
endif
ifeq "$(MAKECMDGOALS)" "profile"
 OUTDIR = profile
endif

# Add .d to Make's recognized suffixes.
SUFFIXES += .d

# We don't need to clean up when we're making these targets
NODEPS:=clean

#Find all the C++ files in the src/ directory
#SOURCES:=$(shell find * -name '*.cpp' | sort)
SOURCES:=$(shell ls *.cpp | sort)
OBJS:=$(patsubst %.cpp,%.o,$(SOURCES))

#These are the dependency files, which make will clean up after it creates them
DEPFILES:=$(patsubst %.cpp,%.d,$(SOURCES))

#Don't create dependencies when we're cleaning, for instance
ifeq (0, $(words $(findstring $(MAKECMDGOALS), $(NODEPS))))
    -include $(DEPFILES)
endif

EXE = step2gltf

all:	$(EXE)

debug:	$(EXE)

release:$(EXE)

profile:$(EXE)

$(EXE): $(OBJS)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@

#This is the rule for creating the dependency files
deps/%.d: %.cpp
	$(CXX) $(CXXFLAGS) -MM -MT '$(patsubst src/%,obj/%,$(patsubst %.cpp,%.o,$<))' $< > $@

#This rule does the compilation
obj/%.o: %.cpp %.d %.h
	@$(MKDIR) $(dir $@)
	$(CXX) --static $(CXXFLAGS) -o $@ -c $<

# make clean && svn update
clean:
	bash -c 'rm -f *.o $(OBJS) $(EXE)'

OCCLIBS_DIR = /usr/local/lib
OCCLIBS_FILES = $(patsubst -l%,lib%.so,$(OCCLIBS))

install:
	install -Dp -m 0755 $(EXE) $(DESTDIR)/usr/bin/$(EXE)

uninstall:
	rm -f $(DESTDIR)/usr/bin/$(EXE)

# make debian package
debian-package:
	dpkg-buildpackage -b -rfakeroot -us -uc

main.o: preview.hxx

.PHONY: check
check:
	$(CXX) $(CXXFLAGS) -I. tests/preview.cpp $(LDFLAGS) -lTKPrim -o .local-build/preview-check
	.local-build/preview-check
