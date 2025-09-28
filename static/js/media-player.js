export class MediaPlayer {
    constructor() {
        this.audioElement = null;
        this.videoElement = null;
        this.currentMedia = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.playlist = [];
        this.originalPlaylist = [];
        this.currentIndex = 0;
        this.isMinimized = false;
        this.isVideoModalOpen = false;
        this.videoModal = null;
        this.modalVideoElement = null;
        this.previousVolume = this.volume;

        this.playbackMode = {
            main: 'off', // off, shuffle, smart_shuffle, repeat_one
            repeat_playlist: false,
        };

        this.currentDirectory = '';
        this.albumArtCache = new Map();

        this.init();
    }

    init() {
        this.createPlayerElement();
        this.bindEvents();
        this.hide();
        this.updateModeUI();
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
                    <div class="media-album"></div>
                </div>
            </div>
            
            <div class="media-controls">
                <div class="control-buttons">
                    <button class="control-btn mode-btn" title="Playback Mode">
                        <svg class="shuffle-off-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.624 9.624 0 0 0 7.556 8a9.624 9.624 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.595 10.595 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.624 9.624 0 0 0 6.444 8a9.624 9.624 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5z"/>
                            <path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192z"/>
                        </svg>
                        <svg class="smart-shuffle-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style="display: none;">
                            <path d="M9.5 2.672a.5.5 0 1 0 1 0V.843a.5.5 0 0 0-1 0v1.829Zm4.5.035A.5.5 0 0 0 13.293 2L12 3.293a.5.5 0 1 0 .707.707L14 3.707a.5.5 0 0 0 0-.707ZM7.293 4L8 3.293a.5.5 0 0 0-.707-.707L6.293 3a.5.5 0 0 0 0 .707.5.5 0 0 0 .707 0Zm-.195-2.344a.5.5 0 1 0 .707-.707L6.105.25a.5.5 0 0 0-.707.707l1.697 1.697ZM1.5 10.672a.5.5 0 1 0 1 0V8.843a.5.5 0 0 0-1 0v1.829Zm4.5.035A.5.5 0 0 0 5.293 10L4 11.293a.5.5 0 1 0 .707.707L6 11.707a.5.5 0 0 0 0-.707ZM11.293 12L12 11.293a.5.5 0 0 0-.707-.707L10.293 11a.5.5 0 0 0 0 .707.5.5 0 0 0 .707 0Zm-.195-2.344a.5.5 0 1 0 .707-.707L10.105 8.25a.5.5 0 0 0-.707.707l1.697 1.697ZM2.18 8.93a1.5 1.5 0 0 0 2.12 0l5.248-5.248a1.5 1.5 0 0 0-2.122-2.12L2.18 6.808a1.5 1.5 0 0 0 0 2.122Z"/>
                        </svg>
                        <svg class="repeat-one-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                            <path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4h6Zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13H11a5 5 0 0 0 4.48-7.223Z"/>
                            <text x="8" y="11" font-size="6" text-anchor="middle" fill="currentColor">1</text>
                        </svg>
                    </button>
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
                    <button class="control-btn repeat-btn" title="Repeat Playlist">
                        <svg class="repeat-off-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                             <path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192Zm3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>
                        </svg>
                        <svg class="repeat-on-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                            <path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192Zm3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>
                        </svg>
                    </button>
                </div>
                
                <div class="progress-container">
                    <span class="progress-time">0:00</span>
                    <div class="progress-bar">
                        <div class="progress-bar-fill"></div>
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
                        <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zM8.5 5.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1h2zm0 2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1h2zm0 2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1h2z"/>
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
                        <path fill-rule="evenodd" d="M13.854 2.146a.5.5 0 0 1 0 .708l-11 11a.5.5 0 0 1-.708-.708l11-11a.5.5 0 0 1 .708 0Z"/>
                        <path fill-rule="evenodd" d="M2.146 2.146a.5.5 0 0 0 0 .708l11 11a.5.5 0 0 0 .708-.708l-11-11a.5.5 0 0 0-.708 0Z"/>
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
                            <path fill-rule="evenodd" d="M13.854 2.146a.5.5 0 0 1 0 .708l-11 11a.5.5 0 0 1-.708-.708l11-11a.5.5 0 0 1 .708 0Z"/>
                        <path fill-rule="evenodd" d="M2.146 2.146a.5.5 0 0 0 0 .708l11 11a.5.5 0 0 0 .708-.708l-11-11a.5.5 0 0 0-.708 0Z"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            <audio style="display: none;"></audio>
            <video style="display: none;"></video>
        `;
        
        document.body.appendChild(player);
        this.playerElement = player;
        this.audioElement = player.querySelector('audio');
        this.videoElement = player.querySelector('video');
        this.audioElement.volume = this.volume;
        this.videoElement.volume = this.volume;
        this.updateVolumeUI();
    }
   
    bindEvents() {
        this.playerElement.querySelectorAll('.play-pause').forEach(btn => btn.addEventListener('click', () => this.togglePlayPause()));
        this.playerElement.querySelector('.prev').addEventListener('click', () => this.playPrevious());
        this.playerElement.querySelector('.next').addEventListener('click', () => this.playNext());
        this.playerElement.querySelector('.mode-btn').addEventListener('click', () => this.toggleMainMode());
        this.playerElement.querySelector('.repeat-btn').addEventListener('click', () => this.toggleRepeatPlaylistMode());
        this.playerElement.querySelector('.progress-bar').addEventListener('click', (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            this.seekTo((e.clientX - rect.left) / rect.width);
        });
        this.playerElement.querySelector('.volume-slider').addEventListener('click', (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            this.setVolume((e.clientX - rect.left) / rect.width);
        });
        this.playerElement.querySelector('.volume-btn').addEventListener('click', () => this.toggleMute());
        this.playerElement.querySelectorAll('.minimize-btn').forEach(btn => btn.addEventListener('click', () => this.toggleMinimize()));
        this.playerElement.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', () => { this.stop(); this.hide(); }));
        
        this.audioElement.addEventListener('timeupdate', () => this.updateProgress());
        this.audioElement.addEventListener('ended', () => this.handleMediaEnded());
        this.videoElement.addEventListener('timeupdate', () => this.updateProgress());
        this.videoElement.addEventListener('ended', () => this.handleMediaEnded());
    }

    createPlaylistFromUI() {
        const mediaFiles = [];
        document.querySelectorAll('.file-item, .masonry-item').forEach(item => {
            if (item.dataset.path && (item.dataset.mimeType || '').startsWith('audio/')) {
                mediaFiles.push({
                    path: item.dataset.path,
                    mime_type: item.dataset.mimeType,
                    name: item.querySelector('.file-name, .masonry-name')?.textContent || item.dataset.path.split('/').pop()
                });
            }
        });
        this.playlist = mediaFiles;
        this.originalPlaylist = [...mediaFiles];
    }

    playAudio(path) {
        this.stop();
        this.createPlaylistFromUI();
        const newIndex = this.playlist.findIndex(file => file.path === path);
        this.currentIndex = (newIndex !== -1) ? newIndex : 0;
        if (this.playlist.length === 0) return;
        if (this.playbackMode.main === 'shuffle' || this.playbackMode.main === 'smart_shuffle') {
            this.shufflePlaylist();
        }
        this.currentDirectory = path.split('/').slice(0, -1).join('/');
        this.playCurrentTrack();
    }

    playVideo(path) {
        this.stop();
        this.clearPlaylist();
        this.currentMedia = { type: 'video', path };
        this.isPlaying = true;
        this.updateMediaInfo(path);
        this.updatePlayButton();
        this.show();
        this.showVideoModal();
    }

    playCurrentTrack() {
        if (this.playlist.length === 0 || this.currentIndex < 0 || this.currentIndex >= this.playlist.length) {
            this.stop();
            this.hide();
            return;
        }
        const media = this.playlist[this.currentIndex];
        this.currentMedia = { type: 'audio', path: media.path };
        this.audioElement.src = `/api/files/download?path=${encodeURIComponent(media.path)}`;
        this.audioElement.play().catch(error => console.error('Audio play error:', error));
        this.isPlaying = true;
        this.updateMediaInfo(media.path);
        this.updatePlayButton();
        this.show();
    }

    handleMediaEnded() {
        if (this.playbackMode.main === 'repeat_one') {
            this.seekTo(0);
            this.play();
            return;
        }
        const isLastTrack = this.currentIndex >= this.playlist.length - 1;
        if (!isLastTrack) {
            this.playNext(false);
        } else if (this.playbackMode.repeat_playlist) {
            this.playNext(true);
        } else if (this.playbackMode.main === 'smart_shuffle') {
            this.playNextFromRandomFolder();
        } else {
            this.pause();
        }
    }

    playPrevious() {
        if (this.playlist.length === 0) return;
        if (this.currentIndex > 0) {
            this.currentIndex--;
        } else if (this.playbackMode.repeat_playlist) {
            this.currentIndex = this.playlist.length - 1;
        } else {
            return;
        }
        this.playCurrentTrack();
    }

    playNext(isLoop = false) {
        if (this.playlist.length === 0) return;
        if (this.currentIndex < this.playlist.length - 1) {
            this.currentIndex++;
        } else if (isLoop) {
            this.currentIndex = 0;
        } else {
            return;
        }
        this.playCurrentTrack();
    }

    async playNextFromRandomFolder() {
        if (!this.currentDirectory) return;
        const normalize = p => (p.length > 1 && p.endsWith('/')) ? p.slice(0, -1) : p;
        const currentNorm = normalize(this.currentDirectory);
        const parentDir = currentNorm.substring(0, currentNorm.lastIndexOf('/')) || '/';

        if (parentDir === currentNorm) return;

        try {
            const response = await fetch(`/api/files?path=${encodeURIComponent(parentDir)}`);
            const result = await response.json();
            if (!result.success || !result.data) return;

            const siblingDirs = result.data.filter(f => f.is_dir && normalize(f.path) !== currentNorm);
            if (siblingDirs.length === 0) return;

            let attempts = 0;
            const shuffledSiblings = siblingDirs.sort(() => 0.5 - Math.random());

            while (attempts < shuffledSiblings.length) {
                const randomDir = shuffledSiblings[attempts];
                const dirResponse = await fetch(`/api/files?path=${encodeURIComponent(randomDir.path)}`);
                const dirResult = await dirResponse.json();
                if (dirResult.success && dirResult.data) {
                    const audioFiles = dirResult.data
                        .filter(f => f.mime_type?.startsWith('audio/'))
                        .map(f => ({ path: f.path, mime_type: f.mime_type, name: f.name }));
                    if (audioFiles.length > 0) {
                        this.playlist = audioFiles;
                        this.originalPlaylist = [...audioFiles];
                        this.currentIndex = 0;
                        this.currentDirectory = randomDir.path;
                        this.playCurrentTrack();
                        return;
                    }
                }
                attempts++;
            }
        } catch (error) {
            console.error("Error during smart shuffle:", error);
        }
    }

    toggleMainMode() {
        const modes = ['off', 'shuffle', 'smart_shuffle', 'repeat_one'];
        const currentModeIndex = modes.indexOf(this.playbackMode.main);
        this.playbackMode.main = modes[(currentModeIndex + 1) % modes.length];

        const mainMode = this.playbackMode.main;
        const wasShuffled = this.isShuffledMode(modes[currentModeIndex]);
        const isShuffled = this.isShuffledMode(mainMode);

        if (isShuffled && !wasShuffled) {
            this.shufflePlaylist();
        } else if (!isShuffled && wasShuffled) {
            this.playlist = [...this.originalPlaylist];
            const currentPath = this.currentMedia?.path;
            if (currentPath) {
                const newIndex = this.playlist.findIndex(item => item.path === currentPath);
                if (newIndex !== -1) this.currentIndex = newIndex;
            }
        }
        this.updateModeUI();
    }
    
    isShuffledMode(mode) {
        return mode === 'shuffle' || mode === 'smart_shuffle';
    }

    toggleRepeatPlaylistMode() {
        this.playbackMode.repeat_playlist = !this.playbackMode.repeat_playlist;
        this.updateModeUI();
    }

    shufflePlaylist() {
        if (this.playlist.length < 2) return;
        const currentItem = this.playlist[this.currentIndex];
        const rest = this.playlist.filter((_, index) => index !== this.currentIndex);
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        this.playlist = [currentItem, ...rest];
        this.currentIndex = 0;
    }

    updateModeUI() {
        const modeBtn = this.playerElement.querySelector('.mode-btn');
        const repeatBtn = this.playerElement.querySelector('.repeat-btn');
        const icons = {
            shuffle: modeBtn.querySelector('.shuffle-off-icon'),
            smart: modeBtn.querySelector('.smart-shuffle-icon'),
            repeatOne: modeBtn.querySelector('.repeat-one-icon'),
            repeatOff: repeatBtn.querySelector('.repeat-off-icon'),
            repeatOn: repeatBtn.querySelector('.repeat-on-icon'),
        };
        
        Object.values(icons).forEach(i => { if(i) i.style.display = 'none'; });
        modeBtn.style.color = '';

        switch (this.playbackMode.main) {
            case 'shuffle':
                icons.shuffle.style.display = 'block';
                modeBtn.style.color = '#4A90E2';
                modeBtn.setAttribute('title', 'Shuffle');
                break;
            case 'smart_shuffle':
                icons.smart.style.display = 'block';
                modeBtn.style.color = '#4A90E2';
                modeBtn.setAttribute('title', 'Smart Shuffle');
                break;
            case 'repeat_one':
                icons.repeatOne.style.display = 'block';
                modeBtn.style.color = '#4A90E2';
                modeBtn.setAttribute('title', 'Repeat One');
                break;
            default: // off
                icons.shuffle.style.display = 'block';
                modeBtn.setAttribute('title', 'Mode: Off');
                break;
        }

        repeatBtn.style.color = this.playbackMode.repeat_playlist ? '#4A90E2' : '';
        icons.repeatOn.style.display = this.playbackMode.repeat_playlist ? 'block' : 'none';
        icons.repeatOff.style.display = this.playbackMode.repeat_playlist ? 'none' : 'block';
    }

    togglePlayPause() { if (!this.currentMedia) return; this.isPlaying ? this.pause() : this.play(); }

    play() {
        if (!this.currentMedia) return;
        if (this.currentMedia.type === 'audio') {
            this.audioElement.play().catch(e => console.error('Play error:', e));
        } else if (this.currentMedia.type === 'video') {
            this.isVideoModalOpen ? this.modalVideoElement.play() : this.showVideoModal();
        }
        this.isPlaying = true;
        this.updatePlayButton();
    }

    pause() {
        if (this.currentMedia?.type === 'audio') this.audioElement.pause();
        if (this.currentMedia?.type === 'video' && this.modalVideoElement) this.modalVideoElement.pause();
        this.isPlaying = false;
        this.updatePlayButton();
    }

    stop() {
        this.pause();
        if (this.audioElement) this.audioElement.src = '';
        if (this.videoElement) this.videoElement.src = '';
        this.closeVideoModal();
        this.currentMedia = null;
    }

    seekTo(percent) {
        let mediaElement = this.currentMedia?.type === 'audio' ? this.audioElement : this.modalVideoElement;
        if (mediaElement && !isNaN(mediaElement.duration)) {
            mediaElement.currentTime = percent * mediaElement.duration;
        }
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.audioElement) this.audioElement.volume = this.volume;
        if (this.videoElement) this.videoElement.volume = this.volume;
        if (this.modalVideoElement) this.modalVideoElement.volume = this.volume;
        this.updateVolumeUI();
    }

    toggleMute() {
        this.setVolume(this.volume > 0 ? 0 : (this.previousVolume || 0.7));
        this.previousVolume = this.volume > 0 ? this.volume : this.previousVolume;
    }

    async updateMediaInfo(path) {
        this.currentMedia.path = path;
        const fileName = path.split('/').pop();
        const folderName = path.split('/').slice(0, -1).pop() || '';
        this.playerElement.querySelector('.media-title').textContent = fileName;
        this.playerElement.querySelector('.media-artist').textContent = folderName;
        this.playerElement.querySelector('.minimized-title').textContent = `${folderName} - ${fileName}`;
        try {
            const albumArt = await this.getAlbumArt(path);
            this.playerElement.querySelector('.media-thumbnail').src = albumArt;
        } catch (error) {
            this.playerElement.querySelector('.media-thumbnail').src = this.getDefaultAlbumArt();
        }
    }

    updateProgress() {
        let media = this.currentMedia?.type === 'audio' ? this.audioElement : this.modalVideoElement;
        if (!media || !this.currentMedia) return;
        const { currentTime = 0, duration = 0 } = media;
        const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.playerElement.querySelector('.progress-bar-fill').style.width = `${progressPercent}%`;
        const timeElements = this.playerElement.querySelectorAll('.progress-time');
        timeElements[0].textContent = this.formatTime(currentTime);
        timeElements[1].textContent = this.formatTime(duration);
    }

    updatePlayButton() {
        const isPlaying = this.isPlaying;
        this.playerElement.querySelectorAll('.play-icon').forEach(i => i.style.display = isPlaying ? 'none' : 'block');
        this.playerElement.querySelectorAll('.pause-icon').forEach(i => i.style.display = isPlaying ? 'block' : 'none');
    }

    updateVolumeUI() {
        if (!this.playerElement) return;
        const volumeFilled = this.playerElement.querySelector('.volume-filled');
        if(volumeFilled) volumeFilled.style.width = `${this.volume * 100}%`;
        
        const icons = {
            high: this.playerElement.querySelector('.volume-high'),
            medium: this.playerElement.querySelector('.volume-medium'),
            low: this.playerElement.querySelector('.volume-low'),
            mute: this.playerElement.querySelector('.volume-mute')
        };
        Object.values(icons).forEach(i => { if(i) i.style.display = 'none'; });

        if (!icons.high) return; // Guard against null icons

        if (this.volume === 0) icons.mute.style.display = 'block';
        else if (this.volume < 0.3) icons.low.style.display = 'block';
        else if (this.volume < 0.7) icons.medium.style.display = 'block';
        else icons.high.style.display = 'block';
    }

    toggleMinimize() { this.isMinimized = !this.isMinimized; this.playerElement.classList.toggle('minimized', this.isMinimized); }
    show() { this.playerElement.style.display = 'flex'; }
    hide() { this.playerElement.style.display = 'none'; }

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
        modal.querySelector('.modal-close').addEventListener('click', () => this.closeVideoModal());
        modal.addEventListener('click', (e) => { if (e.target === modal) this.closeVideoModal(); });
        document.body.appendChild(modal);
        this.videoModal = modal;
        this.isVideoModalOpen = true;
        video.addEventListener('play', () => { this.isPlaying = true; this.updatePlayButton(); });
        video.addEventListener('pause', () => { this.isPlaying = false; this.updatePlayButton(); });
        video.addEventListener('timeupdate', () => this.updateProgress());
        video.addEventListener('ended', () => this.handleMediaEnded());
    }

    closeVideoModal() {
        if (!this.videoModal) return;
        if (this.modalVideoElement) {
            this.modalVideoElement.pause();
            this.modalVideoElement.src = '';
        }
        this.videoModal.remove();
        this.videoModal = null;
        this.modalVideoElement = null;
        this.isVideoModalOpen = false;
        this.pause();
    }

    async getAlbumArt(filePath) {
        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (this.albumArtCache.has(dirPath)) {
            return this.albumArtCache.get(dirPath);
        }

        try {
            const coverImages = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'album.jpg'];
            for (const coverName of coverImages) {
                const coverPath = `${dirPath}/${coverName}`;
                try {
                    const response = await fetch(`/api/files/download?path=${encodeURIComponent(coverPath)}`);
                    if (response.ok) {
                        const imageUrl = URL.createObjectURL(await response.blob());
                        this.albumArtCache.set(dirPath, imageUrl);
                        return imageUrl;
                    }
                } catch (e) {
                    // ignore fetch error
                }
            }
        } catch (error) {
            console.error('Error fetching album art:', error);
        }

        const defaultArt = this.getDefaultAlbumArt();
        this.albumArtCache.set(dirPath, defaultArt);
        return defaultArt;
    }

    getDefaultAlbumArt() {
        return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJDRCBpY29uIj48ZGVmcz48bWFzayBpZD0iaG9sZSI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIGZpbGw9IndoaXRlIi8+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSI4MCIgZmlsbD0iYmxhY2siLz48L21hc2s+PC9kZWZzPjxwYXRoIGQ9Ik0xMTAgMTQwIEMxNzAgOTAsIDMyMCA5MCwgMzkyIDE0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4xMiIgc3Ryb2tlLXdpZHRoPSIyMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSIyMjAiIGZpbGw9IiM2NjYiIG1hc2s9InVybCgjaG9sZSkiLz48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjQwIiBmaWxsPSIjNjY2Ii8+PC9zdmc+';
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    clearPlaylist() {
        this.playlist = [];
        this.originalPlaylist = [];
        this.currentIndex = 0;
        this.currentDirectory = '';
    }

    destroy() {
        this.stop();
        this.albumArtCache.forEach(url => {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        });
        this.albumArtCache.clear();
        if (this.playerElement) this.playerElement.remove();
    }
}