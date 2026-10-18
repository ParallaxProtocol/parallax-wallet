// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build unix && !linux && !(darwin && cgo)

package backend

// hardenedRuntime is macOS's (codesign_darwin.go), read through cgo: a
// build without it, or another system, can't say, and doesn't claim it.
func hardenedRuntime() bool { return false }
