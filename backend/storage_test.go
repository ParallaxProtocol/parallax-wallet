// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestStorageDest(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "data")
	writeFile(t, filepath.Join(src, "a"), "a")
	empty := filepath.Join(root, "empty")
	if err := os.Mkdir(empty, 0o700); err != nil {
		t.Fatal(err)
	}
	busy := filepath.Join(root, "busy")
	writeFile(t, filepath.Join(busy, "other"), "x")
	taken := filepath.Join(root, "taken")
	writeFile(t, filepath.Join(taken, "x"), "x")
	writeFile(t, filepath.Join(taken, nodeFolderName, "y"), "y")

	for _, tc := range []struct {
		name, chosen, want string
		err                error
	}{
		{"empty folder", empty, empty, nil},
		{"new folder", filepath.Join(root, "new"), filepath.Join(root, "new"), nil},
		{"folder in use", busy, filepath.Join(busy, nodeFolderName), nil},
		{"its subfolder in use", taken, "", ErrStorageNotEmpty},
		{"relative", "data2", "", ErrStorageNotAbs},
		{"itself", src, "", ErrStorageInside},
		{"inside", filepath.Join(src, "sub"), "", ErrStorageInside},
	} {
		got, err := storageDest(tc.chosen, nodeFolderName, src)
		if !errors.Is(err, tc.err) || got != tc.want {
			t.Errorf("%s: storageDest = %q, %v; want %q, %v", tc.name, got, err, tc.want, tc.err)
		}
	}
}

func TestMoveTreeMovesEverything(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "data")
	writeFile(t, filepath.Join(src, "chaindata", "000001.ldb"), "blocks")
	writeFile(t, filepath.Join(src, "nodekey"), "key")
	dst := filepath.Join(root, "moved")
	var done, total int64
	if err := moveTree(src, dst, func(d, t int64) { done, total = d, t }); err != nil {
		t.Fatalf("moveTree: %v", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("the original is still there: %v", err)
	}
	if b, err := os.ReadFile(filepath.Join(dst, "chaindata", "000001.ldb")); err != nil || string(b) != "blocks" {
		t.Errorf("moved chain data = %q, %v", b, err)
	}
	if done != total || total != int64(len("blocks")+len("key")) {
		t.Errorf("progress = %d of %d", done, total)
	}
}

func TestCopyTreeKeepsFilesAndModes(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src")
	writeFile(t, filepath.Join(src, "dir", "file"), "contents")
	dst := filepath.Join(root, "dst")
	if err := copyTree(src, dst, nil); err != nil {
		t.Fatalf("copyTree: %v", err)
	}
	if err := sameTree(src, dst); err != nil {
		t.Errorf("sameTree: %v", err)
	}
	info, err := os.Stat(filepath.Join(dst, "dir", "file"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("copied file's mode = %v, %v; want 0600", info, err)
	}
}

func TestClearFreezerLeavesOtherFiles(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"FLOCK", "headers.cidx", "headers.meta", "headers.0000.cdat", "receipts.0012.rdat", "bodies.ridx"} {
		writeFile(t, filepath.Join(dir, name), "x")
	}
	writeFile(t, filepath.Join(dir, "notes.txt"), "mine")
	writeFile(t, filepath.Join(dir, "photos", "a.jpg"), "mine")
	if err := clearFreezer(dir); err != nil {
		t.Fatalf("clearFreezer: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Errorf("left %v; want only notes.txt and photos", entries)
	}
}

func TestWalletCopyAndFinishMove(t *testing.T) {
	w, dir := newTestWallet(t)
	if _, err := w.Create("Savings", testPassword); err != nil {
		t.Fatal(err)
	}
	// The app's config folder holds more than the wallet
	writeFile(t, filepath.Join(dir, "gui.json"), "{}")
	cfg, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	dest, err := w.CopyTo(filepath.Join(t.TempDir(), "wallet"))
	if err != nil {
		t.Fatalf("CopyTo: %v", err)
	}
	for _, name := range []string{"keystore", sealedMeta, vaultFileName} {
		if _, err := os.Stat(filepath.Join(dest, name)); err != nil {
			t.Errorf("the copy lacks %s: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dest, "gui.json")); !os.IsNotExist(err) {
		t.Errorf("the app's config was copied with the wallet")
	}

	g := cfg.Get()
	g.WalletDir, g.WalletMovedFrom = dest, dir
	if err := cfg.Save(g); err != nil {
		t.Fatal(err)
	}
	moved, err := NewWallet(dest, nil)
	if err != nil {
		t.Fatalf("NewWallet on the copy: %v", err)
	}
	waitForAccounts(t, moved, 1)
	FinishWalletMove(cfg)
	if _, err := os.Stat(filepath.Join(dir, "keystore")); !os.IsNotExist(err) {
		t.Errorf("the original keystore is still there: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "gui.json")); err != nil {
		t.Errorf("the app's config went with the wallet: %v", err)
	}
	if cfg.Get().WalletMovedFrom != "" {
		t.Errorf("WalletMovedFrom = %q after the move finished", cfg.Get().WalletMovedFrom)
	}
}

func TestFinishWalletMoveKeepsADifferingOriginal(t *testing.T) {
	from := t.TempDir()
	to := t.TempDir()
	writeFile(t, filepath.Join(from, "wallet.json"), `{"selected":"a"}`)
	writeFile(t, filepath.Join(to, "wallet.json"), `{"selected":"b"}`)
	cfg, err := LoadConfigStore(filepath.Join(t.TempDir(), "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	g := cfg.Get()
	g.WalletDir, g.WalletMovedFrom = to, from
	if err := cfg.Save(g); err != nil {
		t.Fatal(err)
	}
	FinishWalletMove(cfg)
	if _, err := os.Stat(filepath.Join(from, "wallet.json")); err != nil {
		t.Errorf("the original was deleted though its copy differs: %v", err)
	}
}

func TestWalletWipe(t *testing.T) {
	w, dir := newTestWallet(t)
	if _, err := w.Create("Savings", testPassword); err != nil {
		t.Fatal(err)
	}
	if err := w.Wipe("not the password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Wipe with a wrong password = %v; want ErrWrongPassword", err)
	}
	if len(w.Info().Accounts) != 1 {
		t.Fatalf("a wrong password wiped the wallet")
	}
	if err := w.Wipe(testPassword); err != nil {
		t.Fatalf("Wipe: %v", err)
	}
	info := w.Info()
	if len(info.Accounts) != 0 || info.HasPassword || info.NeedsSetup {
		t.Errorf("Info after Wipe = %+v; want an empty wallet with no password", info)
	}
	for _, name := range walletFiles[1:] {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s is still there", name)
		}
	}
	// As on a first launch: a password can be set again
	if err := w.SetupPassword(testPassword); err != nil {
		t.Errorf("SetupPassword after Wipe: %v", err)
	}
}

// newDevController is a node controller, its node not running, on the
// development chain with its data in root/data and the chain's own folder
// beside it (nodeDataDir).
func newDevController(t *testing.T, root string) (*NodeController, *ConfigStore) {
	t.Helper()
	t.Setenv("PARALLAX_DEV", "1")
	cfg, err := LoadConfigStore(filepath.Join(root, "config", "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	g := cfg.Get()
	g.DataDir = filepath.Join(root, "data")
	g.DevChain = true
	if err := cfg.Save(g); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "data", "nodekey"), "key")
	writeFile(t, filepath.Join(root, "data-dev", "default", "chaindata", "000001.ldb"), "dev blocks")
	return NewNodeController(cfg), cfg
}

// The development chain's own folder goes with the data directory, where
// the moved one looks for it: its chain kept, nothing left behind.
func TestMoveDataDirTakesTheDevChain(t *testing.T) {
	root := t.TempDir()
	n, cfg := newDevController(t, root)
	to := filepath.Join(root, "moved")
	if err := os.Mkdir(to, 0o700); err != nil {
		t.Fatal(err)
	}
	dest, err := n.MoveDataDir(context.Background(), to, nil)
	if err != nil {
		t.Fatalf("MoveDataDir: %v", err)
	}
	if dest != to || cfg.Get().DataDir != to {
		t.Errorf("moved to %q, config says %q, want %q", dest, cfg.Get().DataDir, to)
	}
	if b, err := os.ReadFile(filepath.Join(to+"-dev", "default", "chaindata", "000001.ldb")); err != nil || string(b) != "dev blocks" {
		t.Errorf("the development chain moved = %q, %v", b, err)
	}
	if got := nodeDataDir(cfg.Get()); got != filepath.Join(to+"-dev", "default") {
		t.Errorf("the node would look in %q", got)
	}
	for _, left := range []string{"data", "data-dev"} {
		if _, err := os.Stat(filepath.Join(root, left)); !os.IsNotExist(err) {
			t.Errorf("%s left behind: %v", left, err)
		}
	}
}

// If the development chain's folder can't follow, the data directory comes
// back: nothing is left half moved, and the config is as it was.
func TestMoveDataDirUndoneIfTheDevChainCantFollow(t *testing.T) {
	root := t.TempDir()
	n, cfg := newDevController(t, root)
	to := filepath.Join(root, "moved")
	if err := os.Mkdir(to, 0o700); err != nil {
		t.Fatal(err)
	}
	// Something already where the chain's folder would go
	writeFile(t, filepath.Join(to+"-dev", "someone else's"), "kept")
	if _, err := n.MoveDataDir(context.Background(), to, nil); err == nil {
		t.Fatal("MoveDataDir moved over another folder")
	}
	if cfg.Get().DataDir != filepath.Join(root, "data") {
		t.Errorf("config says %q", cfg.Get().DataDir)
	}
	if b, err := os.ReadFile(filepath.Join(root, "data", "nodekey")); err != nil || string(b) != "key" {
		t.Errorf("the data directory came back as %q, %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(root, "data-dev", "default", "chaindata", "000001.ldb")); err != nil || string(b) != "dev blocks" {
		t.Errorf("the development chain = %q, %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(to+"-dev", "someone else's")); err != nil || string(b) != "kept" {
		t.Errorf("the other folder = %q, %v", b, err)
	}
}
