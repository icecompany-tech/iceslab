// Package atomicfile provides crash-safe file replacement for proxy-core
// config files. Plain `os.WriteFile(tmp); os.Rename(tmp, path)` is NOT
// crash-safe on Linux without explicit fsync, under power-loss the rename
// can land in the directory entry while the tmp file's data pages are
// still in the kernel cache, leaving a zero-length or torn config on next
// boot.
//
// Write does: open tmp O_RDWR|O_CREATE|O_EXCL, write, fsync(tmp), close,
// rename, fsync(parent dir). This is the canonical sqlite/postgres pattern.
package atomicfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// Write replaces `path` with `data`, crash-safely. The destination file
// ends up with the given mode (mode is applied to the tmp file before
// rename so the visible file never has a too-open mode briefly).
//
// Caller is responsible for ensuring `filepath.Dir(path)` already exists
// (use os.MkdirAll separately if needed, this function refuses to create
// missing parent dirs because it can't fsync them after the fact in a
// well-ordered way).
func Write(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".atomic.*.tmp")
	if err != nil {
		return fmt.Errorf("atomicfile: create tmp in %s: %w", dir, err)
	}
	tmpName := tmp.Name()
	// On any error after this point, remove the tmp.
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}

	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("atomicfile: write %s: %w", tmpName, err)
	}
	if err := tmp.Chmod(mode); err != nil {
		cleanup()
		return fmt.Errorf("atomicfile: chmod %s: %w", tmpName, err)
	}
	// fsync the file BEFORE rename, flushes data pages to disk so the
	// rename can't outrun the contents.
	if err := tmp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("atomicfile: fsync %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("atomicfile: close %s: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("atomicfile: rename %s -> %s: %w", tmpName, path, err)
	}
	// fsync the parent directory, without this, on power-loss the rename
	// entry itself can be lost even though the file data is durable. Linux
	// requires explicit dir-fsync for directory metadata.
	dirF, err := os.Open(dir)
	if err != nil {
		// File is in place; if we can't open the dir something is weird.
		// Return error so caller knows durability isn't guaranteed.
		return fmt.Errorf("atomicfile: open dir %s for fsync: %w", dir, err)
	}
	defer dirF.Close()
	if err := dirF.Sync(); err != nil {
		return fmt.Errorf("atomicfile: fsync dir %s: %w", dir, err)
	}
	return nil
}
