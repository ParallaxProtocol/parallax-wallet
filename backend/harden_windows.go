// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// HardenProcess keeps the backend's memory, where passwords, recovery
// phrases and keys pass while the wallet uses them, from being copied out
// of it or written into. Run first thing, before any secret is in memory.
//
//   - Its access list lets other processes of the same user only wait on
//     it, ask about it and end it: not read or write its memory, start a
//     thread in it, or take its handles. The OWNER RIGHTS entry takes the
//     owner's own standing right to rewrite the list away, which would
//     otherwise undo the rest. An administrator's debug privilege still
//     passes, as root's does on Linux.
//   - Windows Error Reporting leaves it out: a crash writes no dump of its
//     memory, nor sends one.
//   - No code but Microsoft's loads into it after this (the hardware
//     wallets' USB code takes hid.dll and WinUSB.dll, both Microsoft's),
//     none through the legacy injection routes (AppInit DLLs, global
//     hooks), nor from a network share or a low-integrity file.
//
// Its own token loses SeDebugPrivilege first, which it never needs: with
// it enabled, the process would pass any other's access list, and its own
// check of its list (ProcessGuarded) would pass it too, saying nothing.
//
// Each step stands on its own: what fails is reported, the rest still holds.
func HardenProcess() error {
	var errs []error
	if err := dropDebugPrivilege(); err != nil {
		errs = append(errs, fmt.Errorf("debug privilege: %w", err))
	}
	if err := restrictProcessAccess(); err != nil {
		errs = append(errs, fmt.Errorf("access list: %w", err))
	}
	if err := excludeFromErrorReporting(); err != nil {
		errs = append(errs, fmt.Errorf("error reporting: %w", err))
	}
	// Last: every DLL the steps above load is in by now
	for _, p := range []struct {
		name   string
		policy uint32
		flags  uint32
	}{
		{"extension points", processExtensionPointDisablePolicy, 1 /* DisableExtensionPoints */},
		{"image loads", processImageLoadPolicy, 1 | 2 | 4 /* NoRemoteImages, NoLowMandatoryLabelImages, PreferSystem32Images */},
		{"signed code", processSignaturePolicy, 1 /* MicrosoftSignedOnly */},
	} {
		if err := setMitigationPolicy(p.policy, p.flags); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", p.name, err))
		}
	}
	return errors.Join(errs...)
}

// debugPrivilegeHeld is whether the token had SeDebugPrivilege before
// dropDebugPrivilege removed it, and whether it was enabled: an
// administrator's process can start with it on, such as one a CI runner
// starts (harden_windows_test.go says so). debugPrivilegeLeft is whether
// the token still has it afterwards, which it shouldn't.
var debugPrivilegeHeld, debugPrivilegeEnabled, debugPrivilegeLeft bool

// dropDebugPrivilege removes SeDebugPrivilege from the process's token for
// good. A token without it is left as it is.
func dropDebugPrivilege() error {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	var luid windows.LUID
	if err := windows.LookupPrivilegeValue(nil, windows.StringToUTF16Ptr("SeDebugPrivilege"), &luid); err != nil {
		return err
	}
	var err error
	if debugPrivilegeHeld, debugPrivilegeEnabled, err = tokenPrivilege(token, luid); err != nil {
		return err
	}
	if !debugPrivilegeHeld {
		return nil
	}
	remove := windows.Tokenprivileges{PrivilegeCount: 1}
	remove.Privileges[0] = windows.LUIDAndAttributes{Luid: luid, Attributes: windows.SE_PRIVILEGE_REMOVED}
	if err := windows.AdjustTokenPrivileges(token, false, &remove, 0, nil, nil); err != nil {
		return err
	}
	debugPrivilegeLeft, _, err = tokenPrivilege(token, luid)
	if err == nil && debugPrivilegeLeft {
		err = errors.New("still held after removing it")
	}
	return err
}

// tokenPrivilege reads whether a token holds a privilege, and whether
// it's enabled, from the token's own list of them.
func tokenPrivilege(token windows.Token, luid windows.LUID) (held, enabled bool, err error) {
	var n uint32
	// The list's size first, then the list
	_ = windows.GetTokenInformation(token, windows.TokenPrivileges, nil, 0, &n)
	if n == 0 {
		return false, false, errors.New("token privileges: no size")
	}
	buf := make([]byte, n)
	if err := windows.GetTokenInformation(token, windows.TokenPrivileges, &buf[0], n, &n); err != nil {
		return false, false, err
	}
	for _, p := range (*windows.Tokenprivileges)(unsafe.Pointer(&buf[0])).AllPrivileges() {
		if p.Luid == luid {
			return true, p.Attributes&windows.SE_PRIVILEGE_ENABLED != 0, nil
		}
	}
	return false, false, nil
}

// What other processes of the same user may do with this one: wait on it
// (SYNCHRONIZE: Tor watches the process that owns it), ask about it
// (PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION) and end
// it (PROCESS_TERMINATE, as Task Manager does).
const processOthersMay = windows.SYNCHRONIZE | windows.PROCESS_QUERY_INFORMATION |
	windows.PROCESS_QUERY_LIMITED_INFORMATION | windows.PROCESS_TERMINATE

// restrictProcessAccess sets the process's access list to processOthersMay
// for its user and its owner, and everything for SYSTEM, protected from
// inheriting anything else.
func restrictProcessAccess() error {
	dacl, err := restrictedDACL()
	if err != nil {
		return err
	}
	return setProcessDACL(windows.CurrentProcess(), dacl)
}

func restrictedDACL() (*windows.ACL, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	sddl := fmt.Sprintf("D:P(A;;%#x;;;OW)(A;;%#x;;;%s)(A;;GA;;;SY)",
		processOthersMay, processOthersMay, user.User.Sid.String())
	sd, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return nil, err
	}
	dacl, _, err := sd.DACL()
	return dacl, err
}

func setProcessDACL(process windows.Handle, dacl *windows.ACL) error {
	return windows.SetSecurityInfo(process, windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

// shellHardened are the shell's processes HardenShell has given the
// access list: past that, not even this process may change it again.
var (
	shellMu       sync.Mutex
	shellHardened = map[uint32]bool{}
)

// HardenShell gives the shell's own processes the access list the
// backend gives itself (restrictProcessAccess): its main process, which
// holds the bridge's token, and the window's, which holds what's typed in
// it. Only the shell's processes are taken: this process's parent, and
// that parent's children. Each is given it once.
func HardenShell(pids []int) error {
	shell := uint32(os.Getppid())
	parents, err := parentPIDs()
	if err != nil {
		return err
	}
	dacl, err := restrictedDACL()
	if err != nil {
		return err
	}
	shellMu.Lock()
	defer shellMu.Unlock()
	var errs []error
	for _, p := range pids {
		pid := uint32(p)
		if p <= 0 || (pid != shell && parents[pid] != shell) {
			errs = append(errs, fmt.Errorf("process %d isn't the shell's", p))
			continue
		}
		if shellHardened[pid] {
			continue
		}
		h, err := windows.OpenProcess(windows.WRITE_DAC|windows.READ_CONTROL, false, pid)
		if err == nil {
			err = setProcessDACL(h, dacl)
			windows.CloseHandle(h)
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("process %d: %w", p, err))
			continue
		}
		shellHardened[pid] = true
	}
	return errors.Join(errs...)
}

// parentPIDs maps each running process to its parent's ID.
func parentPIDs() (map[uint32]uint32, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)
	parents := map[uint32]uint32{}
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		parents[entry.ProcessID] = entry.ParentProcessID
	}
	if !errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	return parents, nil
}

var (
	kernel32                       = windows.NewLazySystemDLL("kernel32.dll")
	procSetProcessMitigationPolicy = kernel32.NewProc("SetProcessMitigationPolicy")
	procGetProcessMitigationPolicy = kernel32.NewProc("GetProcessMitigationPolicy")
	wer                            = windows.NewLazySystemDLL("wer.dll")
	procWerAddExcludedApplication  = wer.NewProc("WerAddExcludedApplication")
)

// The PROCESS_MITIGATION_POLICY kinds set here; each one's settings are a
// DWORD of flags.
const (
	processExtensionPointDisablePolicy = 6
	processSignaturePolicy             = 8
	processImageLoadPolicy             = 10
)

func setMitigationPolicy(policy, flags uint32) error {
	if r, _, err := procSetProcessMitigationPolicy.Call(uintptr(policy), uintptr(unsafe.Pointer(&flags)), unsafe.Sizeof(flags)); r == 0 {
		return err
	}
	return nil
}

// mitigationFlags reads a mitigation policy's flags back from the system.
func mitigationFlags(policy uint32) (uint32, bool) {
	var flags uint32
	r, _, _ := procGetProcessMitigationPolicy.Call(uintptr(windows.CurrentProcess()), uintptr(policy),
		uintptr(unsafe.Pointer(&flags)), unsafe.Sizeof(flags))
	return flags, r != 0
}

// errorReportingKey is where Windows Error Reporting keeps the
// applications it leaves out, each by its file name.
const errorReportingKey = `Software\Microsoft\Windows\Windows Error Reporting\ExcludedApplications`

func exeName() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Base(exe), nil
}

// excludeFromErrorReporting has Windows Error Reporting leave this
// executable out, for this user.
func excludeFromErrorReporting() error {
	name, err := exeName()
	if err != nil {
		return err
	}
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	// An HRESULT: S_OK is 0
	if r, _, _ := procWerAddExcludedApplication.Call(uintptr(unsafe.Pointer(p)), 0); r != 0 {
		return fmt.Errorf("WerAddExcludedApplication: %#x", r)
	}
	return nil
}

// ProcessGuarded reads back what HardenProcess set, as it stands now: the
// process tries to open itself to read its memory, as another program of
// the same user would, and must be refused.
func ProcessGuarded() ProcessGuard {
	var g ProcessGuard
	h, err := windows.OpenProcess(windows.PROCESS_VM_READ, false, windows.GetCurrentProcessId())
	if err == nil {
		windows.CloseHandle(h)
	} else {
		g.NoMemoryReads = errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	if name, err := exeName(); err == nil {
		if k, err := registry.OpenKey(registry.CURRENT_USER, errorReportingKey, registry.QUERY_VALUE); err == nil {
			v, _, err := k.GetIntegerValue(name)
			g.NoCoreDumps = err == nil && v == 1
			k.Close()
		}
	}
	signed, ok1 := mitigationFlags(processSignaturePolicy)
	points, ok2 := mitigationFlags(processExtensionPointDisablePolicy)
	images, ok3 := mitigationFlags(processImageLoadPolicy)
	g.SignedCodeOnly = ok1 && ok2 && ok3 && signed&1 != 0 && points&1 != 0 && images&1 != 0
	return g
}

// processDiskBytes reads nothing here: the daemon's disk metrics stand.
func processDiskBytes() (read, written uint64, ok bool) { return 0, 0, false }
