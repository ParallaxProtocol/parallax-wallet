// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build unix && !linux

package backend

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// HardenProcess keeps the backend's memory, where passwords, recovery
// phrases and keys pass while the wallet uses them, out of a core dump if
// it crashes. macOS has no equivalent of Linux's non-dumpable flag: other
// processes reading this one's memory is up to the hardened runtime the
// app is signed with. Run first thing, before any secret is in memory.
func HardenProcess() error {
	if err := unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{}); err != nil {
		return fmt.Errorf("core dump limit: %w", err)
	}
	return nil
}

// ProcessGuarded reads back what HardenProcess set, as it stands now, and
// on macOS whether the code signature keeps other programs out of the
// process's memory: the hardened runtime, without get-task-allow, as the
// kernel holds it (codesign_darwin.go). A development build isn't signed
// so, and says no.
func ProcessGuarded() ProcessGuard {
	var lim unix.Rlimit
	return ProcessGuard{
		NoCoreDumps:   unix.Getrlimit(unix.RLIMIT_CORE, &lim) == nil && lim.Cur == 0,
		NoMemoryReads: hardenedRuntime(),
	}
}

// processDiskBytes reads nothing here: the daemon's disk metrics stand.
func processDiskBytes() (read, written uint64, ok bool) { return 0, 0, false }

// HardenShell has nothing to do here: one process can't restrict
// another's access the way Windows lets it.
func HardenShell(pids []int) error { return nil }
