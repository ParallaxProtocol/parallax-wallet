// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build unix

package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A data directory with room for the IPC socket keeps it; one too deep
// for its path runs the node without it, rather than failing its start.
func TestIPCWhereTheSocketFits(t *testing.T) {
	// Under /tmp, as macOS's own temporary folders (/var/folders/…) leave
	// a test's too little of a socket's 104 bytes
	short, err := os.MkdirTemp("/tmp", "ipc")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(short) })
	g := defaultGUIConfig()
	g.DataDir = filepath.Join(short, "data")
	nodeCfg, _, err := buildConfigs(g)
	if err != nil {
		t.Fatal(err)
	}
	if !ipcEndpointFits(nodeCfg.IPCEndpoint()) || nodeCfg.IPCPath == "" {
		t.Fatalf("IPC at %q left out", nodeCfg.IPCEndpoint())
	}

	g.DataDir = filepath.Join("/tmp", strings.Repeat("deep/", 30), "data")
	if nodeCfg, _, err = buildConfigs(g); err != nil {
		t.Fatal(err)
	}
	if nodeCfg.IPCPath != "" {
		t.Fatalf("IPC kept at %q, too long a path for a socket", nodeCfg.IPCEndpoint())
	}
}
