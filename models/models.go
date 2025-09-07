package models

type FileInfo struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	ModTime    string `json:"mod_time"`
	IsDir      bool   `json:"is_dir"`
	MimeType   string `json:"mime_type"`
	IsEditable bool   `json:"is_editable"`
	IsMount    bool   `json:"is_mount"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

type CreateDirectoryRequest struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type SaveFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type BatchPathsRequest struct {
	Paths []string `json:"paths"`
}
