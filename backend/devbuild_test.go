// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import "testing"

// The tests are a build made for the development features, as make e2e's
// backend is: PARALLAX_DEV turns them on, as the tests that need them set it.
func init() { devFeatures = "on" }

// A release build, made without them, offers none, whatever its
// environment says; one made with them, only once PARALLAX_DEV asks.
func TestDevBuildNeedsTheBuildAndTheEnvironment(t *testing.T) {
	t.Cleanup(func() { devFeatures = "on" })
	t.Setenv("PARALLAX_DEV", "1")
	devFeatures = ""
	if DevBuild() {
		t.Fatal("a release build turned on the development features from its environment")
	}
	devFeatures = "on"
	if !DevBuild() {
		t.Fatal("a development build with PARALLAX_DEV set has no development features")
	}
	t.Setenv("PARALLAX_DEV", "")
	if DevBuild() {
		t.Fatal("a development build has its development features without PARALLAX_DEV")
	}
}
