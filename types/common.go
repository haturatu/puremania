package types

type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// SpecificDirInfo は、フロントエンドに渡すための特定のディレクトリ情報
type SpecificDirInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// Aria2cDownloadRequest はaria2cでのダウンロードリクエスト
type Aria2cDownloadRequest struct {
	URL  string `json:"url"`
	Path string `json:"path"`
}

// Structs for Aria2c JSON-RPC
type Aria2cRPCRequest struct {
	Jsonrpc string        `json:"jsonrpc"`
	ID      string        `json:"id"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
}

type Aria2cRPCResponse struct {
	Jsonrpc string       `json:"jsonrpc"`
	ID      string       `json:"id"`
	Result  interface{}  `json:"result,omitempty"`
	Error   *Aria2cError `json:"error,omitempty"`
}

type Aria2cError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
