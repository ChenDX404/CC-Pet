// WebSocket client for the VS Code extension -> Tauri desktop bridge.
(function () {
  'use strict';

  var configuredPort = Number(window.__CC_PET_IPC_PORT);
  var hasConfiguredPort = Number.isInteger(configuredPort) && configuredPort >= 19420 && configuredPort <= 19429;
  var ports = hasConfiguredPort
    ? [configuredPort]
    : [19420, 19421, 19422, 19423, 19424, 19425, 19426, 19427, 19428, 19429];
  var portIndex = 0;
  var ws = null;
  var reconnectTimer = null;
  var replyTimer = null;
  var replyFadeTimer = null;
  var replyWindowExtraWidth = 0;
  var replyResizeRunning = false;
  var metricsResizeRunning = false;
  var pendingMetrics = null;
  var BUBBLE_WINDOW_GAP = 10;
  var MIN_REPLY_HEIGHT = 228;
  var currentMetrics = {
    scale: 1,
    petWidth: 192,
    petHeight: 208,
    windowWidth: 210,
    windowHeight: 228
  };

  window.__petIPCStatus = { connected: false, port: null };

  function normalizeMetrics(raw) {
    if (!raw || typeof raw !== 'object') return currentMetrics;
    return {
      scale: Number(raw.scale) || 1,
      petWidth: Math.max(1, Math.round(Number(raw.petWidth) || 192)),
      petHeight: Math.max(1, Math.round(Number(raw.petHeight) || 208)),
      windowWidth: Math.max(1, Math.round(Number(raw.windowWidth) || 210)),
      windowHeight: Math.max(1, Math.round(Number(raw.windowHeight) || 228))
    };
  }

  function placement(metrics, extraWidth) {
    var expanded = extraWidth > 0;
    var windowHeight = expanded
      ? Math.max(metrics.windowHeight, MIN_REPLY_HEIGHT)
      : metrics.windowHeight;
    var bottomPadding = (metrics.windowHeight - metrics.petHeight) / 2;
    return {
      windowWidth: metrics.windowWidth + extraWidth,
      windowHeight: windowHeight,
      petLeft: (metrics.windowWidth - metrics.petWidth) / 2 + extraWidth,
      petTop: windowHeight - metrics.petHeight - bottomPadding
    };
  }

  function resizeForMetrics(rawMetrics) {
    pendingMetrics = normalizeMetrics(rawMetrics);
    if (metricsResizeRunning) return;
    processMetricsResize();
  }

  function processMetricsResize() {
    if (!pendingMetrics) return;
    var targetMetrics = pendingMetrics;
    pendingMetrics = null;
    metricsResizeRunning = true;
    var oldPlacement = placement(currentMetrics, replyWindowExtraWidth);
    var targetPlacement = placement(targetMetrics, replyWindowExtraWidth);
    var pet = document.getElementById('pet');
    if (pet) { pet.style.visibility = 'hidden'; }

    try {
      var tauriWindow = window.__TAURI__ && window.__TAURI__.window;
      if (!tauriWindow || !tauriWindow.getCurrentWindow ||
          !tauriWindow.LogicalPosition || !tauriWindow.LogicalSize) {
        throw new Error('Tauri window sizing API is unavailable');
      }
      var appWindow = tauriWindow.getCurrentWindow();
      Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
        .then(function (values) {
          var scaleFactor = values[1] || 1;
          var currentX = values[0].x / scaleFactor;
          var currentY = values[0].y / scaleFactor;
          var anchorX = currentX + oldPlacement.petLeft + currentMetrics.petWidth / 2;
          var anchorBottom = currentY + oldPlacement.petTop + currentMetrics.petHeight;
          var nextX = anchorX - targetPlacement.petLeft - targetMetrics.petWidth / 2;
          var nextY = anchorBottom - targetPlacement.petTop - targetMetrics.petHeight;
          return Promise.all([
            appWindow.setPosition(new tauriWindow.LogicalPosition(Math.round(nextX), Math.round(nextY))),
            appWindow.setSize(new tauriWindow.LogicalSize(
              targetPlacement.windowWidth,
              targetPlacement.windowHeight
            ))
          ]);
        })
        .then(function () {
          currentMetrics = targetMetrics;
          if (pet) {
            pet.style.left = targetPlacement.petLeft + 'px';
            pet.style.top = targetPlacement.petTop + 'px';
          }
          metricsResizeRunning = false;
          if (pendingMetrics) {
            processMetricsResize();
          } else if (pet) {
            pet.style.visibility = '';
          }
        })
        .catch(function (error) {
          console.error('[CC Pet] Failed to resize pet window:', error);
          metricsResizeRunning = false;
          pendingMetrics = null;
          if (pet) { pet.style.visibility = ''; }
        });
    } catch (error) {
      console.error('[CC Pet] Failed to prepare pet window resize:', error);
      metricsResizeRunning = false;
      pendingMetrics = null;
      if (pet) { pet.style.visibility = ''; }
    }
  }

  window.__petResizeForMetrics = resizeForMetrics;

  function resizeReplyWindow(extraWidth, callback) {
    extraWidth = Math.max(0, Math.round(Number(extraWidth) || 0));
    if (replyWindowExtraWidth === extraWidth) { callback(); return; }
    if (metricsResizeRunning || replyResizeRunning) {
      setTimeout(function () { resizeReplyWindow(extraWidth, callback); }, 16);
      return;
    }
    try {
      var tauriWindow = window.__TAURI__ && window.__TAURI__.window;
      if (!tauriWindow || !tauriWindow.getCurrentWindow ||
          !tauriWindow.LogicalPosition || !tauriWindow.LogicalSize) {
        callback();
        return;
      }
      var appWindow = tauriWindow.getCurrentWindow();
      var pet = document.getElementById('pet');
      replyResizeRunning = true;
      var oldPlacement = placement(currentMetrics, replyWindowExtraWidth);
      var targetPlacement = placement(currentMetrics, extraWidth);
      if (pet) { pet.style.visibility = 'hidden'; }
      Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
        .then(function (values) {
          var scaleFactor = values[1] || 1;
          var currentX = values[0].x / scaleFactor;
          var currentY = values[0].y / scaleFactor;
          var anchorX = currentX + oldPlacement.petLeft + currentMetrics.petWidth / 2;
          var anchorBottom = currentY + oldPlacement.petTop + currentMetrics.petHeight;
          var nextX = anchorX - targetPlacement.petLeft - currentMetrics.petWidth / 2;
          var nextY = anchorBottom - targetPlacement.petTop - currentMetrics.petHeight;
          return Promise.all([
            appWindow.setPosition(new tauriWindow.LogicalPosition(Math.round(nextX), Math.round(nextY))),
            appWindow.setSize(new tauriWindow.LogicalSize(
              targetPlacement.windowWidth,
              targetPlacement.windowHeight
            ))
          ]);
        })
        .then(function () {
          replyWindowExtraWidth = extraWidth;
          replyResizeRunning = false;
          if (pet) {
            pet.style.left = targetPlacement.petLeft + 'px';
            pet.style.top = targetPlacement.petTop + 'px';
            pet.style.visibility = '';
          }
          callback();
        })
        .catch(function (error) {
          console.error('[CC Pet] Failed to resize reply window:', error);
          replyResizeRunning = false;
          if (pet) { pet.style.visibility = ''; }
          callback();
        });
    } catch (error) {
      console.error('[CC Pet] Failed to prepare reply window:', error);
      if (pet) { pet.style.visibility = ''; }
      callback();
    }
  }

  function showReply(text) {
    var el = document.getElementById('cc-reply');
    var pet = document.getElementById('pet');
    if (!el || !text || !pet) return;
    clearTimeout(replyTimer);
    clearTimeout(replyFadeTimer);
    el.classList.remove('working');
    el.textContent = text;
    el.hidden = false;
    el.style.visibility = 'hidden';
    el.style.opacity = '0';
    var extraWidth = Math.ceil(el.getBoundingClientRect().width) + BUBBLE_WINDOW_GAP;
    resizeReplyWindow(extraWidth, function () {
      el.style.visibility = '';
      el.style.opacity = '1';
      el.style.left = ((parseFloat(pet.style.left) || 0) + 4) + 'px';
      el.style.top = Math.max(0, (parseFloat(pet.style.top) || 0) - 36) + 'px';
      replyTimer = setTimeout(function () {
        el.style.opacity = '0';
        replyFadeTimer = setTimeout(function () {
          el.hidden = true;
          resizeReplyWindow(0, function () {});
        }, 300);
      }, 5000);
    });
  }

  function showWorkingPrompt(text) {
    var el = document.getElementById('cc-reply');
    var pet = document.getElementById('pet');
    if (!el || !text || !pet) return;
    clearTimeout(replyTimer);
    clearTimeout(replyFadeTimer);
    el.replaceChildren();
    var spinner = document.createElement('span');
    spinner.className = 'cc-reply__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    label.textContent = text;
    el.appendChild(spinner);
    el.appendChild(label);
    el.classList.add('working');
    el.hidden = false;
    el.style.visibility = 'hidden';
    el.style.opacity = '0';
    var extraWidth = Math.ceil(el.getBoundingClientRect().width) + BUBBLE_WINDOW_GAP;
    resizeReplyWindow(extraWidth, function () {
      el.style.visibility = '';
      el.style.opacity = '1';
      el.style.left = ((parseFloat(pet.style.left) || 0) + 4) + 'px';
      el.style.top = Math.max(0, (parseFloat(pet.style.top) || 0) - 36) + 'px';
    });
  }

  function hideWorkingPrompt() {
    var el = document.getElementById('cc-reply');
    if (!el || !el.classList.contains('working')) return;
    clearTimeout(replyTimer);
    clearTimeout(replyFadeTimer);
    el.hidden = true;
    el.classList.remove('working');
    el.replaceChildren();
    resizeReplyWindow(0, function () {});
  }

  function scheduleReconnect(delay, restartScan) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      if (restartScan) portIndex = 0;
      connect();
    }, delay);
  }

  function dispatchMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'snapshot') {
      if (msg.config && window.__petReloadConfig) window.__petReloadConfig(msg.config);
      if (window.__petOnCCState) window.__petOnCCState(msg.state, msg.prevState);
      if (window.__petOnAppear) window.__petOnAppear();
      if (msg.workingPrompt) showWorkingPrompt(msg.workingPrompt);
    } else if (msg.type === 'config-update' && msg.config) {
      if (window.__petReloadConfig) window.__petReloadConfig(msg.config);
    } else if (msg.type === 'scale-preview' && window.__petPreviewScale) {
      window.__petPreviewScale(msg.scale);
    } else if (msg.type === 'pet-asset' && window.__petSetSpriteSource) {
      if (msg.config && window.__petReloadConfig) window.__petReloadConfig(msg.config);
      window.__petSetSpriteSource(msg.dataUrl);
    } else if (msg.type === 'pet-asset-reset' && window.__petResetSpriteSource) {
      window.__petResetSpriteSource();
    } else if (msg.type === 'cc-state') {
      if (window.__petOnCCState) window.__petOnCCState(msg.state, msg.prevState);
      if (msg.state !== 'working') hideWorkingPrompt();
    } else if (msg.type === 'cc-working-prompt' && msg.text) {
      showWorkingPrompt(msg.text);
    } else if (msg.type === 'cc-reply' && msg.text) {
      showReply(msg.text);
    }
  }

  function handleMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    dispatchMessage(msg);
  }

  window.__petHandleMessage = dispatchMessage;

  function connect() {
    if (ws || portIndex >= ports.length) {
      if (!ws) scheduleReconnect(3000, true);
      return;
    }

    var port = ports[portIndex];
    var socket;
    try {
      socket = new WebSocket('ws://127.0.0.1:' + port);
    } catch (_) {
      portIndex += 1;
      scheduleReconnect(100, false);
      return;
    }
    ws = socket;

    socket.onopen = function () {
      if (ws !== socket) return;
      window.__petIPCStatus = { connected: true, port: port };
      console.info('[CC Pet] IPC connected on port ' + port);
      socket.send('{"type":"ready"}');
    };
    socket.onmessage = handleMessage;
    socket.onerror = function () {
      // onclose is the single reconnect path, preventing duplicate timers.
      try { socket.close(); } catch (_) { /* already closing */ }
    };
    socket.onclose = function () {
      if (ws !== socket) return;
      ws = null;
      window.__petIPCStatus = { connected: false, port: null };
      if (hasConfiguredPort || socket.readyState === WebSocket.OPEN) {
        scheduleReconnect(1000, true);
      } else {
        portIndex += 1;
        scheduleReconnect(portIndex >= ports.length ? 3000 : 100, portIndex >= ports.length);
      }
    };
  }

  if (window.__petGetDisplayMetrics) {
    resizeForMetrics(window.__petGetDisplayMetrics());
  }
  setTimeout(connect, 300);
})();
