class MediaPlayer {
    constructor() {
        this.audioElement = null;
        this.videoElement = null;
        this.currentMedia = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.playlist = [];
        this.currentIndex = 0;
        this.isMinimized = false;
        this.isVideoModalOpen = false;
        this.videoModal = null;
        this.modalVideoElement = null;
        
        this.init();
    }
    
    init() {
        this.createPlayerElement();
        this.bindEvents();
        this.hide();
    }
    
    createPlayerElement() {
        const player = document.createElement('div');
        player.className = 'media-player';
        player.style.display = 'none';
        player.innerHTML = `
            <div class="media-info">
                <img class="media-thumbnail" src="" alt="">
                <div class="media-details">
                    <div class="media-title">No media selected</div>
                    <div class="media-artist"></div>
                </div>
            </div>
            
            <div class="media-controls">
                <div class="control-buttons">
                    <button class="control-btn prev" title="Previous">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.588a.7.7 0 0 1-1.05.606L4 8.149V13.3a.7.7 0 0 1-1.4 0V1.7a.7.7 0 0 1 .7-.7z"/>
                        </svg>
                    </button>
                    <button class="control-btn play-pause main-play" title="Play/Pause">
                        <svg class="play-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="m7.05 3.606 13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/>
                        </svg>
                        <svg class="pause-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                            <path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/>
                        </svg>
                    </button>
                    <button class="control-btn next" title="Next">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.588a.7.7 0 0 0 1.05.606L12 8.149V13.3a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z"/>
                        </svg>
                    </button>
                </div>
                
                <div class="progress-container">
                    <span class="progress-time">0:00</span>
                    <div class="progress-bar">
                        <div class="progress-filled"></div>
                        <div class="progress-handle"></div>
                    </div>
                    <span class="progress-time">0:00</span>
                </div>
            </div>
            
            <div class="media-volume">
                <button class="volume-btn" title="Mute/Unmute">
                    <svg class="volume-high" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M9.741.85a.8.8 0 0 1 .375.65v13a.8.8 0 0 1-1.125.73L6.295 14.03H4.09a1.1 1.1 0 0 1-1.1-1.1V3.07a1.1 1.1 0 0 1 1.1-1.1h2.205L9.001.77a.8.8 0 0 1 .74.08z"/>
                        <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
                        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89l.706.706z"/>
                    </svg>
                    <svg class="volume-medium" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                        <path d="M9.741.85a.8.8 0 0 1 .375.65v13a.8.8 0 0 1-1.125.73L6.295 14.03H4.09a1.1 1.1 0 0 1-1.1-1.1V3.07a1.1 1.1 0 0 1 1.1-1.1h2.205L9.001.77a.8.8 0 0 1 .74.08z"/>
                        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89l.706.706z"/>
                    </svg>
                    <svg class="volume-low" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                        <path d="M9.741.85a.8.8 0 0 1 .375.65v13a.8.8 0 0 1-1.125.73L6.295 14.03H4.09a1.1 1.1 0 0 1-1.1-1.1V3.07a1.1 1.1 0 0 1 1.1-1.1h2.205L9.001.77a.8.8 0 0 1 .74.08z"/>
                    </svg>
                    <svg class="volume-mute" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                        <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
                        <path d="m9 4 6 6-6 6V4z"/>
                    </svg>
                </button>
                <div class="volume-slider">
                    <div class="volume-filled"></div>
                    <div class="volume-handle"></div>
                </div>
                <button class="minimize-btn" title="Minimize">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
                    </svg>
                </button>
                <button class="close-btn" title="Close">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                    </svg>
                </button>
            </div>
            
            <div class="media-minimized-info">
                <div class="minimized-title"></div>
                <div class="minimized-controls">
                    <button class="control-btn play-pause" title="Play/Pause">
                        <svg class="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="m7.05 3.606 13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/>
                        </svg>
                        <svg class="pause-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                            <path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/>
                        </svg>
                    </button>
                    <button class="minimize-btn" title="Maximize">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                        </svg>
                    </button>
                    <button class="close-btn" title="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <audio style="display: none;"></audio>
            <video style="display: none;"></video>
        `;
        
        document.body.appendChild(player);
        
        this.audioElement = player.querySelector('audio');
        this.videoElement = player.querySelector('video');
        this.playerElement = player;
        
        this.audioElement.volume = this.volume;
        this.videoElement.volume = this.volume;
        this.updateVolumeUI();
    }
    
    bindEvents() {
        this.playerElement.querySelector('.play-pause').addEventListener('click', () => {
            this.togglePlayPause();
        });
        
        this.playerElement.querySelector('.prev').addEventListener('click', () => {
            this.playPrevious();
        });
        
        this.playerElement.querySelector('.next').addEventListener('click', () => {
            this.playNext();
        });
        
        const progressBar = this.playerElement.querySelector('.progress-bar');
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            this.seekTo(percent);
        });
        
        const volumeSlider = this.playerElement.querySelector('.volume-slider');
        volumeSlider.addEventListener('click', (e) => {
            const rect = volumeSlider.getBoundingClientRect();
            const volume = (e.clientX - rect.left) / rect.width;
            this.setVolume(volume);
        });
        
        this.playerElement.querySelectorAll('.minimize-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.toggleMinimize();
            });
        });
        
        this.playerElement.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.stop();
                this.hide();
            });
        });
        
        this.audioElement.addEventListener('timeupdate', () => {
            if (this.currentMedia && this.currentMedia.type === 'audio') {
                this.updateProgress();
            }
        });
        
        this.audioElement.addEventListener('ended', () => {
            this.playNext();
        });
        
        this.videoElement.addEventListener('timeupdate', () => {
            if (this.currentMedia && this.currentMedia.type === 'video' && !this.isVideoModalOpen) {
                this.updateProgress();
            }
        });
        
        this.videoElement.addEventListener('ended', () => {
            this.playNext();
        });
    }
    
    playAudio(path) {
        this.stop();
        
        this.currentMedia = { type: 'audio', path };
        
        this.audioElement.src = `/api/files/download?path=${encodeURIComponent(path)}`;
        this.audioElement.play().catch(error => {
            console.error('Audio play error:', error);
        });
        this.isPlaying = true;
        
        this.updateMediaInfo(path);
        this.updatePlayButton();
        this.show();
    }
    
    playVideo(path) {
        this.stop();
        
        this.currentMedia = { type: 'video', path };
        
        this.isPlaying = true;
        
        this.updateMediaInfo(path);
        this.updatePlayButton();
        this.show();
        
        this.showVideoModal();
    }
    
    showVideoModal() {
        if (this.isVideoModalOpen) return;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay video-modal';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <div class="modal-title">${this.currentMedia.path.split('/').pop()}</div>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <video controls autoplay style="width: 100%; max-height: 70vh;"></video>
                </div>
            </div>
        `;
        
        const video = modal.querySelector('video');
        video.src = `/api/files/download?path=${encodeURIComponent(this.currentMedia.path)}`;
        video.volume = this.volume;
        
        this.modalVideoElement = video;
        
        modal.querySelector('.modal-close').addEventListener('click', () => {
            this.closeVideoModal();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeVideoModal();
            }
        });
        
        document.body.appendChild(modal);
        this.videoModal = modal;
        this.isVideoModalOpen = true;
        
        video.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButton();
        });
        
        video.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });
        
        video.addEventListener('timeupdate', () => {
            if (this.isVideoModalOpen) {
                this.updateProgress();
            }
        });
        
        video.addEventListener('ended', () => {
            this.playNext();
        });
    }
    
    closeVideoModal() {
        if (this.videoModal) {
            if (this.modalVideoElement) {
                this.modalVideoElement.pause();
                this.modalVideoElement.src = '';
            }
            this.videoModal.remove();
            this.videoModal = null;
            this.modalVideoElement = null;
        }
        this.isVideoModalOpen = false;
        this.isPlaying = false;
        this.updatePlayButton();
    }
    
    togglePlayPause() {
        if (!this.currentMedia) return;
        
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    play() {
        if (!this.currentMedia) return;
        
        if (this.currentMedia.type === 'audio') {
            this.audioElement.play().catch(error => {
                console.error('Audio play error:', error);
            });
        } else if (this.currentMedia.type === 'video') {
            if (this.isVideoModalOpen && this.modalVideoElement) {
                this.modalVideoElement.play().catch(error => {
                    console.error('Video play error:', error);
                });
            } else {
                this.showVideoModal();
            }
        }
        
        this.isPlaying = true;
        this.updatePlayButton();
    }
    
    pause() {
        if (!this.currentMedia) return;
        
        if (this.currentMedia.type === 'audio') {
            this.audioElement.pause();
        } else if (this.currentMedia.type === 'video') {
            if (this.isVideoModalOpen && this.modalVideoElement) {
                this.modalVideoElement.pause();
            }
        }
        
        this.isPlaying = false;
        this.updatePlayButton();
    }
    
    stop() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
        }
        
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
        }
        
        this.closeVideoModal();
        
        this.currentMedia = null;
        this.isPlaying = false;
        this.updatePlayButton();
    }
    
    seekTo(percent) {
        if (!this.currentMedia) return;
        
        let mediaElement;
        if (this.currentMedia.type === 'audio') {
            mediaElement = this.audioElement;
        } else if (this.currentMedia.type === 'video') {
            if (this.isVideoModalOpen && this.modalVideoElement) {
                mediaElement = this.modalVideoElement;
            } else {
                return;
            }
        }
        
        if (mediaElement && !isNaN(mediaElement.duration)) {
            mediaElement.currentTime = percent * mediaElement.duration;
        }
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        
        if (this.audioElement) {
            this.audioElement.volume = this.volume;
        }
        
        if (this.videoElement) {
            this.videoElement.volume = this.volume;
        }
        
        if (this.isVideoModalOpen && this.modalVideoElement) {
            this.modalVideoElement.volume = this.volume;
        }
        
        this.updateVolumeUI();
    }
    
    playPrevious() {
        if (this.playlist.length === 0) return;
        
        this.currentIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
        this.playMediaFromPlaylist();
    }
    
    playNext() {
        if (this.playlist.length === 0) return;
        
        this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
        this.playMediaFromPlaylist();
    }
    
    playMediaFromPlaylist() {
        const media = this.playlist[this.currentIndex];
        
        if (media.mime_type.startsWith('audio/')) {
            this.playAudio(media.path);
        } else if (media.mime_type.startsWith('video/')) {
            this.playVideo(media.path);
        }
    }
    
    setPlaylist(files) {
        this.playlist = files.filter(file => 
            file.mime_type && (file.mime_type.startsWith('audio/') || file.mime_type.startsWith('video/'))
        );
        
        this.currentIndex = 0;
    }
    
    updateMediaInfo(path) {
        const fileName = path.split('/').pop();
        const titleElement = this.playerElement.querySelector('.media-title');
        const artistElement = this.playerElement.querySelector('.media-artist');
        const thumbnailElement = this.playerElement.querySelector('.media-thumbnail');
        const minimizedTitle = this.playerElement.querySelector('.minimized-title');
        
        titleElement.textContent = fileName;
        minimizedTitle.textContent = fileName;
        artistElement.textContent = '';
        
        if (this.currentMedia.type === 'audio') {
            const folderName = path.split('/').slice(-2, -1)[0] || '';
            artistElement.textContent = folderName;
        }
        
        if (this.currentMedia.type === 'audio') {
            thumbnailElement.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBmaWxsPSIjNjY2IiBkPSJNMjU2IDhDMTE5IDggOCAxMTkgOCAyNTZzMTExIDI0OCAyNDggMjQ4IDI0OC0xMTEgMjQ4LTI0OFMzOTMgOCAyNTYgOHptMCA0NDhjLTExMC41IDAtMjAwLTg5LjUtMjAwLTIwMFMxNDUuNSA1NiAyNTYgNTZzMjAwIDg5LjUgMjAwIDIwMC04OS41IDIwMC0yMDAgMjAweiIvPjxwYXRoIGZpbGw9IiM2NjYiIGQ9Ik0yNjQgNDE2Yy0zMS42IDAtNDcuOC0yMS44LTQ3LjgtNDEuOGMwLTE1LjIgMTEuNC0zMC44IDM1LjQtNDUuMmw0LjItMi40di03My4yYzAtNS44LTQuOC0xMC42LTEwLjYtMTAuNmgtNS4yYy01LjggMC0xMC42IDQuOC0xMC42IDEwLjZ2NDQuNGwtMy4xLTEuNmMtMjQuOS0xMy45LTQwLjEtMjYuOC00MC4xLTQ2LjcgMC0zMC44IDI4LjUtNDYuNyA1Ni4xLTQ2LjcgMzEuNiAwIDQ3LjggMjEuOCA0Ny44IDQxLjggMCAxNS4yLTExLjQgMzAuOC0zNS40IDQ1LjJsLTQuMiAyLjR2NzMuMmMwIDUuOCA0LjggMTAuNiAxMC42IDEwLjZoNS4yYzUuOCAwIDEwLjYtNC44IDEwLjYtMTAuNnYtNDQuNGwyLjQgMS4yYzI1LjYgMTQuNCA0MS44IDI3LjYgNDEuOCA0Ny44IDAgMzEuNi0yOS42IDQ3LjgtNTcuOCA0Ny44eiIvPjwvc3ZnPg==';
        } else {
            thumbnailElement.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBmaWxsPSIjNjY2IiBkPSJNNDQ4IDgwSDY0QzI4LjcgODAgMCAxMDguNyAwIDE0NHYyMjRjMCAzNS4zIDI4LjcgNjQgNjQgNjRoMzg0YzM1LjMgMCA2NC0yOC43IDY0LTY0VjE0NGMwLTM1LjMtMjguNy02NC02NC02NHptLTY0IDI0MGMwIDYuNi01LjQgMTItMTIgMTJIMTQwYy02LjYgMC0xMi01LjQtMTItMTJ2LTcyYzAtNi42IDUuNC0xMiAxMi0xMmgxMzJjNi42IDAgMTIgNS40IDEyIDEydjcyeiIvPjwvc3ZnPg==';
        }
    }
    
    updateProgress() {
        if (!this.currentMedia) return;
        
        let currentTime = 0;
        let duration = 0;
        
        if (this.currentMedia.type === 'audio') {
            currentTime = this.audioElement.currentTime || 0;
            duration = this.audioElement.duration || 0;
        } else if (this.currentMedia.type === 'video') {
            if (this.isVideoModalOpen && this.modalVideoElement) {
                currentTime = this.modalVideoElement.currentTime || 0;
                duration = this.modalVideoElement.duration || 0;
            }
        }
        
        const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.playerElement.querySelector('.progress-filled').style.width = `${progressPercent}%`;
        
        const timeElements = this.playerElement.querySelectorAll('.progress-time');
        if (timeElements.length >= 2) {
            timeElements[0].textContent = this.formatTime(currentTime);
            timeElements[1].textContent = this.formatTime(duration);
        }
    }
    
    updatePlayButton() {
        const playIcons = this.playerElement.querySelectorAll('.play-icon');
        const pauseIcons = this.playerElement.querySelectorAll('.pause-icon');
        
        if (this.isPlaying) {
            playIcons.forEach(icon => icon.style.display = 'none');
            pauseIcons.forEach(icon => icon.style.display = 'block');
        } else {
            playIcons.forEach(icon => icon.style.display = 'block');
            pauseIcons.forEach(icon => icon.style.display = 'none');
        }
    }
    
    updateVolumeUI() {
        const volumeFilled = this.playerElement.querySelector('.volume-filled');
        if (volumeFilled) {
            volumeFilled.style.width = `${this.volume * 100}%`;
        }
        
        const volumeHigh = this.playerElement.querySelector('.volume-high');
        const volumeMedium = this.playerElement.querySelector('.volume-medium');
        const volumeLow = this.playerElement.querySelector('.volume-low');
        const volumeMute = this.playerElement.querySelector('.volume-mute');
        
        volumeHigh.style.display = 'none';
        volumeMedium.style.display = 'none';
        volumeLow.style.display = 'none';
        volumeMute.style.display = 'none';
        
        if (this.volume === 0) {
            volumeMute.style.display = 'block';
        } else if (this.volume < 0.3) {
            volumeLow.style.display = 'block';
        } else if (this.volume < 0.7) {
            volumeMedium.style.display = 'block';
        } else {
            volumeHigh.style.display = 'block';
        }
    }
    
    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        
        if (this.isMinimized) {
            this.playerElement.classList.add('minimized');
        } else {
            this.playerElement.classList.remove('minimized');
        }
    }
    
    show() {
        this.playerElement.style.display = 'flex';
    }
    
    hide() {
        this.playerElement.style.display = 'none';
    }
    
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}
