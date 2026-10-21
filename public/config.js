// Конфигурация клиента Watch Party
// Относительный адрес (тот же origin) гарантирует работу локально и на Render без CORS-проблем
window.APP_CONFIG = {
  SOCKET_URL: window.location.origin,
  SOCKET_OPTIONS: {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  }
};