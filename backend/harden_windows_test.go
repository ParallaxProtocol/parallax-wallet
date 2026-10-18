// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/wallet/usbwallet"
	"golang.org/x/sys/windows"
)

// hardenedChild is set in the process TestHardenProcess starts, which
// hardens itself and waits to be looked at.
const hardenedChild = "PARALLAX_TEST_HARDENED_CHILD"

// TestHardenProcess hardens a process of its own and tries it from this
// one, running as the same user, as another program would: it can't read
// or write its memory or rewrite its access list, but can wait on it, ask
// about it and end it. The hardened process still reaches what the app
// uses after it: the hardware wallets' USB code and name lookups.
func TestHardenProcess(t *testing.T) {
	if os.Getenv(hardenedChild) == "1" {
		hardenedMain()
		return
	}
	// This process tries the other as an ordinary program of the same user
	// would: without the debug privilege an administrator's process (a CI
	// runner's) may hold, which passes any access list
	if err := dropDebugPrivilege(); err != nil {
		t.Fatalf("dropping the debug privilege: %v", err)
	}
	t.Logf("this process's token had SeDebugPrivilege: %v (enabled: %v); still has it after dropping: %v",
		debugPrivilegeHeld, debugPrivilegeEnabled, debugPrivilegeLeft)
	cmd := exec.Command(os.Args[0], "-test.run=^TestHardenProcess$")
	cmd.Env = append(os.Environ(), hardenedChild+"=1")
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
	defer cmd.Wait()
	defer stdin.Close()

	// The child says how it stands once hardened, or why it couldn't be
	var report struct {
		Error string
		Guard ProcessGuard
	}
	line, err := bufio.NewReader(stdout).ReadBytes('\n')
	if err != nil {
		t.Fatalf("child: %v", err)
	}
	if err := json.Unmarshal(line, &report); err != nil {
		t.Fatalf("child said %q: %v", line, err)
	}
	if report.Error != "" {
		t.Fatalf("child: %s", report.Error)
	}
	if g := report.Guard; !g.NoMemoryReads || !g.NoCoreDumps || !g.SignedCodeOnly {
		t.Fatalf("ProcessGuarded = %+v, want all", g)
	}

	pid := uint32(cmd.Process.Pid)
	for _, denied := range []struct {
		name   string
		access uint32
	}{
		{"read its memory", windows.PROCESS_VM_READ},
		{"write its memory", windows.PROCESS_VM_WRITE | windows.PROCESS_VM_OPERATION},
		{"start a thread in it", windows.PROCESS_CREATE_THREAD},
		{"take its handles", windows.PROCESS_DUP_HANDLE},
		{"rewrite its access list", windows.WRITE_DAC},
	} {
		h, err := windows.OpenProcess(denied.access, false, pid)
		if err == nil {
			windows.CloseHandle(h)
			t.Errorf("another process could %s", denied.name)
		} else if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			t.Errorf("%s: %v, want access denied", denied.name, err)
		}
	}
	h, err := windows.OpenProcess(processOthersMay, false, pid)
	if err != nil {
		t.Fatalf("waiting on it, asking about it and ending it: %v", err)
	}
	windows.CloseHandle(h)
}

// hardenedMain is the hardened child: it hardens itself, uses what the app
// uses after hardening, reports, and waits for stdin to close.
func hardenedMain() {
	say := func(err error) {
		report := map[string]any{"Guard": ProcessGuarded()}
		if err != nil {
			report["Error"] = err.Error()
		}
		json.NewEncoder(os.Stdout).Encode(report)
	}
	if err := HardenProcess(); err != nil {
		say(err)
		return
	}
	// Microsoft's DLLs still load: the ones the USB code takes
	for _, dll := range []string{"hid.dll", "WinUSB.dll"} {
		h, err := windows.LoadLibrary(dll)
		if err != nil {
			say(fmt.Errorf("load %s: %w", dll, err))
			return
		}
		windows.FreeLibrary(h)
	}
	// The hardware wallets' hubs enumerate, by HID (hidapi) and WebUSB (libusb)
	for name, hub := range map[string]func() (*usbwallet.Hub, error){
		"Ledger":        usbwallet.NewLedgerHub,
		"Trezor HID":    usbwallet.NewTrezorHubWithHID,
		"Trezor WebUSB": usbwallet.NewTrezorHubWithWebUSB,
	} {
		h, err := hub()
		if err != nil {
			say(fmt.Errorf("%s hub: %w", name, err))
			return
		}
		h.Wallets()
	}
	if _, err := net.LookupHost("localhost"); err != nil {
		say(fmt.Errorf("name lookup: %w", err))
		return
	}
	say(nil)
	// Kept up while the test tries it
	bufio.NewReader(os.Stdin).ReadBytes('\n')
}

// TestMemoryIntegrity reads Windows' Memory integrity as it runs, which
// Settings' Security shows: it must be readable, on or off.
func TestMemoryIntegrity(t *testing.T) {
	on, known := MemoryIntegrity()
	if !known {
		t.Fatal("Memory integrity couldn't be read")
	}
	t.Logf("Memory integrity on: %v", on)
}
