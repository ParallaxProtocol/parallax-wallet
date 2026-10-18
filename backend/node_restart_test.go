// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import "testing"

func TestNodeSettingsDiffer(t *testing.T) {
	base := defaultGUIConfig()
	cases := []struct {
		name   string
		change func(*GUIConfig)
		want   bool
	}{
		{"nothing", func(*GUIConfig) {}, false},
		{"a node setting", func(g *GUIConfig) { g.MaxPeers = 10 }, true},
		{"a pointer set", func(g *GUIConfig) { v := 0; g.MinFreeDiskMB = &v }, true},
		{"the Tor switch", func(g *GUIConfig) { g.Tor = true }, true},
		{"the theme", func(g *GUIConfig) { g.Theme = "dark" }, false},
		{"a peer pinned from the peer list", func(g *GUIConfig) { g.StaticPeers = []string{"enode://x@1.2.3.4:30303"} }, false},
		{"the assistant server", func(g *GUIConfig) { g.MCPEnabled = true; g.MCPPort = 9000 }, false},
		{"metrics, for the app's restart", func(g *GUIConfig) { g.Metrics = true }, false},
		{"a list left empty", func(g *GUIConfig) { g.Bootnodes = []string{} }, false},
		{"a list filled", func(g *GUIConfig) { g.Bootnodes = []string{"1.2.3.4:30303"} }, true},
	}
	for _, c := range cases {
		now := base
		c.change(&now)
		if got := nodeSettingsDiffer(base, now); got != c.want {
			t.Errorf("%s: nodeSettingsDiffer = %v, want %v", c.name, got, c.want)
		}
	}
}

// Every field Settings applies without a node restart is one the backend
// knows: a key misspelt in liveSettings would wait on a restart for nothing.
func TestLiveSettingsAreFields(t *testing.T) {
	m, err := configMap(defaultGUIConfig())
	if err != nil {
		t.Fatal(err)
	}
	for k := range liveSettings {
		if _, ok := m[k]; !ok {
			t.Errorf("liveSettings names %q, which isn't a config field", k)
		}
	}
}
