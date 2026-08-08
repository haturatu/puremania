package handlers

import (
	"context"
	"net/http"
)

func tryAcquire(gate chan struct{}) bool {
	select {
	case gate <- struct{}{}:
		return true
	default:
		return false
	}
}

func release(gate chan struct{}) {
	<-gate
}

func respondBusy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "5")
	w.WriteHeader(http.StatusTooManyRequests)
}

func contextStillActive(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return false
	default:
		return true
	}
}
