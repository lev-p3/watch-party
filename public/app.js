/* ==========================================================================
   WATCH PARTY — КЛИЕНТСКАЯ ЛОГИКА (Чистый JS + Socket.IO + Мультиплеер)
   ========================================================================== */

(function () {
  'use strict';

  // Подключение к серверу Socket.IO на том же origin
  const socket = io(window.APP_CONFIG.SOCKET_URL, window.APP_CONFIG.SOCKET_OPTIONS);

  // Глобальное состояние клиента
  const appState = {
    roomId: null,
    password: '',
    userId: null,
    username: '',
    videoType: 'youtube', // 'youtube' | 'vk' | 'rutube' | 'direct'
    videoId: '',
    embedUrl: '',
    rawUrl: '',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    suppressEmit: false,
    ytPlayer: null,
    ytReady: false,
    pendingYtLoad: null,
    mobileTab: 'chat'
  };

  // DOM-элементы
  const dom = {
    authScreen: document.getElementById('auth-screen'),
    roomScreen: document.getElementById('room-screen'),
    authTabsContainer: document.querySelector('.auth-tabs'),
    tabCreate: document.getElementById('tab-create'),
    tabJoin: document.getElementById('tab-join'),
    formCreate: document.getElementById('form-create'),
    formJoin: document.getElementById('form-join'),
    createUsername: document.getElementById('create-username'),
    createPassword: document.getElementById('create-password'),
    btnGeneratePass: document.getElementById('btn-generate-pass'),
    joinUsername: document.getElementById('join-username'),
    joinRoomId: document.getElementById('join-room-id'),
    joinPassword: document.getElementById('join-password'),

    // Элементы комнаты
    videoUrlForm: document.getElementById('video-url-form'),
    videoUrlInput: document.getElementById('video-url-input'),
    mobVideoUrlForm: document.getElementById('mob-video-url-form'),
    mobVideoUrlInput: document.getElementById('mob-video-url-input'),

    sourceBadge: document.getElementById('source-badge'),
    sourceLimitationBadge: document.getElementById('source-limitation-badge'),
    sourceLimitationText: document.getElementById('source-limitation-text'),
    mobSourceName: document.getElementById('mob-source-name'),
    mobSourceWarning: document.getElementById('mob-source-warning'),

    displayRoomId: document.getElementById('display-room-id'),
    displayRoomPass: document.getElementById('display-room-pass'),
    mobDisplayRoomId: document.getElementById('mob-display-room-id'),
    mobDisplayRoomPass: document.getElementById('mob-display-room-pass'),

    btnCopyInvite: document.getElementById('btn-copy-invite'),
    btnCopyRoomQuick: document.getElementById('btn-copy-room-quick'),
    mobBtnCopyInvite: document.getElementById('mob-btn-copy-invite'),

    // Плееры
    playerStage: document.getElementById('player-stage'),
    ytMount: document.getElementById('youtube-player-mount'),
    embedIframe: document.getElementById('embed-iframe-player'),
    html5Video: document.getElementById('html5-video-player'),

    // Пульт управления
    btnPlayPause: document.getElementById('btn-play-pause'),
    iconPlay: document.getElementById('icon-play'),
    iconPause: document.getElementById('icon-pause'),
    progressWrapper: document.getElementById('progress-wrapper'),
    progressFill: document.getElementById('progress-fill'),
    progressThumb: document.getElementById('progress-thumb'),
    timeCurrent: document.getElementById('time-current'),
    timeDuration: document.getElementById('time-duration'),
    btnResync: document.getElementById('btn-resync'),
    btnFullscreen: document.getElementById('btn-fullscreen'),

    // Чат и участники
    usersCount: document.getElementById('users-count'),
    mobUsersCount: document.getElementById('mob-users-count'),
    participantsAvatars: document.getElementById('participants-avatars'),
    mobParticipantsList: document.getElementById('mob-participants-list'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),

    // Мобильные вкладки
    mobSegmented: document.querySelector('.mobile-segmented-control'),
    mobTabChat: document.getElementById('mob-tab-chat'),
    mobTabRoom: document.getElementById('mob-tab-room'),
    mobRoomPanel: document.getElementById('mobile-room-panel'),
    mobUnreadBadge: document.getElementById('mob-unread-badge'),

    toastContainer: document.getElementById('toast-container')
  };

  /* ========================================================================
     1. УТИЛИТЫ И ТОСТ-УВЕДОМЛЕНИЯ
     ======================================================================== */
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.innerHTML = `
      <span class="toast-icon">
        ${isError
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'}
      </span>
      <span>${escapeHtml(message)}</span>
    `;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function generateRandomPassword(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function withSuppressedEmit(fn) {
    appState.suppressEmit = true;
    try {
      fn();
    } finally {
      setTimeout(() => {
        appState.suppressEmit = false;
      }, 350);
    }
  }

  /* ========================================================================
     2. ПАРСЕР ССЫЛОК НА ВИДЕО (YouTube, VK Video, Rutube, Direct MP4/WebM)
     ======================================================================== */
  function parseVideoUrl(rawInput) {
    const urlStr = String(rawInput || '').trim();
    if (!urlStr) return null;

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    // 1. YouTube
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      let videoId = '';
      if (host === 'youtu.be') {
        videoId = parsed.pathname.slice(1).split('/')[0];
      } else if (parsed.pathname.startsWith('/watch')) {
        videoId = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      }
      if (videoId && /^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
        return {
          videoType: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          rawUrl: urlStr
        };
      }
    }

    // 2. VK Video (vk.com / vkvideo.ru)
    if (host.includes('vk.com') || host.includes('vkvideo.ru')) {
      if (parsed.pathname.includes('video_ext.php')) {
        parsed.searchParams.set('js_api', '1');
        return {
          videoType: 'vk',
          videoId: '',
          embedUrl: parsed.toString(),
          rawUrl: urlStr
        };
      }
      const match = urlStr.match(/video(-?\d+)_(\d+)/);
      if (match) {
        const oid = match[1];
        const id = match[2];
        return {
          videoType: 'vk',
          videoId: `${oid}_${id}`,
          embedUrl: `https://vk.com/video_ext.php?oid=${oid}&id=${id}&hd=2&js_api=1`,
          rawUrl: urlStr
        };
      }
    }

    // 3. Rutube
    if (host.includes('rutube.ru')) {
      const match = parsed.pathname.match(/\/(?:video|play\/embed)\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        const id = match[1];
        return {
          videoType: 'rutube',
          videoId: id,
          embedUrl: `https://rutube.ru/play/embed/${id}`,
          rawUrl: urlStr
        };
      }
    }

    // 4. Прямые видеофайлы (MP4 / WebM / Ogg)
    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(parsed.pathname)) {
      return {
        videoType: 'direct',
        videoId: '',
        embedUrl: urlStr,
        rawUrl: urlStr
      };
    }

    return null;
  }

  /* ========================================================================
     3. ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ ВИДЕОПЛЕЕРАМИ
     ======================================================================== */
  // Загрузка YouTube IFrame API
  function initYouTubeApi() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  window.onYouTubeIframeAPIReady = function () {
    appState.ytPlayer = new window.YT.Player('youtube-player-mount', {
      width: '100%',
      height: '100%',
      videoId: 'jfKfPfyJRdk',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        controls: 1
      },
      events: {
        onReady: () => {
          appState.ytReady = true;
          if (appState.pendingYtLoad) {
            applyVideoState(appState.pendingYtLoad);
            appState.pendingYtLoad = null;
          }
        },
        onStateChange: (event) => {
          if (appState.videoType !== 'youtube' || appState.suppressEmit) return;
          const YTState = window.YT.PlayerState;
          const currentTime = appState.ytPlayer.getCurrentTime() || 0;

          if (event.data === YTState.PLAYING && !appState.isPlaying) {
            appState.isPlaying = true;
            updatePlayPauseIcons(true);
            socket.emit('sync-action', { action: 'play', currentTime });
          } else if (event.data === YTState.PAUSED && appState.isPlaying) {
            appState.isPlaying = false;
            updatePlayPauseIcons(false);
            socket.emit('sync-action', { action: 'pause', currentTime });
          }
        }
      }
    });
  };

  // События прямого HTML5 видеоплеера
  function bindHtml5Events() {
    const video = dom.html5Video;

    video.addEventListener('play', () => {
      if (appState.videoType !== 'direct' || appState.suppressEmit) return;
      appState.isPlaying = true;
      updatePlayPauseIcons(true);
      socket.emit('sync-action', { action: 'play', currentTime: video.currentTime });
    });

    video.addEventListener('pause', () => {
      if (appState.videoType !== 'direct' || appState.suppressEmit) return;
      appState.isPlaying = false;
      updatePlayPauseIcons(false);
      socket.emit('sync-action', { action: 'pause', currentTime: video.currentTime });
    });

    video.addEventListener('seeked', () => {
      if (appState.videoType !== 'direct' || appState.suppressEmit) return;
      socket.emit('sync-action', { action: 'seek', currentTime: video.currentTime });
    });

    video.addEventListener('loadedmetadata', () => {
      appState.duration = video.duration || 0;
      updateTimelineUI(video.currentTime, appState.duration);
    });
  }

  // Переключение и загрузка источника видео
  function applyVideoState(state) {
    appState.videoType = state.videoType;
    appState.videoId = state.videoId || '';
    appState.embedUrl = state.embedUrl;
    appState.rawUrl = state.rawUrl || state.embedUrl;
    appState.isPlaying = Boolean(state.isPlaying);
    appState.currentTime = Number(state.currentTime) || 0;

    updateSourceBadges(state.videoType);
    updatePlayPauseIcons(appState.isPlaying);

    // Останавливаем и скрываем неактивные плееры
    const ytIframeEl = document.getElementById('youtube-player-mount');
    ytIframeEl.classList.add('hidden');
    dom.embedIframe.classList.add('hidden');
    dom.html5Video.classList.add('hidden');

    withSuppressedEmit(() => {
      dom.html5Video.pause();
      if (appState.ytReady && appState.ytPlayer?.pauseVideo) {
        appState.ytPlayer.pauseVideo();
      }
    });

    if (state.videoType === 'youtube') {
      ytIframeEl.classList.remove('hidden');
      if (!appState.ytReady) {
        appState.pendingYtLoad = state;
        return;
      }
      withSuppressedEmit(() => {
        appState.ytPlayer.loadVideoById({
          videoId: state.videoId,
          startSeconds: appState.currentTime
        });
        if (!appState.isPlaying) {
          setTimeout(() => appState.ytPlayer.pauseVideo(), 400);
        }
      });
    } else if (state.videoType === 'direct') {
      dom.html5Video.classList.remove('hidden');
      withSuppressedEmit(() => {
        dom.html5Video.src = state.embedUrl;
        dom.html5Video.currentTime = appState.currentTime;
        if (appState.isPlaying) {
          dom.html5Video.play().catch(() => {});
        }
      });
    } else if (state.videoType === 'vk' || state.videoType === 'rutube') {
      dom.embedIframe.classList.remove('hidden');
      if (dom.embedIframe.src !== state.embedUrl) {
        dom.embedIframe.src = state.embedUrl;
      }
    }
  }

  // Применение команды синхронизации от другого участника
  function applyRemoteSync({ action, currentTime, isPlaying }) {
    appState.isPlaying = Boolean(isPlaying);
    appState.currentTime = Number(currentTime) || 0;
    updatePlayPauseIcons(appState.isPlaying);

    withSuppressedEmit(() => {
      if (appState.videoType === 'youtube' && appState.ytReady) {
        const diff = Math.abs((appState.ytPlayer.getCurrentTime() || 0) - appState.currentTime);
        if (action === 'seek' || diff > 2) {
          appState.ytPlayer.seekTo(appState.currentTime, true);
        }
        if (action === 'play') appState.ytPlayer.playVideo();
        if (action === 'pause') appState.ytPlayer.pauseVideo();
      } else if (appState.videoType === 'direct') {
        const diff = Math.abs(dom.html5Video.currentTime - appState.currentTime);
        if (action === 'seek' || diff > 1.5) {
          dom.html5Video.currentTime = appState.currentTime;
        }
        if (action === 'play') dom.html5Video.play().catch(() => {});
        if (action === 'pause') dom.html5Video.pause();
      } else if (appState.videoType === 'vk') {
        sendVkCommand(action);
      } else if (appState.videoType === 'rutube') {
        sendRutubeCommand(action, appState.currentTime);
      }
    });
  }

  // Отправка postMessage в плеер VK Video
  function sendVkCommand(action) {
    const win = dom.embedIframe.contentWindow;
    if (!win) return;
    if (action === 'play' || action === 'pause') {
      win.postMessage(JSON.stringify({ method: action }), '*');
    }
  }

  // Отправка postMessage в плеер Rutube
  function sendRutubeCommand(action, time) {
    const win = dom.embedIframe.contentWindow;
    if (!win) return;
    if (action === 'play') {
      win.postMessage(JSON.stringify({ type: 'player:play', data: {} }), '*');
    } else if (action === 'pause') {
      win.postMessage(JSON.stringify({ type: 'player:pause', data: {} }), '*');
    } else if (action === 'seek' && Number.isFinite(time)) {
      win.postMessage(JSON.stringify({ type: 'player:setCurrentTime', data: { time } }), '*');
    }
  }

  // Обновление бейджей источника и ограничений
  function updateSourceBadges(videoType) {
    const names = {
      youtube: 'YouTube',
      vk: 'VK Video',
      rutube: 'Rutube',
      direct: 'MP4 / WebM'
    };
    const label = names[videoType] || 'Видео';
    dom.sourceBadge.textContent = label;
    dom.mobSourceName.textContent = label;

    if (videoType === 'vk' || videoType === 'rutube') {
      const note = videoType === 'vk'
        ? 'Перемотка недоступна'
        : 'Синхронизация ограничена';
      dom.sourceLimitationText.textContent = note;
      dom.sourceLimitationBadge.classList.remove('hidden');
      dom.mobSourceWarning.textContent = note;
      dom.mobSourceWarning.classList.remove('hidden');
      dom.progressWrapper.classList.add('disabled');
    } else {
      dom.sourceLimitationBadge.classList.add('hidden');
      dom.mobSourceWarning.classList.add('hidden');
      dom.progressWrapper.classList.remove('disabled');
    }
  }

  /* ========================================================================
     4. КАСТОМНАЯ ПАНЕЛЬ УПРАВЛЕНИЯ ВИДЕО
     ======================================================================== */
  function updatePlayPauseIcons(isPlaying) {
    dom.iconPlay.classList.toggle('hidden', isPlaying);
    dom.iconPause.classList.toggle('hidden', !isPlaying);
  }

  function updateTimelineUI(current, duration) {
    const safeDur = duration > 0 ? duration : 0;
    const pct = safeDur > 0 ? Math.min(100, Math.max(0, (current / safeDur) * 100)) : 0;
    dom.progressFill.style.width = `${pct}%`;
    dom.progressThumb.style.left = `${pct}%`;
    dom.progressWrapper.setAttribute('aria-valuenow', String(Math.round(pct)));
    dom.timeCurrent.textContent = formatTime(current);
    dom.timeDuration.textContent = formatTime(safeDur);
  }

  // Периодическое обновление прогресс-бара
  setInterval(() => {
    if (appState.videoType === 'youtube' && appState.ytReady && appState.ytPlayer?.getCurrentTime) {
      const cur = appState.ytPlayer.getCurrentTime() || 0;
      const dur = appState.ytPlayer.getDuration() || 0;
      appState.currentTime = cur;
      appState.duration = dur;
      updateTimelineUI(cur, dur);
    } else if (appState.videoType === 'direct') {
      const cur = dom.html5Video.currentTime || 0;
      const dur = dom.html5Video.duration || 0;
      appState.currentTime = cur;
      appState.duration = dur;
      updateTimelineUI(cur, dur);
    } else {
      updateTimelineUI(0, 0);
    }
  }, 250);

  // Клик по круглой кнопке Play/Pause
  dom.btnPlayPause.addEventListener('click', () => {
    const nextAction = appState.isPlaying ? 'pause' : 'play';
    appState.isPlaying = !appState.isPlaying;
    updatePlayPauseIcons(appState.isPlaying);

    let currentTime = appState.currentTime;
    withSuppressedEmit(() => {
      if (appState.videoType === 'youtube' && appState.ytReady) {
        currentTime = appState.ytPlayer.getCurrentTime() || 0;
        if (nextAction === 'play') appState.ytPlayer.playVideo();
        else appState.ytPlayer.pauseVideo();
      } else if (appState.videoType === 'direct') {
        currentTime = dom.html5Video.currentTime || 0;
        if (nextAction === 'play') dom.html5Video.play().catch(() => {});
        else dom.html5Video.pause();
      } else if (appState.videoType === 'vk') {
        sendVkCommand(nextAction);
      } else if (appState.videoType === 'rutube') {
        sendRutubeCommand(nextAction);
      }
    });

    socket.emit('sync-action', { action: nextAction, currentTime });
  });

  // Перемотка кликом по прогресс-бару
  dom.progressWrapper.addEventListener('click', (e) => {
    if (appState.videoType === 'vk' || appState.videoType === 'rutube') {
      showToast('Для данного источника перемотка через панель ограничена', true);
      return;
    }
    if (!appState.duration || appState.duration <= 0) return;

    const rect = dom.progressWrapper.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * appState.duration;

    withSuppressedEmit(() => {
      if (appState.videoType === 'youtube' && appState.ytReady) {
        appState.ytPlayer.seekTo(targetTime, true);
      } else if (appState.videoType === 'direct') {
        dom.html5Video.currentTime = targetTime;
      }
    });

    updateTimelineUI(targetTime, appState.duration);
    socket.emit('sync-action', { action: 'seek', currentTime: targetTime });
  });

  // Кнопка ручной синхронизации
  dom.btnResync.addEventListener('click', () => {
    socket.emit('request-state', (serverState) => {
      if (!serverState) return;
      applyRemoteSync({
        action: serverState.isPlaying ? 'play' : 'pause',
        currentTime: serverState.currentTime,
        isPlaying: serverState.isPlaying
      });
      showToast('Плеер синхронизирован с комнатой');
    });
  });

  // Полноэкранный режим
  dom.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      dom.playerStage.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  /* ========================================================================
     5. ЧАТ И СПИСОК УЧАСТНИКОВ
     ======================================================================== */
  function renderUsers(users) {
    dom.usersCount.textContent = String(users.length);
    dom.mobUsersCount.textContent = String(users.length);

    dom.participantsAvatars.innerHTML = '';
    dom.mobParticipantsList.innerHTML = '';

    users.forEach((u) => {
      const initial = (u.username || '?').charAt(0).toUpperCase();

      // Аватар в шапке чата
      const avatar = document.createElement('div');
      avatar.className = 'avatar-circle';
      avatar.style.background = u.color;
      avatar.setAttribute('data-tooltip', u.username);
      avatar.setAttribute('aria-label', u.username);
      avatar.textContent = initial;
      dom.participantsAvatars.appendChild(avatar);

      // Чип участника в мобильной вкладке «Комната»
      const chip = document.createElement('div');
      chip.className = 'mob-user-chip';
      chip.innerHTML = `
        <span class="msg-avatar" style="width:22px;height:22px;font-size:0.7rem;background:${u.color}">${escapeHtml(initial)}</span>
        <span>${escapeHtml(u.username)}</span>
      `;
      dom.mobParticipantsList.appendChild(chip);
    });
  }

  function appendChatMessage(msg) {
    const isOwn = msg.senderId === appState.userId;
    const initial = (msg.senderName || '?').charAt(0).toUpperCase();
    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const row = document.createElement('div');
    row.className = `msg-row ${isOwn ? 'own' : ''}`;
    row.innerHTML = `
      <div class="msg-avatar" style="background: ${msg.senderColor || 'linear-gradient(135deg,#f5a623,#f76b1c)'}">
        ${escapeHtml(initial)}
      </div>
      <div class="msg-bubble">
        <div class="msg-meta">
          <span class="msg-sender">${escapeHtml(msg.senderName)}</span>
          <span class="msg-time">${timeStr}</span>
        </div>
        <div class="msg-text">${escapeHtml(msg.text)}</div>
      </div>
    `;

    dom.chatMessages.appendChild(row);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    // Индикатор непрочитанного сообщения, если открыта вкладка «Комната» на телефоне
    if (appState.mobileTab === 'room' && !isOwn) {
      dom.mobUnreadBadge.classList.remove('hidden');
    }
  }

  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    if (!text) return;
    socket.emit('chat-message', { text });
    dom.chatInput.value = '';
  });

  /* ========================================================================
     6. СОЗДАНИЕ / ВХОД В КОМНАТУ И ОБРАБОТКА СОБЫТИЙ SOCKET.IO
     ======================================================================== */
  function enterRoomSuccess(response) {
    appState.roomId = response.roomId;
    appState.password = response.password;
    appState.userId = response.userId;

    dom.displayRoomId.textContent = response.roomId;
    dom.displayRoomPass.textContent = response.password;
    dom.mobDisplayRoomId.textContent = response.roomId;
    dom.mobDisplayRoomPass.textContent = response.password;

    // Обновляем URL без перезагрузки для удобного шаринга
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(response.roomId)}`;
    window.history.replaceState({}, '', newUrl);

    dom.authScreen.classList.add('hidden');
    dom.roomScreen.classList.remove('hidden');

    renderUsers(response.users || []);
    (response.messages || []).forEach(appendChatMessage);
    applyVideoState(response.state);
  }

  // Переключение вкладок на экране входа
  function switchAuthTab(tabName) {
    const isCreate = tabName === 'create';
    dom.authTabsContainer.setAttribute('data-active', tabName);
    dom.tabCreate.classList.toggle('active', isCreate);
    dom.tabJoin.classList.toggle('active', !isCreate);
    dom.tabCreate.setAttribute('aria-selected', String(isCreate));
    dom.tabJoin.setAttribute('aria-selected', String(!isCreate));
    dom.formCreate.classList.toggle('hidden', !isCreate);
    dom.formJoin.classList.toggle('hidden', isCreate);
  }

  dom.tabCreate.addEventListener('click', () => switchAuthTab('create'));
  dom.tabJoin.addEventListener('click', () => switchAuthTab('join'));

  // Кнопка генерации пароля
  dom.btnGeneratePass.addEventListener('click', () => {
    dom.createPassword.value = generateRandomPassword(6);
    showToast('Сгенерирован надёжный пароль');
  });

  // Отправка формы «Создать комнату»
  dom.formCreate.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = dom.createUsername.value.trim();
    const password = dom.createPassword.value.trim();
    if (!username || !password) return;

    socket.emit('create-room', { username, password }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Ошибка создания комнаты', true);
        return;
      }
      enterRoomSuccess(res);
      showToast(`Комната ${res.roomId} создана!`);
    });
  });

  // Отправка формы «Войти в комнату»
  dom.formJoin.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = dom.joinUsername.value.trim();
    const roomId = dom.joinRoomId.value.trim().toUpperCase();
    const password = dom.joinPassword.value.trim();
    if (!username || !roomId || !password) return;

    socket.emit('join-room', { username, roomId, password }, (res) => {
      if (!res || !res.ok) {
        showToast(res?.error || 'Не удалось войти в комнату', true);
        return;
      }
      enterRoomSuccess(res);
      showToast(`Вы вошли в комнату ${res.roomId}`);
    });
  });

  // Загрузка видео по ссылке (десктоп и мобильная форма)
  function handleVideoUrlSubmit(inputEl, e) {
    e.preventDefault();
    const raw = inputEl.value.trim();
    const parsed = parseVideoUrl(raw);

    if (!parsed) {
      showToast('Не удалось распознать ссылку. Поддерживаются YouTube, VK Video, Rutube и прямые .mp4/.webm', true);
      return;
    }

    socket.emit('load-video', parsed);
    inputEl.value = '';
  }

  dom.videoUrlForm.addEventListener('submit', (e) => handleVideoUrlSubmit(dom.videoUrlInput, e));
  dom.mobVideoUrlForm.addEventListener('submit', (e) => handleVideoUrlSubmit(dom.mobVideoUrlInput, e));

  // Копирование приглашения в буфер обмена
  function copyRoomInvite() {
    if (!appState.roomId) return;
    const link = `${window.location.origin}/?room=${appState.roomId}`;
    const text = `Присоединяйся к просмотру в Watch Party!\nСсылка: ${link}\nID комнаты: ${appState.roomId}\nПароль: ${appState.password}`;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Приглашение и пароль скопированы!');
    }).catch(() => {
      showToast(`ID: ${appState.roomId}, Пароль: ${appState.password}`);
    });
  }

  dom.btnCopyInvite.addEventListener('click', copyRoomInvite);
  dom.btnCopyRoomQuick.addEventListener('click', copyRoomInvite);
  dom.mobBtnCopyInvite.addEventListener('click', copyRoomInvite);

  // Переключение мобильных вкладок «Чат» / «Комната»
  function switchMobileTab(tab) {
    appState.mobileTab = tab;
    const isChat = tab === 'chat';
    dom.mobSegmented.setAttribute('data-mob-active', tab);
    dom.roomScreen.setAttribute('data-mobile-view', tab);
    dom.mobTabChat.classList.toggle('active', isChat);
    dom.mobTabRoom.classList.toggle('active', !isChat);
    dom.mobRoomPanel.classList.toggle('hidden', isChat);
    if (isChat) {
      dom.mobUnreadBadge.classList.add('hidden');
    }
  }

  dom.mobTabChat.addEventListener('click', () => switchMobileTab('chat'));
  dom.mobTabRoom.addEventListener('click', () => switchMobileTab('room'));

  // Входящие события Socket.IO
  socket.on('user-joined', ({ user, users }) => {
    renderUsers(users);
    showToast(`${user.username} присоединился к комнате`);
  });

  socket.on('user-left', ({ user, users }) => {
    renderUsers(users);
    showToast(`${user.username} покинул комнату`);
  });

  socket.on('load-video', ({ state, initiatedBy }) => {
    applyVideoState(state);
    showToast(`${initiatedBy} загрузил новое видео`);
  });

  socket.on('sync-action', (payload) => {
    applyRemoteSync(payload);
  });

  socket.on('chat-message', (message) => {
    appendChatMessage(message);
  });

  // Автозаполнение ID комнаты из URL (?room=ABCDEF) и стартового пароля
  function initApp() {
    dom.createPassword.value = generateRandomPassword(6);
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      switchAuthTab('join');
      dom.joinRoomId.value = roomParam.slice(0, 6).toUpperCase();
    }
    initYouTubeApi();
    bindHtml5Events();
  }

  initApp();
})();