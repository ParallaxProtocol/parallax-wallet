// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"runtime"
	"strings"
	"testing"
)

// What DevGoroutines gives is where each goroutine is, and no value it
// was called with: no address, no word of what a function held.
func TestStacksWithoutValues(t *testing.T) {
	buf := make([]byte, 1<<20)
	raw := string(buf[:runtime.Stack(buf, true)])
	if !strings.Contains(raw, "0x") {
		t.Fatal("the raw stacks have no values to leave out: the test shows nothing")
	}
	got := stacksWithoutValues(raw)
	if strings.Contains(got, "0x") {
		t.Errorf("a value is left:\n%s", got)
	}
	for _, kept := range []string{"goroutine ", "TestStacksWithoutValues(...)", "devgoroutines_test.go:"} {
		if !strings.Contains(got, kept) {
			t.Errorf("%q is gone:\n%s", kept, got)
		}
	}
}

// This test binary is built as a release is, without the development
// features: PARALLAX_DEV set, DevGoroutines still refuses.
func TestDevGoroutinesRefusedInARelease(t *testing.T) {
	t.Setenv("PARALLAX_DEV", "1")
	if _, err := (&App{}).DevGoroutines(); err == nil {
		t.Fatal("a release build gave its goroutines for PARALLAX_DEV alone")
	}
}
