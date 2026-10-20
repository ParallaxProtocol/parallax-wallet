// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"math"
	"runtime"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/support/metrics"
	"github.com/shirou/gopsutil/cpu"
)

// Without --metrics (as under go test) the daemon counts nothing, and the
// usage says so rather than reading as none.
func TestNodeUsageUncounted(t *testing.T) {
	if metrics.Enabled {
		t.Skip("metrics are on in this process")
	}
	if got := NodeUsage(); got != (Usage{}) {
		t.Fatalf("usage without metrics = %+v, want the zero value", got)
	}
}

// busySeconds is the CPU time the whole machine has worked, as gopsutil gives it.
func busySeconds(t *testing.T) float64 {
	times, err := cpu.Times(false)
	if err != nil || len(times) == 0 {
		t.Fatalf("cpu times: %v", err)
	}
	return times[0].User + times[0].Nice + times[0].System
}

// The machine's load reads as the share of its cores it was, on every
// system: the share is taken in the unit the daemon's gauge counts in,
// 100ns on Windows, and in hundredths there it read thousands of percent.
func TestNodeUsageMachineLoadIsAShare(t *testing.T) {
	if metrics.Enabled {
		t.Skip("metrics are on in this process")
	}
	metrics.Enabled = true
	defer func() {
		metrics.Enabled = false
		metrics.DefaultRegistry.Unregister(cpuSysGauge)
	}()

	// As the daemon's collector does (CollectProcessMetrics), over a second
	var before, after metrics.CPUStats
	from := busySeconds(t)
	metrics.ReadCPUStats(&before)
	time.Sleep(time.Second)
	metrics.ReadCPUStats(&after)
	to := busySeconds(t)
	metrics.GetOrRegisterGauge(cpuSysGauge, metrics.DefaultRegistry).Update(after.GlobalTime - before.GlobalTime)

	// The two readings bracket the same second, a tick apart at each end
	cores := float64(runtime.NumCPU())
	got, want := NodeUsage().CPUSystem, (to-from)/cores
	if math.Abs(got-want) > 0.05+0.05/cores {
		t.Fatalf("machine CPU load = %v of its cores, gopsutil says %v", got, want)
	}
}
