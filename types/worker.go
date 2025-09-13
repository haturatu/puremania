package types

import "sync"

// WorkerPool はCPU論理コア数ベースのワーカープールです。
type WorkerPool struct {
	Workers    int
	TaskQueue  chan func()
	ResultChan chan interface{}
	Wg         sync.WaitGroup
	Active     int64
}
