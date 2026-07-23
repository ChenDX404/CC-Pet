(function () {
  'use strict';

  var vscode = acquireVsCodeApi();
  var ALL_EVENTS = ['drag-left', 'drag-right', 'click', 'hover', 'appear', 'idle-loop', 'cc-working', 'cc-complete'];
  var rows = [];
  var bindings = {};
  var dirty = false;
  var currentPetId = '';
  var scalePreviewFrame = null;

  var saveBtn = document.getElementById('save-btn');
  var container = document.getElementById('rows-container');
  var desktopToggle = document.getElementById('desktop-toggle');
  var petsRootInput = document.getElementById('pets-root');
  var petsRootBrowse = document.getElementById('pets-root-browse');
  var petsRefresh = document.getElementById('pets-refresh');
  var petSelect = document.getElementById('pet-select');
  var petFormat = document.getElementById('pet-format');
  var petsStatus = document.getElementById('pets-status');
  var scaleInput = document.getElementById('pet-scale');
  var scaleValue = document.getElementById('pet-scale-value');
  var scaleReset = document.getElementById('pet-scale-reset');
  var autostartToggle = document.getElementById('autostart-toggle');
  var hostBadge = document.getElementById('host-badge');

  function markDirty() {
    dirty = true;
    if (saveBtn) saveBtn.textContent = '保存修改 *';
  }

  function clearDirty() {
    dirty = false;
    if (saveBtn) saveBtn.textContent = '保存修改';
  }

  function scaleFromPercent(value) {
    var percent = Math.max(50, Math.min(150, Number(value) || 100));
    return Math.round(percent) / 100;
  }

  function updateScaleLabel() {
    if (scaleInput && scaleValue) scaleValue.textContent = scaleInput.value + '%';
  }

  function previewScale() {
    if (!scaleInput) return;
    updateScaleLabel();
    if (scalePreviewFrame !== null) return;
    scalePreviewFrame = requestAnimationFrame(function () {
      scalePreviewFrame = null;
      vscode.postMessage({ type: 'preview-scale', value: scaleFromPercent(scaleInput.value) });
    });
  }

  function renderPetCatalog(catalog) {
    catalog = catalog || {};
    if (petsRootInput) petsRootInput.value = catalog.rootDirectory || '';
    var pets = Array.isArray(catalog.pets) ? catalog.pets : [];
    currentPetId = catalog.selectedPetId || (pets[0] && pets[0].id) || '';
    if (petSelect) {
      petSelect.innerHTML = '';
      if (pets.length === 0) {
        var emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '没有可用人物';
        petSelect.appendChild(emptyOption);
        petSelect.disabled = true;
      } else {
        petSelect.disabled = false;
        pets.forEach(function (pet) {
          var option = document.createElement('option');
          option.value = pet.folderName;
          option.textContent = pet.displayName + '（v' + pet.spriteVersionNumber + ' · ' + pet.rowCount + '行）';
          petSelect.appendChild(option);
        });
        petSelect.value = currentPetId;
      }
    }
    if (petsStatus) {
      var warningCount = Array.isArray(catalog.warnings) ? catalog.warnings.length : 0;
      if (!catalog.exists) {
        petsStatus.textContent = '未检测到目录，请手动填写或点击浏览。';
        petsStatus.className = 'source-status error';
      } else if (pets.length === 0) {
        petsStatus.textContent = '目录中没有兼容人物，请检查图片尺寸和 pet.json。';
        petsStatus.className = 'source-status error';
      } else {
        petsStatus.textContent = (catalog.automatic ? '自动检测' : '手动设置') +
          ' · 已找到 ' + pets.length + ' 个人物' +
          (warningCount ? ' · 忽略 ' + warningCount + ' 个无效目录' : '');
        petsStatus.className = 'source-status ok';
      }
    }
  }

  function renderFormat(format) {
    if (!petFormat) return;
    petFormat.hidden = !format;
    petFormat.textContent = format ? '当前格式：' + format.label : '';
  }

  function actionKey(row) {
    return 'row-' + row.row;
  }

  function usedEvents() {
    var result = {};
    Object.keys(bindings).forEach(function (eventName) {
      if (bindings[eventName]) result[eventName] = true;
    });
    return result;
  }

  function bindingsByAction() {
    var result = {};
    Object.keys(bindings).forEach(function (eventName) {
      var key = bindings[eventName];
      if (key) result[key] = (result[key] || []).concat(eventName);
    });
    return result;
  }

  function render() {
    container.innerHTML = '';
    var byAction = bindingsByAction();
    rows.forEach(function (row, index) {
      var key = actionKey(row);
      var card = document.createElement('div');
      card.className = 'row-card';

      var header = document.createElement('div');
      header.className = 'row-header';
      var label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = '第 ' + row.row + ' 行';

      var nameInput = document.createElement('input');
      nameInput.className = 'name-input';
      nameInput.value = row._userName || '';
      nameInput.placeholder = row._defaultName;
      nameInput.addEventListener('input', function () {
        row._userName = nameInput.value.trim();
        markDirty();
      });

      var frameWrap = document.createElement('span');
      frameWrap.className = 'row-frames';
      frameWrap.textContent = '帧数 ';
      var frameInput = document.createElement('input');
      frameInput.type = 'number';
      frameInput.min = '1';
      frameInput.max = '8';
      frameInput.value = String(row.frames);
      frameInput.className = 'frames-input';
      frameInput.addEventListener('change', function () {
        var value = Math.max(1, Math.min(8, Number(frameInput.value) || row.frames));
        row.frames = Math.round(value);
        frameInput.value = String(row.frames);
        markDirty();
      });
      frameWrap.appendChild(frameInput);

      header.appendChild(label);
      header.appendChild(nameInput);
      header.appendChild(frameWrap);
      card.appendChild(header);

      var speedRow = document.createElement('div');
      speedRow.className = 'speed-row';
      var speedLabel = document.createElement('span');
      speedLabel.className = 'speed-label';
      speedLabel.textContent = '速度';
      var speedInput = document.createElement('input');
      speedInput.className = 'speed-input';
      speedInput.type = 'range';
      speedInput.min = '0.5';
      speedInput.max = '2';
      speedInput.step = '0.1';
      speedInput.value = String(row.speed || 1);
      var speedOutput = document.createElement('output');
      speedOutput.className = 'speed-value';
      speedOutput.textContent = Number(row.speed || 1).toFixed(1) + '×';
      speedInput.addEventListener('input', function () {
        row.speed = Math.round(Math.max(0.5, Math.min(2, Number(speedInput.value) || 1)) * 10) / 10;
        speedOutput.textContent = row.speed.toFixed(1) + '×';
        markDirty();
      });
      speedRow.appendChild(speedLabel);
      speedRow.appendChild(document.createTextNode('0.5×'));
      speedRow.appendChild(speedInput);
      speedRow.appendChild(document.createTextNode('2.0×'));
      speedRow.appendChild(speedOutput);
      card.appendChild(speedRow);

      var eventsRow = document.createElement('div');
      eventsRow.className = 'events-row';
      (byAction[key] || []).forEach(function (eventName) {
        var chip = document.createElement('span');
        chip.className = 'event-chip';
        chip.textContent = eventName + ' ';
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-btn';
        remove.textContent = '×';
        remove.addEventListener('click', function () {
          delete bindings[eventName];
          markDirty();
          render();
        });
        chip.appendChild(remove);
        eventsRow.appendChild(chip);
      });
      var addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'add-btn';
      addButton.textContent = '+ 绑定';
      addButton.addEventListener('click', function (event) {
        event.stopPropagation();
        showDropdown(addButton, row);
      });
      eventsRow.appendChild(addButton);
      card.appendChild(eventsRow);
      container.appendChild(card);
    });
  }

  function showDropdown(button, row) {
    var existing = document.querySelector('.event-dropdown');
    if (existing) existing.remove();
    var key = actionKey(row);
    var used = usedEvents();
    var rect = button.getBoundingClientRect();
    var dropdown = document.createElement('div');
    dropdown.className = 'event-dropdown';
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 2 + 'px';
    ALL_EVENTS.forEach(function (eventName) {
      var item = document.createElement('div');
      item.className = 'dropdown-item';
      if (used[eventName] && bindings[eventName] !== key) {
        item.className += ' disabled';
        item.textContent = eventName + '（已使用）';
      } else {
        item.textContent = eventName + (bindings[eventName] === key ? ' ✓' : '');
        item.addEventListener('click', function () {
          bindings[eventName] = key;
          dropdown.remove();
          markDirty();
          render();
        });
      }
      dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
    setTimeout(function () {
      document.addEventListener('click', function close() {
        document.removeEventListener('click', close);
        if (dropdown.parentElement) dropdown.remove();
      });
    }, 0);
  }

  saveBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'save', rows: rows, bindings: bindings });
  });

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'saved') {
      clearDirty();
      saveBtn.textContent = '✓ 已保存';
      setTimeout(clearDirty, 1500);
    } else if (message.type === 'init') {
      rows = Array.isArray(message.rows) ? message.rows : [];
      bindings = message.bindings || {};
      if (desktopToggle) desktopToggle.checked = message.autoLaunch !== false;
      if (autostartToggle) autostartToggle.checked = message.autostart === true;
      if (hostBadge && message.hostLabel) hostBadge.textContent = message.hostLabel;
      if (scaleInput) {
        scaleInput.value = String(Math.round((Number(message.displayScale) || 1) * 100));
        updateScaleLabel();
      }
      renderPetCatalog(message.petCatalog);
      renderFormat(message.petFormat);
      clearDirty();
      render();
    }
  });

  if (desktopToggle) desktopToggle.addEventListener('change', function () {
    vscode.postMessage({ type: 'toggle-desktop', value: desktopToggle.checked });
  });
  if (autostartToggle) autostartToggle.addEventListener('change', function () {
    vscode.postMessage({ type: 'toggle-autostart', value: autostartToggle.checked });
  });
  if (scaleInput) {
    scaleInput.addEventListener('input', previewScale);
    scaleInput.addEventListener('change', function () {
      previewScale();
      vscode.postMessage({ type: 'save-scale', value: scaleFromPercent(scaleInput.value) });
    });
  }
  if (scaleReset) scaleReset.addEventListener('click', function () {
    if (!scaleInput) return;
    scaleInput.value = '100';
    previewScale();
    vscode.postMessage({ type: 'save-scale', value: 1 });
  });
  if (petsRootInput) {
    petsRootInput.addEventListener('change', function () {
      vscode.postMessage({ type: 'save-pets-root', value: petsRootInput.value });
    });
    petsRootInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') petsRootInput.blur();
    });
  }
  if (petsRootBrowse) petsRootBrowse.addEventListener('click', function () {
    vscode.postMessage({ type: 'browse-pets-root' });
  });
  if (petsRefresh) petsRefresh.addEventListener('click', function () {
    vscode.postMessage({ type: 'refresh-pets' });
  });
  if (petSelect) petSelect.addEventListener('change', function () {
    if (dirty && !window.confirm('当前人物的修改尚未保存。确定放弃修改并切换吗？')) {
      petSelect.value = currentPetId;
      return;
    }
    vscode.postMessage({ type: 'select-pet', value: petSelect.value });
  });

  vscode.postMessage({ type: 'ready' });
})();
