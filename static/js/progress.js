// 進捗状況を監視するユーティリティ関数
class UploadProgress {
    constructor() {
        this.xhr = null;
    }
    
    uploadWithProgress(url, formData, onProgress, onComplete, onError) {
        this.xhr = new XMLHttpRequest();
        
        this.xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentage = (e.loaded / e.total) * 100;
                onProgress(percentage, e.loaded, e.total);
            }
        });
        
        this.xhr.addEventListener('load', () => {
            if (this.xhr.status >= 200 && this.xhr.status < 300) {
                try {
                    const response = JSON.parse(this.xhr.responseText);
                    onComplete(response);
                } catch (error) {
                    onError('Failed to parse response');
                }
            } else {
                onError(`Upload failed: ${this.xhr.statusText}`);
            }
        });
        
        this.xhr.addEventListener('error', () => {
            onError('Network error occurred');
        });
        
        this.xhr.open('POST', url);
        this.xhr.send(formData);
    }
    
    abort() {
        if (this.xhr) {
            this.xhr.abort();
        }
    }
}

// グローバルに登録
window.UploadProgress = UploadProgress;
