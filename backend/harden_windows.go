// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
// starts (harden_windows_test.go says so when its check fails).
var debugPrivilegeHeld, debugPrivilegeEnabled bool

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
	remove := windows.Tokenprivileges{PrivilegeCount: 1}
	remove.Privileges[0] = windows.LUIDAndAttributes{Luid: luid, Attributes: windows.SE_PRIVILEGE_REMOVED}
	// What it was before: one privilege back if the token held it, none if not
	var was windows.Tokenprivileges
	var n uint32
	if err := windows.AdjustTokenPrivileges(token, false, &remove, uint32(unsafe.Sizeof(was)), &was, &n); err != nil {
		return err
	}
	if was.PrivilegeCount == 1 {
		debugPrivilegeHeld = true
		debugPrivilegeEnabled = was.Privileges[0].Attributes&windows.SE_PRIVILEGE_ENABLED != 0
	}
	return nil
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
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	sddl := fmt.Sprintf("D:P(A;;%#x;;;OW)(A;;%#x;;;%s)(A;;GA;;;SY)",
		processOthersMay, processOthersMay, user.User.Sid.String())
	sd, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetSecurityInfo(windows.CurrentProcess(), windows.SE_KERNEL_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
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
