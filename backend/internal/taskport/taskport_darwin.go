// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build darwin && cgo

// Package taskport asks for another process's task port, the way in to
// read or write its memory on macOS, for the backend's hardening test
// (backend/harden_darwin_test.go): cgo can't be in a test file itself.
package taskport

/*
#include <mach/mach.h>

// Released at once if given: only whether it was is wanted.
static kern_return_t taskFor(int pid) {
	mach_port_t task = MACH_PORT_NULL;
	kern_return_t kr = task_for_pid(mach_task_self(), pid, &task);
	if (kr == KERN_SUCCESS)
		mach_port_deallocate(mach_task_self(), task);
	return kr;
}
*/
import "C"

// Try asks for pid's task port and returns the kernel's answer:
// 0 (KERN_SUCCESS) if it was given.
func Try(pid int) int { return int(C.taskFor(C.int(pid))) }
