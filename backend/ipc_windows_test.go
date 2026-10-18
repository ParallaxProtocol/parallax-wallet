// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"strings"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/node"
)

// The default data directory's node keeps the pipe tools look for; every
// other has one of its own, the same each time, whatever its case.
func TestIPCName(t *testing.T) {
	if got := ipcName(node.DefaultDataDir()); got != "parallax.ipc" {
		t.Errorf("the default data directory's pipe = %q", got)
	}
	a, b := ipcName(`C:\Nodes\one`), ipcName(`C:\Nodes\two`)
	if a == b || a == "parallax.ipc" || !strings.HasPrefix(a, "parallax-") {
		t.Errorf("two data directories' pipes: %q and %q", a, b)
	}
	if again := ipcName(`c:\nodes\ONE\`); again != a {
		t.Errorf("the same directory named otherwise: %q, want %q", again, a)
	}
}
