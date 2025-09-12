package worker

import (
	"runtime"
	"sync"
	"sync/atomic"
)

// WorkerPool はCPU論理コア数ベースのワーカープールです。
type WorkerPool struct {
	workers    int
	taskQueue  chan func()
	resultChan chan interface{}
	wg         sync.WaitGroup
	active     int64
}

// NewWorkerPool は新しいWorkerPoolを生成します。
func NewWorkerPool() *WorkerPool {
	workers := runtime.NumCPU()
	if workers > 16 { // 最大16ワーカーに制限
		workers = 16
	}
	if workers < 2 {
		workers = 2
	}

	pool := &WorkerPool{
		workers:    workers,
		taskQueue:  make(chan func(), workers*4), // バッファ付きチャネル
		resultChan: make(chan interface{}, workers*2),
	}

	for i := 0; i < workers; i++ {
		pool.wg.Add(1)
		go pool.worker()
	}

	return pool
}

func (p *WorkerPool) worker() {
	defer p.wg.Done()
	for task := range p.taskQueue {
		atomic.AddInt64(&p.active, 1)
		task()
		atomic.AddInt64(&p.active, -1)
	}
}

// Submit はタスクをワーカープールに投入します。
func (p *WorkerPool) Submit(task func()) {
	select {
	case p.taskQueue <- task:
	default:
		// タスクキューが満杯の場合は同期実行
		task()
	}
}

// SubmitWithResult は結果を返すタスクをワーカープールに投入します。
func (p *WorkerPool) SubmitWithResult(task func() interface{}) <-chan interface{} {
	resultChan := make(chan interface{}, 1)
	p.Submit(func() {
		result := task()
		resultChan <- result
		close(resultChan)
	})
	return resultChan
}

// ActiveWorkers は現在アクティブなワーカー数を返します。
func (p *WorkerPool) ActiveWorkers() int64 {
	return atomic.LoadInt64(&p.active)
}

// Close はワーカープールをシャットダウンします。
func (p *WorkerPool) Close() {
	close(p.taskQueue)
	p.wg.Wait()
	close(p.resultChan)
}
