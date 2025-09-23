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
