// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

// ipcEndpointFits is always so on Windows: the node's IPC is a named pipe,
// not a path in the data directory.
func ipcEndpointFits(endpoint string) bool { return true }
