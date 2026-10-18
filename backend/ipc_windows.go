// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"

	"github.com/ParallaxProtocol/parallax/v2/node"
)

// ipcEndpointFits is always so on Windows: the node's IPC is a named pipe,
// not a path in the data directory.
func ipcEndpointFits(endpoint string) bool { return true }

// ipcName is the node's IPC pipe. A named pipe is the whole computer's,
// not the data directory's: two nodes under one name, the app's and
// parallaxd's, or a development chain's beside the main one, and the
// second's start is refused ("Access is denied"). The default data
// directory's node keeps the usual name, where tools look for it; any
// other is named after its directory, the same each time it starts.
func ipcName(dataDir string) string {
	dir := strings.ToLower(filepath.Clean(dataDir))
	if dir == strings.ToLower(filepath.Clean(node.DefaultDataDir())) {
		return "parallax.ipc"
	}
	sum := sha256.Sum256([]byte(dir))
	return "parallax-" + hex.EncodeToString(sum[:6]) + ".ipc"
}
