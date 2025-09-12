export class MediaPlayer {
    constructor() {
        this.audioElement = null;
        this.videoElement = null;
        this.currentMedia = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.playlist = [];
        this.originalPlaylist = []; // 元の順序を保持
        this.currentIndex = 0;
        this.isMinimized = false;
        this.isVideoModalOpen = false;
        this.videoModal = null;
        this.modalVideoElement = null;
        this.previousVolume = this.volume; // ミュート用の前回の音量

        // 再生モード設定
        this.playbackMode = {
            repeat: 'off', // 'off', 'playlist', 'one'
            shuffle: false
        };

        this.currentDirectory = ''; // 現在のディレクトリを追跡

        // アルバムアートのキャッシュ
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
                    <button class="control-btn shuffle-btn" title="Shuffle">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.624 9.624 0 0 0 7.556 8a9.624 9.624 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.595 10.595 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.624 9.624 0 0 0 6.444 8a9.624 9.624 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5z"/>
                            <path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192zm0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192z"/>
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
                    <button class="control-btn repeat-btn" title="Repeat">
                        <svg class="repeat-off" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192Zm3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>
                        </svg>
                        <svg class="repeat-all" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                            <path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192Zm3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>
                        </svg>
                        <svg class="repeat-one" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                            <path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4h6Zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13H11a5 5 0 0 0 4.48-7.223Z"/>
                            <text x="8" y="11" font-size="6" text-anchor="middle" fill="currentColor">1</text>
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
        // Play/Pause buttons (both main and minimized)
        const playPauseBtns = this.playerElement.querySelectorAll('.play-pause');
        const prevBtn = this.playerElement.querySelector('.prev');
        const nextBtn = this.playerElement.querySelector('.next');
        const repeatBtn = this.playerElement.querySelector('.repeat-btn');
        const shuffleBtn = this.playerElement.querySelector('.shuffle-btn');
        const progressBar = this.playerElement.querySelector('.progress-bar');
        const volumeSlider = this.playerElement.querySelector('.volume-slider');
        const volumeBtn = this.playerElement.querySelector('.volume-btn');
        const minimizeBtns = this.playerElement.querySelectorAll('.minimize-btn');
        const closeBtns = this.playerElement.querySelectorAll('.close-btn');
        
        playPauseBtns.forEach(btn => {
            if (btn) btn.addEventListener('click', () => this.togglePlayPause());
        });
        
        if (prevBtn) prevBtn.addEventListener('click', () => this.playPrevious());
        if (nextBtn) nextBtn.addEventListener('click', () => this.playNext());
        if (repeatBtn) repeatBtn.addEventListener('click', () => this.toggleRepeatMode());
        if (shuffleBtn) shuffleBtn.addEventListener('click', () => this.toggleShuffleMode());
        
        if (progressBar) {
            progressBar.addEventListener('click', (e) => {
                const rect = progressBar.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                this.seekTo(percent);
            });
        }
        
        if (volumeSlider) {
            volumeSlider.addEventListener('click', (e) => {
                const rect = volumeSlider.getBoundingClientRect();
                const volume = (e.clientX - rect.left) / rect.width;
                this.setVolume(volume);
            });
        }
        
        if (volumeBtn) volumeBtn.addEventListener('click', () => this.toggleMute());
        
        minimizeBtns.forEach(btn => {
            if (btn) btn.addEventListener('click', () => this.toggleMinimize());
        });
        
        closeBtns.forEach(btn => {
            if (btn) btn.addEventListener('click', () => {
                this.stop();
                this.hide();
            });
        });
        
        // Audio events
        if (this.audioElement) {
            this.audioElement.addEventListener('timeupdate', () => {
                if (this.currentMedia && this.currentMedia.type === 'audio') {
                    this.updateProgress();
                }
            });
            
            this.audioElement.addEventListener('ended', () => {
                this.handleMediaEnded();
            });
        }
        
        // Video events
        if (this.videoElement) {
            this.videoElement.addEventListener('timeupdate', () => {
                if (this.currentMedia && this.currentMedia.type === 'video' && !this.isVideoModalOpen) {
                    this.updateProgress();
                }
            });
            
            this.videoElement.addEventListener('ended', () => {
                this.handleMediaEnded();
            });
        }
    }

    handleMediaEnded() {
        switch (this.playbackMode.repeat) {
            case 'one':
                // 同じ曲を繰り返し再生
                this.seekTo(0);
                this.play();
                break;
            case 'playlist':
                // プレイリストをループ再生
                this.playNext();
                break;
            case 'off':
            default:
                // 次の曲を再生（最後の曲なら停止）
                if (this.currentIndex < this.playlist.length - 1) {
                    this.playNext();
                } else {
                    this.pause();
                    this.isPlaying = false;
                    this.updatePlayButton();
                }
                break;
        }
    }
    
    toggleRepeatMode() {
        const modes = ['off', 'playlist', 'one'];
        const currentIndex = modes.indexOf(this.playbackMode.repeat);
        this.playbackMode.repeat = modes[(currentIndex + 1) % modes.length];
        this.updateModeUI();
    }
    
    toggleShuffleMode() {
        this.playbackMode.shuffle = !this.playbackMode.shuffle;
        
        if (this.playbackMode.shuffle && this.playlist.length > 0) {
            // シャッフル有効：元の順序を保存してシャッフル
            if (this.originalPlaylist.length === 0) {
                this.originalPlaylist = [...this.playlist];
            }
            this.shufflePlaylist();
        } else if (!this.playbackMode.shuffle && this.originalPlaylist.length > 0) {
            // シャッフル無効：元の順序に戻す
            const currentMediaPath = this.currentMedia?.path;
            this.playlist = [...this.originalPlaylist];
            this.originalPlaylist = [];
            
            // 現在の曲のインデックスを更新
            if (currentMediaPath) {
                this.currentIndex = this.playlist.findIndex(item => item.path === currentMediaPath);
                if (this.currentIndex === -1) this.currentIndex = 0;
            }
        }
        
        this.updateModeUI();
    }
    
    shufflePlaylist() {
        if (this.playlist.length <= 1) return;
        
        const currentMediaPath = this.currentMedia?.path;
        
        // 現在の曲を先頭に保持
        if (currentMediaPath) {
            const currentIndex = this.playlist.findIndex(item => item.path === currentMediaPath);
            if (currentIndex > 0) {
                const [currentItem] = this.playlist.splice(currentIndex, 1);
                this.playlist.unshift(currentItem);
            }
        }
        
        // 残りの曲をシャッフル（Fisher-Yatesアルゴリズム）
        for (let i = this.playlist.length - 1; i > 1; i--) {
            const j = Math.floor(Math.random() * (i - 1)) + 1;
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
        
        this.currentIndex = 0;
    }

    updateModeUI() {
        // リピートモードのUI更新
        const repeatOff = this.playerElement.querySelector('.repeat-off');
        const repeatAll = this.playerElement.querySelector('.repeat-all');
        const repeatOne = this.playerElement.querySelector('.repeat-one');
        const repeatBtn = this.playerElement.querySelector('.repeat-btn');
        
        // シャッフルモードのUI更新
        const shuffleBtn = this.playerElement.querySelector('.shuffle-btn');
        
        // リピートUI要素の更新
        if (repeatOff && repeatAll && repeatOne && repeatBtn) {
            repeatOff.style.display = 'none';
            repeatAll.style.display = 'none';
            repeatOne.style.display = 'none';
            
            // リピートボタンの色と状態表示を更新
            switch (this.playbackMode.repeat) {
                case 'playlist':
                    repeatAll.style.display = 'block';
                    repeatBtn.setAttribute('title', 'Repeat: Playlist');
                    repeatBtn.style.color = '#4A90E2';
                    break;
                case 'one':
                    repeatOne.style.display = 'block';
                    repeatBtn.setAttribute('title', 'Repeat: One');
                    repeatBtn.style.color = '#4A90E2';
                    break;
                case 'off':
                default:
                    repeatOff.style.display = 'block';
                    repeatBtn.setAttribute('title', 'Repeat: Off');
                    repeatBtn.style.color = '';
                    break;
            }
        }
        
        // シャッフルUI要素の更新
        if (shuffleBtn) {
            shuffleBtn.setAttribute('title', 
                this.playbackMode.shuffle ? 'Shuffle: On' : 'Shuffle: Off'
            );
            shuffleBtn.style.color = this.playbackMode.shuffle ? '#4A90E2' : '';
        }
    }
    
    // アルバムアートを取得
    async getAlbumArt(filePath) {
        // キャッシュチェック
        if (this.albumArtCache.has(filePath)) {
            return this.albumArtCache.get(filePath);
        }
        
        try {
            // 1. 同じディレクトリのカバー画像を検索
            const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
            const coverImages = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'album.jpg'];
            
            for (const coverName of coverImages) {
                const coverPath = `${dirPath}/${coverName}`;
                try {
                    const response = await fetch(`/api/files/download?path=${encodeURIComponent(coverPath)}`);
                    if (response.ok) {
                        const blob = await response.blob();
                        const imageUrl = URL.createObjectURL(blob);
                        this.albumArtCache.set(filePath, imageUrl);
                        return imageUrl;
                    }
                } catch (error) {
                    // エラーは無視して次の画像を試す
                    continue;
                }
            }
            
            // 2. デフォルト画像を返す
            const defaultArt = this.getDefaultAlbumArt();
            this.albumArtCache.set(filePath, defaultArt);
            return defaultArt;
            
        } catch (error) {
            console.error('アルバムアート取得エラー:', error);
            const defaultArt = this.getDefaultAlbumArt();
            this.albumArtCache.set(filePath, defaultArt);
            return defaultArt;
        }
    }
    
    // デフォルトアルバムアート
    getDefaultAlbumArt() {
        return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJDRCBpY29uIj4KICA8ZGVmcz4KICAgIDxtYXNrIGlkPSJob2xlIj48cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgZmlsbD0id2hpdGUiLz48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjgwIiBmaWxsPSJibGFjayIvPjwvbWFzaz4KICA8L2RlZnM+CiAgPCEtLSDkuK3mlrDlhbPjgYzkuJzpqIDmjaIhLS0+CiAgPGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSIyMjAiIGZpbGw9IiM2NjYiIG1hc2s9InVybCgjaG9sZSkiLz4KCiAgPCEtLSDkuK3mlrDlhbPjgYQgLS0+CiAgPGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSI0MCIgZmlsbD0iIzY2NiIvPgoKICA8IS0tIOW4uOWPkeWQjOaWsOeUqCAtLT4KICA8cGF0aCBkPSJNMTEwIDE0MCBDMTcwIDkwLCAzMjAgOTAsIDM5MiAxNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLW9wYWNpdHk9IjAuMTIiIHN0cm9rZS13aWR0aD0iMjAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4=';
    }
    
    // ファイル名からメタデータを推測
    updateMediaInfoFromFilename() {
        const fileName = this.currentMedia.path.split('/').pop();
        const folderName = this.getFolderName(this.currentMedia.path);
        
        const titleElement = this.playerElement.querySelector('.media-title');
        const artistElement = this.playerElement.querySelector('.media-artist');
        const albumElement = this.playerElement.querySelector('.media-album');
        const minimizedTitle = this.playerElement.querySelector('.minimized-title');
        
        titleElement.textContent = fileName;
        artistElement.textContent = folderName;
        albumElement.textContent = '';
        minimizedTitle.textContent = `${folderName} - ${fileName}`;
        
        this.updateAlbumArt();
    }
    
    // フォルダ名を取得
    getFolderName(path) {
        const pathParts = path.split('/');
        return pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
    }
    
    // アルバムアートを更新
    async updateAlbumArt() {
        if (!this.currentMedia) return;
        
        try {
            const albumArt = await this.getAlbumArt(this.currentMedia.path);
            const thumbnailElement = this.playerElement.querySelector('.media-thumbnail');
            thumbnailElement.src = albumArt;
            thumbnailElement.style.display = 'block';
        } catch (error) {
            console.error('アルバムアート更新エラー:', error);
            const thumbnailElement = this.playerElement.querySelector('.media-thumbnail');
            thumbnailElement.src = this.getDefaultAlbumArt();
        }
    }

    playAudio(path) {
        this.stop();
        
        const directory = path.split('/').slice(0, -1).join('/');
        
        // ディレクトリが変更された場合はプレイリストを再生成（オーディオのみ）
        if (directory !== this.currentDirectory) {
            this.currentDirectory = directory;
            this.createAutoPlaylist(path, 'audio');
        }
        
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
        
        // 動画ファイルの場合はプレイリストを作成しない
        this.playlist = [];
        this.originalPlaylist = [];
        this.currentIndex = 0;
        this.currentDirectory = '';
        
        this.currentMedia = { type: 'video', path };
        
        this.isPlaying = true;
        
        this.updateMediaInfo(path);
        this.updatePlayButton();
        this.show();
        
        this.showVideoModal();
    }
    
    createAutoPlaylist(currentPath = null, mediaType = 'audio') {
        // 現在のディレクトリのメディアファイルを収集
        const fileItems = document.querySelectorAll('.file-item, .masonry-item');
        const mediaFiles = [];
        
        fileItems.forEach(item => {
            const mimeType = item.dataset.mimeType || '';
            const path = item.dataset.path;
            
            // オーディオファイルのみを含める
            if (mimeType.startsWith('audio/')) {
                mediaFiles.push({
                    path: path,
                    mime_type: mimeType,
                    name: item.querySelector('.file-name, .masonry-name')?.textContent || path.split('/').pop()
                });
            }
        });
        
        this.playlist = mediaFiles;
        this.originalPlaylist = []; // 元のプレイリストをリセット
        
        // シャッフルモードが有効な場合はシャッフル
        if (this.playbackMode.shuffle && this.playlist.length > 0) {
            this.originalPlaylist = [...this.playlist];
            this.shufflePlaylist();
        }
        
        // 現在再生中のファイルのインデックスを設定
        if (currentPath) {
            this.currentIndex = this.playlist.findIndex(file => file.path === currentPath);
            if (this.currentIndex === -1) this.currentIndex = 0;
        } else {
            this.currentIndex = 0;
        }
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
            this.handleMediaEnded();
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
    
    toggleMute() {
        if (this.volume > 0) {
            this.previousVolume = this.volume;
            this.setVolume(0);
        } else {
            this.setVolume(this.previousVolume || 0.7);
        }
    }
    
    playPrevious() {
        if (this.playlist.length === 0) return;
        
        if (this.currentIndex > 0) {
            this.currentIndex--;
        } else if (this.playbackMode.repeat === 'playlist') {
            // ループモードの場合、最後の曲に移動
            this.currentIndex = this.playlist.length - 1;
        } else {
            // 最初の曲で停止
            return;
        }
        
        this.playMediaFromPlaylist();
    }
   
    playNext() {
        if (this.playlist.length === 0) return;
        
        if (this.currentIndex < this.playlist.length - 1) {
            this.currentIndex++;
        } else if (this.playbackMode.repeat === 'playlist') {
            // ループモードの場合、最初の曲に移動
            this.currentIndex = 0;
        } else {
            // 最後の曲で停止
            return;
        }
        
        this.playMediaFromPlaylist();
    }
   
    playMediaFromPlaylist() {
        if (this.playlist.length === 0 || this.currentIndex >= this.playlist.length) return;
        
        const media = this.playlist[this.currentIndex];
        
        if (media.mime_type.startsWith('audio/')) {
            this.playAudio(media.path);
        }
    }
   
    setPlaylist(files) {
        this.playlist = files.filter(file => 
            file.mime_type && file.mime_type.startsWith('audio/')
        );
        
        this.currentIndex = 0;
    }
    
    updateMediaInfo(path) {
        // 基本情報の設定
        this.currentMedia = { ...this.currentMedia, path };
        this.updateMediaInfoFromFilename();
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
    
    // キャッシュクリア（メモリ管理）
    clearCache() {
        // アルバムアートのURLオブジェクトを解放
        this.albumArtCache.forEach(url => {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });
        
        this.albumArtCache.clear();
    }
    
    // プレイヤー破棄
    destroy() {
        this.stop();
        this.clearCache();
        
        if (this.playerElement) {
            this.playerElement.remove();
        }
    }
    
    // 自動再生を有効/無効にするメソッド
    setAutoPlay(enabled) {
        this.autoPlayNext = enabled;
    }
    
    // 現在のプレイリストをクリアするメソッド
    clearPlaylist() {
        this.playlist = [];
        this.originalPlaylist = [];
        this.currentIndex = 0;
        this.currentDirectory = '';
    }
}

