// dist-pet/pet.js — Tauri 桌面版桌宠
// 根目录 pet-config.json 是唯一配置源；Tauri 构建时同步只读副本到此前端目录。
(function () {
  'use strict';

  var DRAG_THRESHOLD = 5;
  var HOVER_COOLDOWN_MS = 600;
  var FRAME_INTERVAL_MS = 120;
  var CONVENTIONAL_NAMES = {
    1: 'idle', 2: 'running-left', 3: 'running-right', 4: 'running',
    5: 'jumping', 6: 'waving', 7: 'waiting', 8: 'review',
    9: 'failed', 10: 'look-down', 11: 'ambient'
  };
  var DEFAULT_CONFIG = {
    sheetWidth: 1536,
    sheetHeight: 2288,
    colWidth: 192,
    rowHeight: 208,
    displayScale: 1,
    rows: [
      { row: 1, frames: 7 }, { row: 2, frames: 8 }, { row: 3, frames: 8 },
      { row: 4, frames: 4 }, { row: 5, frames: 5 }, { row: 6, frames: 8 },
      { row: 7, frames: 6 }, { row: 8, frames: 6 }, { row: 9, frames: 6 },
      { row: 10, frames: 8 }, { row: 11, frames: 8 }
    ],
    bindings: {}
  };

  var pet = document.getElementById('pet');
  var stage = document.getElementById('stage');
  var config = DEFAULT_CONFIG;
  var down = null;
  var dragging = false;
  var animationTimer = null;
  var oneShotTimer = null;
  var pendingMove = null;
  var moveFrame = null;
  var ccState = 'idle';
  var userOverride = false;
  var initialized = false;
  var externalConfigReceived = false;
  var appearPlayed = false;
  var appearPending = false;
  var appearFallbackTimer = null;
  var spriteRequestId = 0;
  var spriteSource = 'spritesheet.webp';
  var lastHoverAt = 0;

  function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function normalizeDisplayScale(value) {
    var scale = Number(value);
    if (!Number.isFinite(scale)) return 1;
    return Math.round(Math.max(0.5, Math.min(1.5, scale)) * 100) / 100;
  }

  function normalizeActionSpeed(value) {
    var speed = Number(value);
    if (!Number.isFinite(speed)) return 1;
    return Math.round(Math.max(0.5, Math.min(2, speed)) * 10) / 10;
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG;
    var colWidth = positiveInteger(raw.colWidth, DEFAULT_CONFIG.colWidth);
    var sheetWidth = positiveInteger(raw.sheetWidth, DEFAULT_CONFIG.sheetWidth);
    var rowHeight = positiveInteger(raw.rowHeight, DEFAULT_CONFIG.rowHeight);
    var sheetHeight = positiveInteger(raw.sheetHeight, DEFAULT_CONFIG.sheetHeight);
    var maxColumns = Math.max(1, Math.floor(sheetWidth / colWidth));
    var maxRows = Math.max(1, Math.floor(sheetHeight / rowHeight));
    var sourceRows = (Array.isArray(raw.rows) ? raw.rows : DEFAULT_CONFIG.rows).slice(0, maxRows);
    var rows = sourceRows.map(function (item, index) {
      var fallback = DEFAULT_CONFIG.rows[index] || { row: index + 1, frames: 1 };
      return {
        row: positiveInteger(item && item.row, fallback.row),
        frames: Math.min(positiveInteger(item && item.frames, fallback.frames), maxColumns),
        speed: normalizeActionSpeed(item && item.speed),
        name: item && typeof item.name === 'string' ? item.name : ''
      };
    });
    return {
      sheetWidth: sheetWidth,
      sheetHeight: sheetHeight,
      colWidth: colWidth,
      rowHeight: rowHeight,
      displayScale: normalizeDisplayScale(raw.displayScale),
      rows: rows,
      bindings: raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {}
    };
  }

  function displayMetrics() {
    var scale = config.displayScale;
    var petWidth = Math.max(1, Math.round(config.colWidth * scale));
    var petHeight = Math.max(1, Math.round(config.rowHeight * scale));
    return {
      scale: scale,
      petWidth: petWidth,
      petHeight: petHeight,
      windowWidth: petWidth + 4,
      windowHeight: petHeight + 4
    };
  }

  function applyDisplayGeometry(notifyWindow) {
    var metrics = displayMetrics();
    pet.style.backgroundSize =
      Math.round(config.sheetWidth * metrics.scale) + 'px ' +
      Math.round(config.sheetHeight * metrics.scale) + 'px';
    pet.style.width = metrics.petWidth + 'px';
    pet.style.height = metrics.petHeight + 'px';
    if (!initialized) {
      pet.style.left = Math.max(0, (window.innerWidth - metrics.petWidth) / 2) + 'px';
      pet.style.top = Math.max(0, (window.innerHeight - metrics.petHeight) / 2) + 'px';
    }
    if (notifyWindow && window.__petResizeForMetrics) {
      window.__petResizeForMetrics(metrics);
    }
    return metrics;
  }

  function applySpriteSource(source) {
    spriteRequestId += 1;
    var requestId = spriteRequestId;
    var image = new Image();
    image.onload = function () {
      if (requestId !== spriteRequestId) return;
      if (image.naturalWidth !== config.sheetWidth || image.naturalHeight !== config.sheetHeight) {
        console.error(
          '[CC Pet] Sprite/config size mismatch: image=' + image.naturalWidth + 'x' + image.naturalHeight +
          ', config=' + config.sheetWidth + 'x' + config.sheetHeight
        );
        return;
      }
      spriteSource = source;
      pet.style.backgroundImage = 'url("' + source + '")';
    };
    image.onerror = function () {
      console.error('[CC Pet] Failed to load selected pet sprite.');
    };
    image.src = source;
  }

  function rowAction(rowNumber) {
    var action = config.rows.find(function (item) { return item.row === rowNumber; });
    return action || { row: rowNumber, frames: 1, speed: 1, name: '' };
  }

  function frameInterval(action) {
    return Math.round(FRAME_INTERVAL_MS / normalizeActionSpeed(action.speed));
  }

  function boundAction(eventName) {
    var binding = config.bindings[eventName];
    if (typeof binding === 'string' && binding) {
      var rowBinding = /^row-(\d+)$/.exec(binding);
      if (rowBinding) {
        var rowNumber = Number(rowBinding[1]);
        var rowBound = config.rows.find(function (item) { return item.row === rowNumber; });
        if (rowBound) return rowBound;
      }
      var bound = config.rows.find(function (item) {
        return item.name === binding || CONVENTIONAL_NAMES[item.row] === binding;
      });
      if (bound) return bound;
      console.warn('Unknown pet action binding:', eventName, binding);
    }
    return null;
  }

  function frame(action, column) {
    var safeColumn = Math.max(0, Math.min(column, action.frames - 1));
    var scale = config.displayScale;
    pet.style.backgroundPosition =
      '-' + Math.round(safeColumn * config.colWidth * scale) + 'px ' +
      '-' + Math.round((action.row - 1) * config.rowHeight * scale) + 'px';
  }

  function stopAnimation() {
    if (animationTimer !== null) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  function startLoop(action) {
    stopAnimation();
    frame(action, 0);
    if (action.frames <= 1) return;
    var column = 0;
    var dir = 1;
    animationTimer = setInterval(function () {
      column += dir;
      if (column >= action.frames) { column = action.frames - 2; dir = -1; }
      if (column < 0) { column = 1; dir = 1; }
      frame(action, column);
    }, frameInterval(action));
  }

  function showIdle() {
    stopAnimation();
    var idle = rowAction(1);
    frame(idle, Math.min(1, idle.frames - 1));
  }

  function restoreCcState() {
    if (userOverride) return;
    if (ccState === 'working') {
      var workingAction = boundAction('cc-working');
      if (workingAction) startLoop(workingAction);
      else showIdle();
      return;
    }
    var idleLoopAction = boundAction('idle-loop');
    if (idleLoopAction) startLoop(idleLoopAction);
    else showIdle();
  }

  function playOnce(action, onComplete) {
    clearTimeout(oneShotTimer);
    stopAnimation();
    var column = 0;
    frame(action, column);
    if (action.frames <= 1) {
      oneShotTimer = setTimeout(function () {
        if (onComplete) onComplete();
        else restoreCcState();
      }, Math.round(1000 / normalizeActionSpeed(action.speed)));
      return;
    }
    animationTimer = setInterval(function () {
      column += 1;
      if (column >= action.frames) {
        stopAnimation();
        if (onComplete) onComplete();
        else restoreCcState();
        return;
      }
      frame(action, column);
    }, frameInterval(action));
  }

  function triggerAppear() {
    if (appearPlayed) return;
    if (!initialized) {
      appearPending = true;
      return;
    }
    appearPlayed = true;
    appearPending = false;
    clearTimeout(appearFallbackTimer);
    var appearAction = boundAction('appear');
    if (!appearAction) {
      restoreCcState();
      return;
    }
    userOverride = true;
    playOnce(appearAction, function () {
      userOverride = false;
      restoreCcState();
    });
  }

  function releasePointer(event) {
    if (!event || !pet.hasPointerCapture || !pet.hasPointerCapture(event.pointerId)) return;
    try {
      pet.releasePointerCapture(event.pointerId);
    } catch (_) {
      // Pointer capture may already have been released by the platform.
    }
  }

  function resetDragState(event) {
    pet.classList.remove('dragging');
    releasePointer(event);
    down = null;
    dragging = false;
    userOverride = false;
    restoreCcState();
  }

  function setDragDirection(direction) {
    if (!down || !direction || down.direction === direction) return;
    down.direction = direction;
    var dragAction = boundAction(direction === 'left' ? 'drag-left' : 'drag-right');
    if (!dragAction) {
      userOverride = false;
      restoreCcState();
      return;
    }
    userOverride = true;
    startLoop(dragAction);
  }

  function scheduleWindowMove(x, y) {
    pendingMove = { x: x, y: y };
    if (moveFrame !== null) return;
    moveFrame = requestAnimationFrame(function () {
      moveFrame = null;
      if (!pendingMove || !down || !down.appWindow || !down.LogicalPosition) return;
      var target = pendingMove;
      pendingMove = null;
      Promise.resolve(down.appWindow.setPosition(
        new down.LogicalPosition(Math.round(target.x), Math.round(target.y))
      )).catch(function (error) {
        console.error('Failed to move Tauri window:', error);
      });
    });
  }

  function prepareWindowPosition(pointerId) {
    try {
      var tauriWindow = window.__TAURI__ && window.__TAURI__.window;
      if (!tauriWindow || !tauriWindow.getCurrentWindow || !tauriWindow.LogicalPosition) {
        throw new Error('Tauri window positioning API is unavailable');
      }
      var appWindow = tauriWindow.getCurrentWindow();
      Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
        .then(function (values) {
          if (!down || down.pointerId !== pointerId) return;
          var position = values[0];
          var scaleFactor = values[1] || 1;
          down.windowX = position.x / scaleFactor;
          down.windowY = position.y / scaleFactor;
          down.appWindow = appWindow;
          down.LogicalPosition = tauriWindow.LogicalPosition;
          if (dragging) {
            scheduleWindowMove(
              down.windowX + down.latestScreenX - down.screenX,
              down.windowY + down.latestScreenY - down.screenY
            );
          }
        })
        .catch(function (error) {
          console.error('Failed to read Tauri window position:', error);
        });
    } catch (error) {
      console.error('Failed to prepare Tauri window dragging:', error);
    }
  }

  pet.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    clearTimeout(oneShotTimer);
    down = {
      x: event.clientX,
      y: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      latestScreenX: event.screenX,
      latestScreenY: event.screenY,
      lastScreenX: event.screenX,
      time: Date.now(),
      pointerId: event.pointerId,
      direction: '',
      windowX: null,
      windowY: null,
      appWindow: null,
      LogicalPosition: null
    };
    try {
      pet.setPointerCapture(event.pointerId);
    } catch (_) {
      // Continue without capture on platforms that do not support it.
    }
    prepareWindowPosition(event.pointerId);
    event.preventDefault();
  });

  pet.addEventListener('pointermove', function (event) {
    if (!down || event.pointerId !== down.pointerId) return;
    var dx = event.screenX - down.screenX;
    var dy = event.screenY - down.screenY;
    var stepX = event.screenX - down.lastScreenX;
    down.latestScreenX = event.screenX;
    down.latestScreenY = event.screenY;
    down.lastScreenX = event.screenX;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;

    if (!dragging) {
      dragging = true;
      pet.classList.add('dragging');
      setDragDirection(dx < 0 ? 'left' : dx > 0 ? 'right' : '');
    } else if (stepX < -1) {
      setDragDirection('left');
    } else if (stepX > 1) {
      setDragDirection('right');
    }

    if (down.windowX !== null && down.windowY !== null) {
      scheduleWindowMove(down.windowX + dx, down.windowY + dy);
    }
  });

  function pointerUp(event) {
    if (!down) return;
    if (dragging) {
      resetDragState(event);
      return;
    }
    if (event && Date.now() - down.time < 200 &&
        Math.abs(event.clientX - down.x) < DRAG_THRESHOLD &&
        Math.abs(event.clientY - down.y) < DRAG_THRESHOLD) {
      var clickAction = boundAction('click');
      if (!clickAction) {
        releasePointer(event);
        down = null;
        return;
      }
      userOverride = true;
      if (clickAction.row >= 10) {
        stopAnimation();
        frame(clickAction, 0);
        oneShotTimer = setTimeout(function () {
          userOverride = false;
          restoreCcState();
        }, Math.round(1000 / normalizeActionSpeed(clickAction.speed)));
      } else {
        playOnce(clickAction, function () {
          userOverride = false;
          restoreCcState();
        });
      }
    }
    releasePointer(event);
    down = null;
  }

  pet.addEventListener('pointerup', pointerUp);
  pet.addEventListener('pointercancel', pointerUp);
  pet.addEventListener('pointerenter', function () {
    var now = Date.now();
    if (!initialized || down || dragging || userOverride || now - lastHoverAt < HOVER_COOLDOWN_MS) return;
    var hoverAction = boundAction('hover');
    if (!hoverAction) return;
    lastHoverAt = now;
    userOverride = true;
    playOnce(hoverAction, function () {
      userOverride = false;
      restoreCcState();
    });
  });

  function initialize(rawConfig) {
    if (!externalConfigReceived) { config = normalizeConfig(rawConfig); }
    pet.style.cssText = [
      'position:absolute',
      'background-image:url("' + spriteSource + '")',
      'background-repeat:no-repeat',
      'cursor:grab',
      'touch-action:none',
      'image-rendering:pixelated'
    ].join(';');
    applyDisplayGeometry(false);
    stage.hidden = false;
    initialized = true;
    restoreCcState();
    if (window.__petResizeForMetrics) { window.__petResizeForMetrics(displayMetrics()); }
    if (appearPending) {
      triggerAppear();
    } else {
      appearFallbackTimer = setTimeout(triggerAppear, 1000);
    }
  }

  // ===== 阶段 7：WebSocket IPC 客户端 =====
  // 通过 <script src="pet-ipc.js"> 加载，不在本文件中
  function loadBootstrap() {
    var core = window.__TAURI__ && window.__TAURI__.core;
    if (core && typeof core.invoke === 'function') {
      return core.invoke('pet_bootstrap').then(function (bootstrap) {
        initialize(bootstrap && bootstrap.config ? bootstrap.config : DEFAULT_CONFIG);
        if (bootstrap && bootstrap.asset && bootstrap.asset.dataUrl) {
          applySpriteSource(bootstrap.asset.dataUrl);
        }
      });
    }
    return fetch('pet-config.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(initialize);
  }

  loadBootstrap()
    .catch(function (error) {
      console.error('Failed to load pet-config.json; using defaults:', error);
      initialize(DEFAULT_CONFIG);
    });
// 供 pet-ipc.js 调用的配置热更新入口
  window.__petReloadConfig = function (newCfg) {
    externalConfigReceived = true;
    config = normalizeConfig(newCfg);
    applyDisplayGeometry(true);
    if (initialized && !userOverride) {
      stopAnimation();
      restoreCcState();
    }
  };
  window.__petPreviewScale = function (scale) {
    config.displayScale = normalizeDisplayScale(scale);
    applyDisplayGeometry(true);
    if (initialized && !userOverride) {
      stopAnimation();
      restoreCcState();
    }
  };
  window.__petGetDisplayMetrics = displayMetrics;
  window.__petSetSpriteSource = function (dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    applySpriteSource(dataUrl);
  };
  window.__petResetSpriteSource = function () {
    applySpriteSource('spritesheet.webp');
  };
  // 供 pet-ipc.js 调用的 CC 状态变化入口
  window.__petOnCCState = function (state, prevState) {
    ccState = state === 'working' || state === 'open' ? state : 'idle';
    if (!initialized) return;
    if (userOverride) return;
    clearTimeout(oneShotTimer);
    if (state === 'working') {
      var workingAction = boundAction('cc-working');
      if (workingAction) startLoop(workingAction);
      else showIdle();
    } else if (state === 'open' && prevState === 'working') {
      var completeAction = boundAction('cc-complete');
      if (completeAction) {
        playOnce(completeAction, function () { restoreCcState(); });
      } else {
        restoreCcState();
      }
    } else {
      restoreCcState();
    }
  };
  window.__petOnAppear = triggerAppear;

})();
