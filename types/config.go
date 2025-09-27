package types

// Config はアプリケーションの設定を保持
type Config struct {
	StorageDir     string
	MountDirs      []string
	MaxFileSize    int64
	Port           int
	ZipTimeout     int
	MaxZipSize     int64
	SpecificDirs   []string
	Aria2cRPCURL   string
	Aria2cRPCToken string
	Aria2cEnabled  bool
}
