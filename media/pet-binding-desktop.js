(function () {
  'use strict';

  var pages = {
    pet: ['桌宠设备', '选择人物并调整它在桌面上的显示方式。'],
    actions: ['动作映射', '配置当前人物的动作、速度与触发事件。'],
    runtime: ['运行设置', '控制桌宠窗口、开机启动与托盘行为。'],
    about: ['关于 CC Pet', '查看桌面端版本和配置位置。']
  };
  var pageTitle = document.getElementById('page-title');
  var pageSubtitle = document.getElementById('page-subtitle');
  var saveButton = document.getElementById('save-btn');
  var preview = document.getElementById('pet-preview');
  var activePetName = document.getElementById('active-pet-name');
  var toast = document.getElementById('desktop-toast');

  function openPage(name) {
    if (!pages[name]) return;
    document.querySelectorAll('[data-page]').forEach(function (page) {
      page.classList.toggle('active', page.getAttribute('data-page') === name);
    });
    document.querySelectorAll('[data-page-target]').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-page-target') === name);
    });
    pageTitle.textContent = pages[name][0];
    pageSubtitle.textContent = pages[name][1];
    saveButton.hidden = name !== 'actions';
    try { localStorage.setItem('cc-pet-settings-page', name); } catch (_) {}
  }

  function selectedPet(catalog) {
    var pets = catalog && Array.isArray(catalog.pets) ? catalog.pets : [];
    var selected = catalog && catalog.selectedPetId;
    return pets.find(function (pet) { return pet.folderName === selected; }) || pets[0];
  }

  function updatePreview(message) {
    var pet = selectedPet(message.petCatalog);
    activePetName.textContent = pet ? pet.displayName : '未找到人物';
    if (!preview) return;
    var asset = message.petAsset;
    var format = message.petFormat;
    if (!asset || !asset.dataUrl || !format) {
      preview.classList.add('empty');
      preview.style.backgroundImage = '';
      return;
    }
    var columns = format.sheetWidth / format.columnWidth;
    var rows = format.sheetHeight / format.rowHeight;
    preview.classList.remove('empty');
    preview.style.backgroundImage = 'url("' + asset.dataUrl + '")';
    preview.style.backgroundSize = (columns * 100) + '% ' + (rows * 100) + '%';
  }

  function showToast(text, error) {
    if (!toast) return;
    toast.textContent = text;
    toast.style.borderColor = error ? 'rgba(255,111,125,.35)' : '';
    toast.style.background = error ? '#29171b' : '';
    toast.classList.add('show');
    window.setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  document.querySelectorAll('[data-page-target]').forEach(function (button) {
    button.addEventListener('click', function () {
      openPage(button.getAttribute('data-page-target'));
    });
  });

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'init') updatePreview(message);
    if (message.type === 'saved') showToast('当前人物的动作配置已保存');
    if (message.type === 'error') showToast(message.message || '设置保存失败', true);
  });

  var initialPage = 'pet';
  try { initialPage = localStorage.getItem('cc-pet-settings-page') || initialPage; } catch (_) {}
  openPage(initialPage);
})();
