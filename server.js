const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Раздача статики из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище комнат в памяти (Map)
const rooms = new Map();

// Хэширование пароля SHA-256
function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

// Генерация 6-значного кода (буквы и цифры)
function generateCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Генерация уникального ID комнаты
function generateUniqueRoomId() {
  let id = generateCode(6);
  while (rooms.has(id)) {
    id = generateCode(6);
  }
  return id;
}

// Вычисление актуального времени воспроизведения с учётом времени, прошедшего с последнего play
function getEffectiveTime(state) {
  if (!state.isPlaying || !state.lastUpdated) {
    return state.currentTime || 0;
  }
  const elapsedSeconds = (Date.now() - state.lastUpdated) / 1000;
  return Math.max(0, (state.currentTime || 0) + elapsedSeconds);
}

// Формирование списка участников для отправки клиентам
function getRoomUsers(room) {
  return Array.from(room.users.values()).map((u) => ({
    id: u.id,
    username: u.username,
    color: u.color
  }));
}

// Палитра градиентов для аватаров участников
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #f5a623, #f76b1c)',
  'linear-gradient(135deg, #4fc3f7, #0288d1)',
  'linear-gradient(135deg, #ab47bc, #7b1fa2)',
  'linear-gradient(135deg, #66bb6a, #2e7d32)',
  'linear-gradient(135deg, #ec407a, #c2185b)',
  'linear-gradient(135deg, #ffa726, #ef6c00)'
];

io.on('connection', (socket) => {
  let currentRoomId = null;

  // 1. Создание комнаты
  socket.on('create-room', ({ username, password }, callback) => {
    try {
      const cleanName = (username || 'Зритель').trim().slice(0, 24) || 'Зритель';
      const rawPassword = (password && password.trim()) ? password.trim() : generateCode(6);
      const roomId = generateUniqueRoomId();

      const room = {
        id: roomId,
        passwordHash: hashPassword(rawPassword),
        users: new Map(),
        messages: [],
        state: {
          videoType: 'youtube',
          videoId: 'jfKfPfyJRdk',
          embedUrl: 'https://www.youtube.com/embed/jfKfPfyJRdk',
          rawUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          isPlaying: false,
          currentTime: 0,
          lastUpdated: Date.now()
        }
      };

      const userObj = {
        id: socket.id,
        username: cleanName,
        color: AVATAR_GRADIENTS[0]
      };

      room.users.set(socket.id, userObj);
      rooms.set(roomId, room);
      currentRoomId = roomId;
      socket.join(roomId);

      if (typeof callback === 'function') {
        callback({
          ok: true,
          roomId,
          password: rawPassword,
          userId: socket.id,
          state: {
            ...room.state,
            currentTime: getEffectiveTime(room.state)
          },
          users: getRoomUsers(room),
          messages: room.messages
        });
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Не удалось создать комнату' });
      }
    }
  });

  // 2. Вход в комнату
  socket.on('join-room', ({ roomId, password, username }, callback) => {
    try {
      const normalizedId = String(roomId || '').trim().toUpperCase();
      const room = rooms.get(normalizedId);

      if (!room) {
        return callback?.({ ok: false, error: 'Комната с таким ID не найдена' });
      }

      const incomingHash = hashPassword(String(password || '').trim());
      if (incomingHash !== room.passwordHash) {
        return callback?.({ ok: false, error: 'Неверный пароль комнаты' });
      }

      const cleanName = (username || 'Зритель').trim().slice(0, 24) || 'Зритель';
      const colorIndex = room.users.size % AVATAR_GRADIENTS.length;
      const userObj = {
        id: socket.id,
        username: cleanName,
        color: AVATAR_GRADIENTS[colorIndex]
      };

      room.users.set(socket.id, userObj);
      currentRoomId = normalizedId;
      socket.join(normalizedId);

      const usersList = getRoomUsers(room);

      // Отправляем вошедшему участнику текущее состояние комнаты
      callback?.({
        ok: true,
        roomId: normalizedId,
        password: String(password || '').trim(),
        userId: socket.id,
        state: {
          ...room.state,
          currentTime: getEffectiveTime(room.state)
        },
        users: usersList,
        messages: room.messages
      });

      // Оповещаем остальных участников
      socket.to(normalizedId).emit('user-joined', {
        user: userObj,
        users: usersList
      });
    } catch (err) {
      callback?.({ ok: false, error: 'Ошибка при входе в комнату' });
    }
  });

  // 3. Загрузка нового видео
  socket.on('load-video', (payload) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = room.users.get(socket.id);

    room.state = {
      videoType: payload.videoType,
      videoId: payload.videoId || '',
      embedUrl: payload.embedUrl,
      rawUrl: payload.rawUrl,
      isPlaying: false,
      currentTime: 0,
      lastUpdated: Date.now()
    };

    io.to(currentRoomId).emit('load-video', {
      state: room.state,
      initiatedBy: user ? user.username : 'Участник'
    });
  });

  // 4. Синхронизация (play | pause | seek)
  socket.on('sync-action', ({ action, currentTime }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = room.users.get(socket.id);

    const numericTime = typeof currentTime === 'number' && !Number.isNaN(currentTime)
      ? Math.max(0, currentTime)
      : getEffectiveTime(room.state);

    if (action === 'play') {
      room.state.isPlaying = true;
      room.state.currentTime = numericTime;
      room.state.lastUpdated = Date.now();
    } else if (action === 'pause') {
      room.state.isPlaying = false;
      room.state.currentTime = numericTime;
      room.state.lastUpdated = Date.now();
    } else if (action === 'seek') {
      room.state.currentTime = numericTime;
      room.state.lastUpdated = Date.now();
    }

    socket.to(currentRoomId).emit('sync-action', {
      action,
      currentTime: room.state.currentTime,
      isPlaying: room.state.isPlaying,
      initiatedBy: user ? user.username : 'Участник'
    });
  });

  // Запрос точного состояния (ручная ресинхронизация)
  socket.on('request-state', (callback) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    if (typeof callback === 'function') {
      callback({
        ...room.state,
        currentTime: getEffectiveTime(room.state)
      });
    }
  });

  // 5. Сообщения чата
  socket.on('chat-message', ({ text }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = room.users.get(socket.id);
    if (!user) return;

    const cleanText = String(text || '').trim().slice(0, 600);
    if (!cleanText) return;

    const message = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      senderId: socket.id,
      senderName: user.username,
      senderColor: user.color,
      text: cleanText,
      timestamp: new Date().toISOString()
    };

    room.messages.push(message);
    if (room.messages.length > 100) {
      room.messages.shift();
    }

    io.to(currentRoomId).emit('chat-message', message);
  });

  // Отключение участника
  socket.on('disconnect', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const leavingUser = room.users.get(socket.id);

    room.users.delete(socket.id);

    if (room.users.size === 0) {
      // Удаляем пустую комнату через 5 минут (на случай перезагрузки страницы хостом)
      setTimeout(() => {
        const checkRoom = rooms.get(currentRoomId);
        if (checkRoom && checkRoom.users.size === 0) {
          rooms.delete(currentRoomId);
        }
      }, 5 * 60 * 1000);
    } else if (leavingUser) {
      io.to(currentRoomId).emit('user-left', {
        user: leavingUser,
        users: getRoomUsers(room)
      });
    }
  });
});

// Fallback для любых маршрутов на index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Watch Party Server запущен на порту ${PORT}`);
});