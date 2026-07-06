package atomicfile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWrite_CreatesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	want := []byte("hello iceslab")

	if err := Write(path, want, 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("contents: got %q, want %q", got, want)
	}
}

func TestWrite_AppliesMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("posix mode bits not meaningful on Windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	if err := Write(path, []byte("x"), 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	// Bottom 9 bits are the permission set.
	if got := st.Mode().Perm(); got != 0o600 {
		t.Errorf("mode: got %o, want 0o600", got)
	}
}

func TestWrite_Overwrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "overwrite")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := Write(path, []byte("new"), 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "new" {
		t.Errorf("overwrite: got %q, want %q", got, "new")
	}
}

func TestWrite_NoTempLeak(t *testing.T) {
	// Ensure happy-path runs don't leave .atomic.*.tmp files behind. A leak
	// here would mean rename succeeded but os.Remove(tmpName) defer fired
	// against the new name (impossible by design, but verify the contract).
	dir := t.TempDir()
	path := filepath.Join(dir, "clean.txt")
	if err := Write(path, []byte("ok"), 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".atomic.") {
			t.Errorf("leftover temp file: %s", e.Name())
		}
	}
}

func TestWrite_RefusesMissingParentDir(t *testing.T) {
	// Helper is documented as "caller ensures parent dir exists". With no
	// parent, CreateTemp fails, we should surface that, not silently no-op.
	dir := filepath.Join(t.TempDir(), "does", "not", "exist")
	err := Write(filepath.Join(dir, "f"), []byte("x"), 0o600)
	if err == nil {
		t.Fatal("Write: expected error for missing parent dir, got nil")
	}
	// And confirm the error category is filesystem (not a panic / nil-deref).
	var pathErr *fs.PathError
	if !errors.As(err, &pathErr) && !strings.Contains(err.Error(), "create tmp") {
		t.Errorf("error not path-related: %v", err)
	}
}

func TestWrite_EmptyContent(t *testing.T) {
	// Edge case: zero-byte file should round-trip cleanly.
	dir := t.TempDir()
	path := filepath.Join(dir, "empty")
	if err := Write(path, []byte{}, 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if st.Size() != 0 {
		t.Errorf("size: got %d, want 0", st.Size())
	}
}

func TestWrite_BinaryContent(t *testing.T) {
	// 256-byte all-bytes pattern, catches any accidental text-mode conversion
	// (Windows: CreateFile with O_TEXT vs O_BINARY).
	dir := t.TempDir()
	path := filepath.Join(dir, "blob")
	want := make([]byte, 256)
	for i := range want {
		want[i] = byte(i)
	}
	if err := Write(path, want, 0o600); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len: got %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("byte %d: got %#x, want %#x", i, got[i], want[i])
		}
	}
}
