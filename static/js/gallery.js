import { getTemplateContent } from './template.js';

export class ImageViewer {
    constructor() {
        this.currentImageIndex = 0;
        this.images = [];
        this.isOpen = false;
        this.navTimeout = null;
    }
    
    init() {
        this.createViewerElement();
        this.bindEvents();
    }
    
    createViewerElement() {
        const viewer = document.createElement('div');
        viewer.className = 'modal-overlay image-viewer';
        viewer.style.display = 'none';
        
        const template = getTemplateContent('/static/templates/components/image_viewer.html');
        viewer.appendChild(template);
        
        document.body.appendChild(viewer);
        this.viewerElement = viewer;
        this.imageElement = viewer.querySelector('img');
        this.titleElement = viewer.querySelector('.modal-title');
        this.nameElement = viewer.querySelector('.image-name');
        this.sizeElement = viewer.querySelector('.image-size');
        this.prevButton = viewer.querySelector('.prev');
        this.nextButton = viewer.querySelector('.next');
    }
    
    bindEvents() {
        this.prevButton.addEventListener('click', () => this.showPrevious());
        this.nextButton.addEventListener('click', () => this.showNext());
        this.viewerElement.querySelector('.modal-close').addEventListener('click', () => this.close());
        
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;
            if (e.key === 'Escape') this.close();
            else if (e.key === 'ArrowLeft') this.showPrevious();
            else if (e.key === 'ArrowRight') this.showNext();
        });
        
        let touchStartX = 0;
        this.imageElement.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        });
        
        this.imageElement.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) this.showNext();
                else this.showPrevious();
            }
        });
    }
    
    open(imagePath) {
        const fileItems = document.querySelectorAll('.file-item, .masonry-item');
        this.images = Array.from(fileItems)
            .filter(item => (item.dataset.mimeType || '').startsWith('image/'))
            .map(item => ({
                path: item.dataset.path,
                name: item.querySelector('.file-name, .masonry-name')?.textContent || item.dataset.path.split('/').pop(),
                size: item.querySelector('.file-info, .masonry-size')?.textContent || ''
            }));
        
        this.currentImageIndex = this.images.findIndex(img => img.path === imagePath);
        
        if (this.currentImageIndex === -1) {
            this.images.unshift({ path: imagePath, name: imagePath.split('/').pop(), size: '' });
            this.currentImageIndex = 0;
        }
        
        this.showImage(this.currentImageIndex);
        this.viewerElement.style.display = 'flex';
        this.isOpen = true;
        document.body.style.overflow = 'hidden';
        this.showNavButtons();
    }
    
    close() {
        this.viewerElement.style.display = 'none';
        this.isOpen = false;
        document.body.style.overflow = '';
        clearTimeout(this.navTimeout);
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
        let newIndex = (this.currentImageIndex - 1 + this.images.length) % this.images.length;
        this.showImage(newIndex);
    }
    
    showNext() {
        if (this.images.length <= 1) return;
        let newIndex = (this.currentImageIndex + 1) % this.images.length;
        this.showImage(newIndex);
    }

    showNavButtons() {
        clearTimeout(this.navTimeout);
        this.prevButton.classList.remove('nav-hidden');
        this.nextButton.classList.remove('nav-hidden');
        
        this.navTimeout = setTimeout(() => {
            this.hideNavButtons();
        }, 5000);
    }

    hideNavButtons() {
        this.prevButton.classList.add('nav-hidden');
        this.nextButton.classList.add('nav-hidden');
    }
}