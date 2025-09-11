export class FileEditor {
    constructor() {
        this.currentFile = null;
        this.init();
    }
    
    init() {
        this.createEditorElement();
    }
    
    createEditorElement() {
        const editor = document.createElement('div');
        editor.className = 'modal-overlay editor-modal';
        editor.style.display = 'none';
        
        editor.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="editor-header">
                        <div class="editor-filename"></div>
                        <div class="editor-actions">
                            <button class="btn" id="editor-cancel">Cancel</button>
                            <button class="btn btn-primary" id="editor-save">Save</button>
                        </div>
                    </div>
                </div>
                <div class="modal-body">
                    <div class="editor-container">
                        <textarea class="editor-textarea" placeholder="File content..."></textarea>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(editor);
        this.editorElement = editor;
        this.textarea = editor.querySelector('.editor-textarea');
        this.filenameElement = editor.querySelector('.editor-filename');
        
        this.bindEvents();
    }

    bindEvents() {
        this.editorElement.querySelector('#editor-cancel').addEventListener('click', () => {
            this.close();
        });
        
        this.editorElement.querySelector('#editor-save').addEventListener('click', () => {
            this.save();
        });
        
        this.textarea.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.save();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }
    
    open(filePath, content) {
        this.currentFile = filePath;
        this.filenameElement.textContent = filePath.split('/').pop();
        this.textarea.value = content;
        this.editorElement.style.display = 'flex';
        this.textarea.focus();
        
        document.body.style.overflow = 'hidden';
    }
    
    close() {
        this.editorElement.style.display = 'none';
        this.currentFile = null;
        document.body.style.overflow = '';
    }
    
    async save() {
        if (!this.currentFile) return;
        
        const content = this.textarea.value;
        
        try {
            const response = await fetch('/api/files/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: this.currentFile,
                    content: content
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showToast('File saved successfully', 'success');
                this.close();
            } else {
                this.showToast(result.message, 'error');
            }
        } catch (error) {
            this.showToast('Failed to save file', 'error');
            console.error('Error saving file:', error);
        }
    }
    
    showToast(message, type) {
        if (window.fileManager && window.fileManager.showToast) {
            window.fileManager.showToast('Editor', message, type);
            return;
        }
        
        // Fallback toast implementation
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        toast.style.background = type === 'success' ? 'var(--success)' : 'var(--error)';
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

