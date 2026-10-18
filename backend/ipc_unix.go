// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build unix

package backend

import "syscall"

// ipcEndpointFits reports whether a Unix socket can be made at endpoint:
// its path, and the null after it, within the socket address's room (103
// characters on macOS, 107 on Linux). One that doesn't fit fails the
// node's start (the daemon's rpc.ipcListen).
func ipcEndpointFits(endpoint string) bool {
	return len(endpoint)+1 <= len(syscall.RawSockaddrUnix{}.Path)
}

// ipcName is the node's IPC socket, a file in its data directory: as
// unique as the directory is.
func ipcName(dataDir string) string { return "parallax.ipc" }
