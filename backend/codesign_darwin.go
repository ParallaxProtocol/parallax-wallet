// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build darwin && cgo

package backend

/*
#include <sys/types.h>
#include <stdint.h>
#include <unistd.h>

// The kernel's code-signing operations (libsystem_kernel); not in the SDK's public headers
int csops(pid_t pid, unsigned int ops, void *useraddr, size_t usersize);

static int ownCodeSignFlags(uint32_t *flags) {
	return csops(getpid(), 0, flags, sizeof(*flags));
}
*/
import "C"

// The code-signing status flags read here (xnu's osfmk/kern/cs_blobs.h).
const (
	csValid        = 0x00000001 // the signature is valid
	csGetTaskAllow = 0x00000004 // a debugger may attach: the get-task-allow entitlement
	csRuntime      = 0x00010000 // the hardened runtime
)

// hardenedRuntime reports whether this process runs signed with the
// hardened runtime and without get-task-allow, as the kernel holds it now:
// then no other program may have its task port (task_for_pid), the way
// in to read or write its memory or attach to it, short of root.
func hardenedRuntime() bool {
	var flags C.uint32_t
	if C.ownCodeSignFlags(&flags) != 0 {
		return false
	}
	f := uint32(flags)
	return f&csValid != 0 && f&csRuntime != 0 && f&csGetTaskAllow == 0
}
