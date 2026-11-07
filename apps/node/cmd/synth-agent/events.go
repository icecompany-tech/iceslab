package main

import (
	"bufio"
	"fmt"
	"os"
	"sync"
	"time"
)

// eventLog records when each request reached a stand-in core, one JSON object a
// line. The panel under test is not instrumented, so how long a poll cycle took
// and how long a change needed to reach a node are read from this file. A nil
// log drops everything.
type eventLog struct {
	mu   sync.Mutex
	file *os.File
	w    *bufio.Writer
}

func openEventLog(path string) (*eventLog, error) {
	if path == "" {
		return nil, nil
	}
	file, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	return &eventLog{file: file, w: bufio.NewWriter(file)}, nil
}

func (l *eventLog) write(node, kind, user string, count int) {
	if l == nil {
		return
	}
	now := time.Now().UnixMilli()
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(l.w, `{"t":%d,"n":%q,"e":%q,"u":%q,"c":%d}`+"\n", now, node, kind, user, count)
}

func (l *eventLog) flush() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Flush()
}

func (l *eventLog) close() error {
	if l == nil {
		return nil
	}
	if err := l.flush(); err != nil {
		_ = l.file.Close()
		return err
	}
	return l.file.Close()
}
