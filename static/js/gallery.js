export class ImageViewer {
    constructor() {
        this.currentImageIndex = 0;
        this.images = [];
        this.isOpen = false;
        
        this.init();
    }
    
    init() {
        this.createViewerElement();
        this.bindEvents();
    }
    
    createViewerElement() {
        const viewer = document.createElement('div');
        viewer.className = 'modal-overlay image-viewer';
        viewer.style.display = 'none';
        
        viewer.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title"></div>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="image-container">
                        <img src="" alt="">
                        <button class="image-nav prev">◀</button>
                        <button class="image-nav next">▶</button>
                    </div>
                    <div class="image-info">
                        <div class="image-name"></div>
                        <div class="image-size"></div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(viewer);
        this.viewerElement = viewer;
        this.imageElement = viewer.querySelector('img');
        this.titleElement = viewer.querySelector('.modal-title');
        this.nameElement = viewer.querySelector('.image-name');
        this.sizeElement = viewer.querySelector('.image-size');
    }
    
    bindEvents() {
        this.viewerElement.querySelector('.prev').addEventListener('click', () => {
            this.showPrevious();
        });
        
        this.viewerElement.querySelector('.next').addEventListener('click', () => {
            this.showNext();
        });
        
        this.viewerElement.querySelector('.modal-close').addEventListener('click', () => {
            this.close();
        });
        
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;
            
            if (e.key === 'Escape') {
                this.close();
            } else if (e.key === 'ArrowLeft') {
                this.showPrevious();
            } else if (e.key === 'ArrowRight') {
                this.showNext();
            }
        });
        
        let touchStartX = 0;
        
        this.imageElement.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        });
        
        this.imageElement.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.showNext();
                } else {
                    this.showPrevious();
                }
            }
        });
    }
    
    open(imagePath) {
        const fileItems = document.querySelectorAll('.file-item, .masonry-item');
        this.images = [];
        
        fileItems.forEach(item => {
            const mimeType = item.dataset.mimeType || '';
            if (mimeType.startsWith('image/')) {
                this.images.push({
                    path: item.dataset.path,
                    name: item.querySelector('.file-name, .masonry-name')?.textContent || item.dataset.path.split('/').pop(),
                    size: item.querySelector('.file-info, .masonry-size')?.textContent || ''
                });
            }
        });
        
        this.currentImageIndex = this.images.findIndex(img => img.path === imagePath);
        
        if (this.currentImageIndex === -1 && this.images.length > 0) {
            this.currentImageIndex = 0;
        } else if (this.images.length === 0) {
            this.images = [{ path: imagePath, name: imagePath.split('/').pop(), size: '' }];
            this.currentImageIndex = 0;
        }
        
        this.showImage(this.currentImageIndex);
        this.viewerElement.style.display = 'flex';
        this.isOpen = true;
        
        document.body.style.overflow = 'hidden';
    }
    
    close() {
        this.viewerElement.style.display = 'none';
        this.isOpen = false;
        document.body.style.overflow = '';
    }
    
    showImage(index) {
        if (index < 0 || index >= this.images.length) return;
        
        this.currentImageIndex = index;
        const image = this.images[index];
        
        this.imageElement.src = `/api/files/content?path=${encodeURIComponent(image.path)}`;
        this.titleElement.textContent = `${index + 1} / ${this.images.length}`;
        this.nameElement.textContent = image.name;
        this.sizeElement.textContent = image.size;
    }
    
    showPrevious() {
        if (this.images.length <= 1) return;
        
        let newIndex = this.currentImageIndex - 1;
        if (newIndex < 0) newIndex = this.images.length - 1;
        
        this.showImage(newIndex);
    }
    
    showNext() {
        if (this.images.length <= 1) return;
        
        let newIndex = this.currentImageIndex + 1;
        if (newIndex >= this.images.length) newIndex = 0;
        
        this.showImage(newIndex);
    }
}
