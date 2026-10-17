// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !windows

// Command probe is Windows' (probe_windows.go): elsewhere it has nothing to try.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "probe: Windows only")
	os.Exit(2)
}
