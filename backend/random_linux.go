// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"os"
)

// HardwareRandom reports whether the processor has a hardware random
// source, which the kernel mixes into the generator every key comes from
// (crypto/rand's getrandom): RDRAND or RDSEED on x86, RNDR on arm64 (the
// "rng" feature).
func HardwareRandom() bool {
	info, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return false
	}
	for _, line := range bytes.Split(info, []byte("\n")) {
		name, list, ok := bytes.Cut(line, []byte(":"))
		if !ok {
			continue
		}
		if name := string(bytes.TrimSpace(name)); name != "flags" && name != "Features" {
			continue
		}
		for _, f := range bytes.Fields(list) {
			if s := string(f); s == "rdrand" || s == "rdseed" || s == "rng" {
				return true
			}
		}
	}
	return false
}
