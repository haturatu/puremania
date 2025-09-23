package worker

import (
	"puremania/types"
	"runtime"
	"sync/atomic"
)

// NewWorkerPool は新しいWorkerPoolを生成
func NewWorkerPool() *types.WorkerPool {
	workers := runtime.NumCPU()
	if workers > 16 { // 最大16ワーカーに制限
		workers = 16
	}
	if workers < 2 {
		workers = 2
	}

	pool := &types.WorkerPool{
		Workers:    workers,
		TaskQueue:  make(chan func(), workers*4), // バッファ付きチャネル
		ResultChan: make(chan interface{}, workers*2),
	}

	for i := 0; i < workers; i++ {
		pool.Wg.Add(1)
		go worker(pool)
	}

	return pool
}

func worker(p *types.WorkerPool) {
	defer p.Wg.Done()
	for task := range p.TaskQueue {
		atomic.AddInt64(&p.Active, 1)
		task()
		atomic.AddInt64(&p.Active, -1)
	}
}

// Submit はタスクをワーカープールに投入
func Submit(p *types.WorkerPool, task func()) {
	select {
	case p.TaskQueue <- task:
	default:
		// タスクキューが満杯の場合は同期実行
		task()
	}
}

// SubmitWithResult は結果を返すタスクをワーカープールに投入
func SubmitWithResult(p *types.WorkerPool, task func() interface{}) <-chan interface{} {
	resultChan := make(chan interface{}, 1)
	Submit(p, func() {
		result := task()
		resultChan <- result
		close(resultChan)
	})
	return resultChan
}

// ActiveWorkers は現在アクティブなワーカー数を返す
func ActiveWorkers(p *types.WorkerPool) int64 {
	return atomic.LoadInt64(&p.Active)
}

// Close はワーカープールをシャットダウン
func Close(p *types.WorkerPool) {
	close(p.TaskQueue)
	p.Wg.Wait()
	close(p.ResultChan)
}
