// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build !linux

package backend

// HardwareRandom says nothing here: the system mixes in what hardware
// sources it has itself, out of the app's sight.
func HardwareRandom() bool { return false }
