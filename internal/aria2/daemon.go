package aria2

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os/exec"
	"time"
)

func generateSecureToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// Start launches aria2c with a loopback-only JSON-RPC endpoint.
func Start(logger *slog.Logger) (rpcURL string, rpcToken string, err error) {
	logger.Info("Aria2c feature enabled. Starting aria2c daemon...")
	token, err := generateSecureToken(16)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate secure token for aria2c: %w", err)
	}
	rpcPort := "6800"
	rpcURL = fmt.Sprintf("http://localhost:%s/jsonrpc", rpcPort)
	cmd := exec.Command("aria2c", "--enable-rpc", "--rpc-listen-all=false", "--rpc-listen-port", rpcPort, "--rpc-secret", token, "--no-conf", "--log-level=warn", "--quiet=true")
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return "", "", fmt.Errorf("failed to start aria2c process. Is aria2c installed and in your PATH?: %w", err)
	}
	logger.Info("Aria2c process started successfully", "pid", cmd.Process.Pid)
	go func() { _ = cmd.Wait() }()
	time.Sleep(2 * time.Second)
	return rpcURL, token, nil
}
