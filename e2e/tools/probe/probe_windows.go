// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

// Command probe tries a process as an ordinary program of the same user
// would, for the end-to-end tests (e2e/tests/windows-shell.spec.ts): it
// drops the debug privilege an administrator's process (a CI runner's) may
// hold, which passes any access list, then asks for each access in turn
// and prints which it was given, as JSON.
//
//	probe <pid>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"golang.org/x/sys/windows"
)

func main() {
	pid, err := strconv.Atoi(os.Args[len(os.Args)-1])
	if err != nil || len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: probe <pid>")
		os.Exit(2)
	}
	if err := dropDebugPrivilege(); err != nil {
		fmt.Fprintln(os.Stderr, "dropping the debug privilege:", err)
		os.Exit(1)
	}
	given := map[string]bool{}
	for name, access := range map[string]uint32{
		"readMemory":  windows.PROCESS_VM_READ,
		"writeMemory": windows.PROCESS_VM_WRITE | windows.PROCESS_VM_OPERATION,
		"startThread": windows.PROCESS_CREATE_THREAD,
		"takeHandles": windows.PROCESS_DUP_HANDLE,
		"rewriteACL":  windows.WRITE_DAC,
		"waitQueryEnd": windows.SYNCHRONIZE | windows.PROCESS_QUERY_INFORMATION |
			windows.PROCESS_QUERY_LIMITED_INFORMATION | windows.PROCESS_TERMINATE,
	} {
		h, err := windows.OpenProcess(access, false, uint32(pid))
		if err == nil {
			windows.CloseHandle(h)
		}
		given[name] = err == nil
	}
	json.NewEncoder(os.Stdout).Encode(given)
}

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
	// A token without it is left as it is (ERROR_NOT_ALL_ASSIGNED, reported as success)
	return windows.AdjustTokenPrivileges(token, false, &remove, 0, nil, nil)
}
