(function () {
  'use strict';

  document.body.classList.add('desktop-host');

  function invoke(command, args) {
    var core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri command API is unavailable'));
    }
    return core.invoke(command, args || {});
  }

  function deliver(message) {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  }

  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (message) {
        var task;
        switch (message.type) {
          case 'ready': task = invoke('settings_snapshot').then(function (snapshot) { deliver(snapshot); }); break;
          case 'save': task = invoke('save_actions', { rows: message.rows, bindings: message.bindings }).then(function () { deliver({ type: 'saved' }); }); break;
          case 'toggle-desktop': task = invoke('set_pet_visible', { visible: !!message.value }); break;
          case 'toggle-autostart': task = invoke('set_autostart', { enabled: !!message.value }); break;
          case 'preview-scale': task = invoke('preview_scale', { scale: message.value }); break;
          case 'save-scale': task = invoke('save_display_scale', { scale: message.value }); break;
          case 'save-pets-root': task = invoke('save_pets_root', { value: message.value }).then(function (snapshot) { deliver(snapshot); }); break;
          case 'browse-pets-root': task = invoke('browse_pets_root').then(function (snapshot) { if (snapshot) deliver(snapshot); }); break;
          case 'refresh-pets': task = invoke('settings_snapshot').then(function (snapshot) { deliver(snapshot); }); break;
          case 'select-pet': task = invoke('select_pet', { petId: message.value }).then(function (snapshot) { deliver(snapshot); }); break;
          default: return;
        }
        Promise.resolve(task).catch(function (error) {
          console.error('[CC Pet settings]', error);
          deliver({ type: 'error', message: error && error.message ? error.message : String(error) });
        });
      }
    };
  };
})();
