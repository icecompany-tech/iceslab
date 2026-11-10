//go:build !linux

package xray

func coreSocketOptions(int) string { return "not on this system" }
