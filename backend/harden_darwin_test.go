// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build darwin && cgo

package backend

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ParallaxProtocol/parallax-wallet/backend/internal/taskport"
)

// signedChild is set in the processes TestHardenedRuntime starts, signed
// as it signs them, to say how they stand and wait to be tried.
const signedChild = "PARALLAX_TEST_SIGNED_CHILD"

// TestHardenedRuntime signs a copy of this test with the hardened runtime,
// as the app is signed (desktop/electron-builder.yml), and one without,
// and tries each from here for its task port, as another program would
// to read its memory. The hardened one says it's shielded and isn't given
// to another program of the user; run as root, the other is given, which
// shows the try is a real one, and the hardened one's answer is logged.
func TestHardenedRuntime(t *testing.T) {
	if os.Getenv(signedChild) == "1" {
		signedChildMain()
		return
	}
	root := os.Geteuid() == 0
	hardened, hg := startSigned(t, "hardened", "--options", "runtime")
	if !hg.NoMemoryReads {
		t.Errorf("signed with the hardened runtime, ProcessGuarded = %+v, want NoMemoryReads", hg)
	}
	kr := taskport.Try(hardened)
	t.Logf("task_for_pid of the hardened process, as uid %d: %d", os.Geteuid(), kr)
	if !root && kr == 0 {
		t.Errorf("another program of the user was given the hardened process's task")
	}

	plain, pg := startSigned(t, "plain")
	if pg.NoMemoryReads {
		t.Errorf("signed without the hardened runtime, ProcessGuarded = %+v, want no NoMemoryReads", pg)
	}
	kr = taskport.Try(plain)
	t.Logf("task_for_pid of the process without it, as uid %d: %d", os.Geteuid(), kr)
	if root && kr != 0 {
		t.Errorf("root wasn't given an unhardened process's task either: the try shows nothing")
	}
}

// startSigned copies this test binary, signs the copy ad hoc with the
// codesign options given, starts it as a signed child and reads how it
// stands. It's ended with the test.
func startSigned(t *testing.T, name string, options ...string) (int, ProcessGuard) {
	t.Helper()
	bin := filepath.Join(t.TempDir(), name)
	// The updater's copy (updater.go), made runnable
	if err := copyFile(os.Args[0], bin); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	sign := append([]string{"--force", "--sign", "-"}, options...)
	if out, err := exec.Command("codesign", append(sign, bin)...).CombinedOutput(); err != nil {
		t.Fatalf("codesign %s: %v\n%s", name, err, out)
	}
	cmd := exec.Command(bin, "-test.run=^TestHardenedRuntime$")
	cmd.Env = append(os.Environ(), signedChild+"=1")
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stdin.Close()
		cmd.Wait()
	})
	var report struct{ Guard ProcessGuard }
	line, err := bufio.NewReader(stdout).ReadBytes('\n')
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	if err := json.Unmarshal(line, &report); err != nil {
		t.Fatalf("%s said %q: %v", name, line, err)
	}
	return cmd.Process.Pid, report.Guard
}

// signedChildMain hardens itself as the backend does, says how it stands,
// and waits for stdin to close.
func signedChildMain() {
	HardenProcess()
	json.NewEncoder(os.Stdout).Encode(map[string]any{"Guard": ProcessGuarded()})
	bufio.NewReader(os.Stdin).ReadBytes('\n')
}
