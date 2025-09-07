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
                    <button class="control-btn prev">⏮</button>
                    <button class="control-btn play-pause">⏯</button>
                    <button class="control-btn next">⏭</button>
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
                <button class="volume-btn">🔊</button>
                <div class="volume-slider">
                    <div class="volume-filled"></div>
                    <div class="volume-handle"></div>
                </div>
                <button class="minimize-btn" title="Minimize">➖</button>
                <button class="close-btn" title="Close">✕</button>
            </div>
            
            <div class="media-minimized-info">
                <div class="minimized-title"></div>
                <div class="minimized-controls">
                    <button class="control-btn play-pause">⏯</button>
                    <button class="minimize-btn" title="Maximize">➕</button>
                    <button class="close-btn" title="Close">✕</button>
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
            this.updateProgress();
        });
        
        this.audioElement.addEventListener('ended', () => {
            this.playNext();
        });
        
        this.videoElement.addEventListener('timeupdate', () => {
            this.updateProgress();
        });
        
        this.videoElement.addEventListener('ended', () => {
            this.playNext();
        });
    }
    
    playAudio(path) {
        // 既に再生中の場合は停止
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
        // 既に再生中の場合は停止
        this.stop();
        
        this.currentMedia = { type: 'video', path };
        
        // ビデオモーダルが既に開いている場合は閉じる
        if (this.isVideoModalOpen) {
            this.closeVideoModal();
        }
        
        this.videoElement.src = `/api/files/download?path=${encodeURIComponent(path)}`;
        this.videoElement.play().catch(error => {
            console.error('Video play error:', error);
        });
        this.isPlaying = true;
        
        this.updateMediaInfo(path);
        this.updatePlayButton();
        this.show();
        
        // ビデオの場合はモーダルで表示
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
        video.src = this.videoElement.src;
        video.volume = this.volume;
        
        modal.querySelector('.modal-close').addEventListener('click', () => {
            this.closeVideoModal();
        });
        
        // モーダル外をクリックで閉じる
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeVideoModal();
            }
        });
        
        document.body.appendChild(modal);
        this.videoModal = modal;
        this.isVideoModalOpen = true;
        
        // ビデオモーダル内のビデオ要素にもイベントを設定
        video.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButton();
        });
        
        video.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });
        
        video.addEventListener('timeupdate', () => {
            this.updateProgress();
        });
    }
    
    closeVideoModal() {
        if (this.videoModal) {
            this.videoModal.remove();
            this.videoModal = null;
        }
        this.isVideoModalOpen = false;
        this.pause();
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
        } else {
            if (this.isVideoModalOpen && this.videoModal) {
                const video = this.videoModal.querySelector('video');
                video.play().catch(error => {
                    console.error('Video play error:', error);
                });
            } else {
                this.videoElement.play().catch(error => {
                    console.error('Video play error:', error);
                });
            }
        }
        
        this.isPlaying = true;
        this.updatePlayButton();
    }
    
    pause() {
        if (!this.currentMedia) return;
        
        if (this.currentMedia.type === 'audio') {
            this.audioElement.pause();
        } else {
            if (this.isVideoModalOpen && this.videoModal) {
                const video = this.videoModal.querySelector('video');
                video.pause();
            } else {
                this.videoElement.pause();
            }
        }
        
        this.isPlaying = false;
        this.updatePlayButton();
    }
    
    stop() {
        this.audioElement.pause();
        this.audioElement.src = '';
        
        this.videoElement.pause();
        this.videoElement.src = '';
        
        // ビデオモーダルも閉じる
        this.closeVideoModal();
        
        this.isPlaying = false;
        this.updatePlayButton();
    }
    
    seekTo(percent) {
        if (!this.currentMedia) return;
        
        let mediaElement;
        if (this.currentMedia.type === 'audio') {
            mediaElement = this.audioElement;
        } else {
            if (this.isVideoModalOpen && this.videoModal) {
                mediaElement = this.videoModal.querySelector('video');
            } else {
                mediaElement = this.videoElement;
            }
        }
        
        mediaElement.currentTime = percent * mediaElement.duration;
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        
        this.audioElement.volume = this.volume;
        this.videoElement.volume = this.volume;
        
        if (this.isVideoModalOpen && this.videoModal) {
            const video = this.videoModal.querySelector('video');
            video.volume = this.volume;
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
        
        let mediaElement;
        let currentTime;
        let duration;
        
        if (this.currentMedia.type === 'audio') {
            mediaElement = this.audioElement;
            currentTime = mediaElement.currentTime;
            duration = mediaElement.duration || 0;
        } else {
            if (this.isVideoModalOpen && this.videoModal) {
                mediaElement = this.videoModal.querySelector('video');
                currentTime = mediaElement.currentTime;
                duration = mediaElement.duration || 0;
            } else {
                mediaElement = this.videoElement;
                currentTime = mediaElement.currentTime;
                duration = mediaElement.duration || 0;
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
        const buttons = this.playerElement.querySelectorAll('.play-pause');
        buttons.forEach(button => {
            button.textContent = this.isPlaying ? '⏸' : '⏯';
        });
    }
    
    updateVolumeUI() {
        const volumeFilled = this.playerElement.querySelector('.volume-filled');
        if (volumeFilled) {
            volumeFilled.style.width = `${this.volume * 100}%`;
        }
        
        const volumeBtn = this.playerElement.querySelector('.volume-btn');
        if (volumeBtn) {
            if (this.volume === 0) {
                volumeBtn.textContent = '🔇';
            } else if (this.volume < 0.3) {
                volumeBtn.textContent = '🔈';
            } else if (this.volume < 0.7) {
                volumeBtn.textContent = '🔉';
            } else {
                volumeBtn.textContent = '🔊';
            }
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
