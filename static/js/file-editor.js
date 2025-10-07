import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { oneDark } from '@codemirror/theme-one-dark';
import { indentWithTab, toggleComment } from "@codemirror/commands";
import { vim, Vim } from "@replit/codemirror-vim";

// Language imports
import { javascript } from "@codemirror/lang-javascript";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";

const getLanguageName = (filePath) => {
    const extension = filePath.split('.').pop().toLowerCase();
    const langMap = {
        js: 'JavaScript', jsx: 'JavaScript (JSX)',
        ts: 'TypeScript', tsx: 'TypeScript (TSX)',
        c: 'C', cpp: 'C++', h: 'C/C++ Header', hpp: 'C++ Header',
        go: 'Go', java: 'Java', php: 'PHP', py: 'Python',
        rs: 'Rust', html: 'HTML', htm: 'HTML', css: 'CSS',
        xml: 'XML', md: 'Markdown', markdown: 'Markdown'
    };
    return langMap[extension] || 'Plain Text';
};

const getLanguageExtension = (filePath) => {
    const extension = filePath.split('.').pop().toLowerCase();
    switch (extension) {
        case 'js':
        case 'jsx':
            return javascript({ jsx: true });
        case 'ts':
        case 'tsx':
            return javascript({ typescript: true, jsx: true });
        case 'c':
        case 'cpp':
        case 'h':
        case 'hpp':
            return cpp();
        case 'go':
            return go();
        case 'java':
            return java();
        case 'php':
            return php();
        case 'py':
            return python();
        case 'rs':
            return rust();
        case 'html':
        case 'htm':
            return html();
        case 'css':
            return css();
        case 'xml':
            return xml();
        case 'md':
        case 'markdown':
            return markdown();
        default:
            return javascript();
    }
};

export class FileEditor {
    constructor(app) {
        this.app = app;
        this.currentFile = null;
        this.editorView = null;
        this.isPC = !/Mobi|Android/i.test(navigator.userAgent);
        this.vimCompartment = new Compartment();

        // Initialize Vim mode state from localStorage
        this.vimModeEnabled = this.isPC ? JSON.parse(localStorage.getItem('vimModeEnabled')) ?? true : false;

        // Define custom VIM commands if on PC
        if (this.isPC) {
            this.defineVimCommands();
        }
    }

    defineVimCommands() {
        Vim.defineEx("w", "w", () => { this.save(); });
        Vim.defineEx("q", "q", () => { this.close(); });
        Vim.defineEx("wq", "wq", async () => {
            await this.save();
            this.close();
        });
        Vim.defineEx("q!", "q!", () => { this.close(); });
    }

    init() {
        this.createEditorElement();
    }

    createEditorElement() {
        const editor = document.createElement('div');
        editor.className = 'modal-overlay editor-modal';
        editor.style.display = 'none';

        const vimToggleHTML = this.isPC ? `
            <div class="vim-toggle">
                <label for="vim-mode-toggle" class="vim-toggle-label">Vim</label>
                <input type="checkbox" id="vim-mode-toggle" class="vim-toggle-checkbox">
            </div>
        ` : '';

        editor.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="editor-filename"></div>
                    <div class="editor-actions">
                        <button class="btn" id="editor-cancel">Close</button>
                        <button class="btn btn-primary" id="editor-save">Save</button>
                    </div>
                </div>
                <div class="modal-body">
                    <div class="editor-container"></div>
                </div>
                <div class="modal-footer editor-status-bar">
                    <div class="status-left">
                        <span id="status-cursor">Ln 1, Col 1</span>
                        <span id="status-selection"></span>
                    </div>
                    <div class="status-right">
                        ${vimToggleHTML}
                        <span id="status-lines">1 Lines</span>
                        <span id="status-lang">Plain Text</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(editor);
        this.editorElement = editor;
        this.editorContainer = editor.querySelector('.editor-container');
        this.filenameElement = editor.querySelector('.editor-filename');
        this.statusBar = {
            cursor: editor.querySelector('#status-cursor'),
            selection: editor.querySelector('#status-selection'),
            lines: editor.querySelector('#status-lines'),
            lang: editor.querySelector('#status-lang'),
        };
        if (this.isPC) {
            this.vimToggle = editor.querySelector('#vim-mode-toggle');
        }

        this.bindEvents();
    }

    bindEvents() {
        this.editorElement.querySelector('#editor-cancel').addEventListener('click', () => this.close());
        this.editorElement.querySelector('#editor-save').addEventListener('click', () => this.save());
        if (this.isPC) {
            this.vimToggle.addEventListener('change', () => this.toggleVimMode());
        }
    }

    toggleVimMode() {
        if (!this.isPC || !this.editorView) return;

        this.vimModeEnabled = !this.vimModeEnabled;
        localStorage.setItem('vimModeEnabled', JSON.stringify(this.vimModeEnabled));
        this.vimToggle.checked = this.vimModeEnabled;

        this.editorView.dispatch({
            effects: this.vimCompartment.reconfigure(this.vimModeEnabled ? vim() : [])
        });
        this.editorView.focus();
    }

    getInitialExtensions(langExtension) {
        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) {
                this.updateStatusBar();
            }
        });

        return [
            basicSetup,
            lineNumbers(),
            langExtension,
            autocompletion(),
            oneDark,
            EditorView.theme({
                "&": { height: "100%" },
                ".cm-scroller": { overflow: "auto" }
            }),
            EditorView.lineWrapping,
            updateListener,
            keymap.of([
                { key: "Ctrl-s", run: () => { this.save(); return true; } },
                { key: "Mod-s", run: () => { this.save(); return true; } },
                { key: "Ctrl-/", run: toggleComment },
                { key: "Mod-/", run: toggleComment },
                { key: "Mod-Alt-v", run: () => { this.toggleVimMode(); return true; } },
                indentWithTab,
            ]),
            this.vimCompartment.of(this.vimModeEnabled ? vim() : [])
        ];
    }

    open(filePath, content) {
        this.currentFile = filePath;
        this.filenameElement.textContent = filePath.split('/').pop();

        if (this.editorView) {
            this.editorView.destroy();
        }

        const langExtension = getLanguageExtension(filePath);
        const langName = getLanguageName(filePath);

        if (this.isPC) {
            this.vimToggle.checked = this.vimModeEnabled;
            this.vimToggle.parentElement.style.display = 'flex';
        }

        const state = EditorState.create({
            doc: content,
            extensions: this.getInitialExtensions(langExtension)
        });

        this.editorView = new EditorView({
            state,
            parent: this.editorContainer
        });

        this.editorElement.style.display = 'flex';
        this.editorView.focus();
        document.body.style.overflow = 'hidden';

        this.statusBar.lang.textContent = langName;
        this.updateStatusBar();
    }

    updateStatusBar() {
        if (!this.editorView) return;

        const state = this.editorView.state;
        const cursor = state.selection.main.head;
        const line = state.doc.lineAt(cursor);

        this.statusBar.cursor.textContent = `Ln ${line.number}, Col ${cursor - line.from + 1}`;
        this.statusBar.lines.textContent = `${state.doc.lines} Lines`;

        const selection = state.selection.main;
        if (selection.empty) {
            this.statusBar.selection.textContent = '';
        } else {
            const selectedChars = selection.to - selection.from;
            this.statusBar.selection.textContent = `(${selectedChars} selected)`;
        }
    }

    close() {
        if (this.editorElement.style.display === 'none') {
            return;
        }
        this.editorElement.style.display = 'none';
        this.currentFile = null;
        if (this.editorView) {
            this.editorView.destroy();
            this.editorView = null;
        }
        document.body.style.overflow = '';
    }

    async save() {
        if (!this.currentFile || !this.editorView) return;

        const content = this.editorView.state.doc.toString();

        try {
            const response = await fetch('/api/files/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.currentFile, content: content })
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

        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        toast.style.background = type === 'success' ? 'var(--success)' : 'var(--error)';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

