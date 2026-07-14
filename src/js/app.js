document.addEventListener('DOMContentLoaded', () => {
    if (!window.api) {
        alert('preload.js not loaded');
        return;
    }

    const mainBtn = document.getElementById('main-btn');
    const updateBtn = document.getElementById('update-btn');
    const installPathEl = document.getElementById('install-path');
    const changeDirBtn = document.getElementById('change-dir-btn');
    const resetDirBtn = document.getElementById('reset-dir-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressText = document.getElementById('progress-text');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsClose = document.getElementById('settings-close');
    const discordBtn = document.getElementById('discord-btn');
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    const checkClientUpdatesBtn = document.getElementById('check-client-updates-btn');
    const deleteGameBtn = document.getElementById('delete-game-btn');
    const verifyIntegrityBtn = document.getElementById('verify-integrity-btn');
    const skipCheckToggle = document.getElementById('skip-check-toggle');
    const dynamicBgToggle = document.getElementById('dynamic-bg-toggle');
    const dynamicBgEl = document.getElementById('dynamic-bg');
    const adaptBgToggle = document.getElementById('adapt-bg-toggle');
    const adaptBgRow = document.getElementById('adapt-bg-row');

    const cpBackdrop = document.getElementById('cp-backdrop');
    const cpPopup = document.getElementById('cp-popup');
    const cpCanvas = document.getElementById('cp-canvas');
    const cpCtx = cpCanvas.getContext('2d');
    const cpSvCursor = document.getElementById('cp-sv-cursor');
    const cpHueBar = document.getElementById('cp-hue-bar');
    const cpHueThumb = document.getElementById('cp-hue-thumb');
    const cpHexInput = document.getElementById('cp-hex-input');
    const settingsColorCircle = document.getElementById('settings-color-circle');
    const colorPickerRow = document.getElementById('color-picker-row');
    let cpHue = 0, cpSat = 0, cpVal = 100;
    let selectedAccentColor = localStorage.getItem('accentColor') || '#ffffff';
    let adaptToBg = localStorage.getItem('adaptToBg') === 'true';

    const settingsCats = document.querySelectorAll('.settings-cat');
    const settingsPanels = {
        general: document.getElementById('panel-general'),
        appearance: document.getElementById('panel-appearance'),
        about: document.getElementById('panel-about')
    };

    document.getElementById('btn-minimize')?.addEventListener('click', () => window.api.minimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => window.api.maximize());
    document.getElementById('btn-close')?.addEventListener('click', () => window.api.close());

    const IDLE = 'IDLE';
    const READY = 'READY';
    const UPDATE_AVAILABLE = 'UPDATE_AVAILABLE';
    const DOWNLOADING = 'DOWNLOADING';
    const PAUSED = 'PAUSED';
    const GAME_RUNNING = 'GAME_RUNNING';

    const DEFAULT_INSTALL_PATH = 'C:\\Games\\CesiumGD';

    let currentState = IDLE;
    let currentInstallPath = localStorage.getItem('installPath') || DEFAULT_INSTALL_PATH;

    function updatePathDisplay() {
        installPathEl.textContent = currentInstallPath;
        installPathEl.title = currentInstallPath;
    }
    updatePathDisplay();

    skipCheckToggle.checked = localStorage.getItem('skipCheck') === 'true';
    skipCheckToggle.addEventListener('change', () => {
        localStorage.setItem('skipCheck', skipCheckToggle.checked);
    });

    const autoUpdateToggle = document.getElementById('auto-update-toggle');
    autoUpdateToggle.checked = localStorage.getItem('autoCheckUpdates') !== 'false';
    window.api.setAutoCheckUpdates(autoUpdateToggle.checked);
    autoUpdateToggle.addEventListener('change', () => {
        localStorage.setItem('autoCheckUpdates', autoUpdateToggle.checked);
        window.api.setAutoCheckUpdates(autoUpdateToggle.checked);
    });

    let useDynamicBg = localStorage.getItem('useDynamicBg') !== 'false';
    dynamicBgToggle.checked = useDynamicBg;

    function loadLocalBackground() {
        window.api.fetchLocalBackground().then((result) => {
            if (result.error || !result.dataUrl) return;
            dynamicBgEl.style.backgroundImage = `url('${result.dataUrl}')`;
            dynamicBgEl.style.opacity = 1;
            if (adaptToBg) updateAdaptation();
        });
    }

    function applyBackground() {
        if (useDynamicBg) {
            loadLocalBackground();
        } else {
            dynamicBgEl.style.opacity = 0;
        }
    }

    applyBackground();
    updateAdaptBgRow();

    window.api.setRpcActivity({ state: 'Просматривает клиент' });

    dynamicBgToggle.addEventListener('change', () => {
        useDynamicBg = dynamicBgToggle.checked;
        localStorage.setItem('useDynamicBg', useDynamicBg);
        applyBackground();
        updateAdaptBgRow();
        if (adaptToBg) updateAdaptation();
    });

    // ----- colour picker -----

    function hexToHsv(hex) {
        const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
        const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn;
        let h = 0, s = mx ? d/mx : 0, v = mx;
        if (d) {
            if (mx===r) h = ((g-b)/d + (g<b?6:0))/6;
            else if (mx===g) h = ((b-r)/d + 2)/6;
            else h = ((r-g)/d + 4)/6;
        }
        return { h: Math.round(h*360), s: Math.round(s*100), v: Math.round(v*100) };
    }

    function hsvToHex(h, s, v) {
        s/=100; v/=100;
        const i = Math.floor(h/60), f = h/60-i, p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
        const [r,g,b] = i===0 ? [v,t,p] : i===1 ? [q,v,p] : i===2 ? [p,v,t] : i===3 ? [p,q,v] : i===4 ? [t,p,v] : [v,p,q];
        return '#'+[r,g,b].map(c=>Math.round(Math.min(c*255,255)).toString(16).padStart(2,'0')).join('');
    }

    function applyAccentColor(color) {
        document.documentElement.style.setProperty('--accent', color);
        settingsColorCircle.style.background = color;
        cpHexInput.value = color.toUpperCase();
    }

    function drawSvCanvas() {
        const w = cpCanvas.width, h = cpCanvas.height;
        const hueHex = hsvToHex(cpHue, 100, 100);
        const gradWhite = cpCtx.createLinearGradient(0,0,w,0);
        gradWhite.addColorStop(0,'#fff'); gradWhite.addColorStop(1,hueHex);
        cpCtx.fillStyle = gradWhite; cpCtx.fillRect(0,0,w,h);
        const gradBlack = cpCtx.createLinearGradient(0,0,0,h);
        gradBlack.addColorStop(0,'rgba(0,0,0,0)'); gradBlack.addColorStop(1,'#000');
        cpCtx.fillStyle = gradBlack; cpCtx.fillRect(0,0,w,h);
        const cx = cpSat/100*w, cy = (1-cpVal/100)*h;
        cpSvCursor.style.left = cx+'px'; cpSvCursor.style.top = cy+'px';
    }

    function setColorFromHsv() {
        selectedAccentColor = hsvToHex(cpHue, cpSat, cpVal);
        localStorage.setItem('accentColor', selectedAccentColor);
        applyAccentColor(selectedAccentColor);
        drawSvCanvas();
        cpHueThumb.style.left = (cpHue/360*200)+'px';
    }

    function setColorFromHex(hex) {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
        selectedAccentColor = hex;
        localStorage.setItem('accentColor', hex);
        applyAccentColor(hex);
        const hsv = hexToHsv(hex);
        cpHue = hsv.h; cpSat = hsv.s; cpVal = hsv.v;
        drawSvCanvas();
        cpHueThumb.style.left = (cpHue/360*200)+'px';
    }

    const hsv = hexToHsv(selectedAccentColor);
    cpHue = hsv.h; cpSat = hsv.s; cpVal = hsv.v;
    applyAccentColor(selectedAccentColor);
    drawSvCanvas();
    cpHueThumb.style.left = (cpHue/360*200)+'px';

    adaptBgToggle.checked = adaptToBg;
    updatePickerDisabled();

    function updatePickerDisabled() {
        const disabled = adaptToBg;
        settingsColorCircle.classList.toggle('disabled', disabled);
        colorPickerRow.style.cursor = disabled ? 'default' : 'pointer';
    }

    function showColorPopup(triggerEl) {
        if (adaptToBg) return;
        cpPopup.classList.add('active');
        cpBackdrop.classList.add('active');

        if (triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            let left = rect.right + 12;
            let top = rect.top - 80;
            if (left + 230 > window.innerWidth) left = rect.left - 230;
            if (top < 10) top = 10;
            if (top + 300 > window.innerHeight) top = window.innerHeight - 310;
            cpPopup.style.left = left + 'px';
            cpPopup.style.top = top + 'px';
        }
    }

    function hideColorPopup() {
        cpPopup.classList.remove('active');
        cpBackdrop.classList.remove('active');
    }

    colorPickerRow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (adaptToBg) return;
        if (cpPopup.classList.contains('active')) {
            hideColorPopup();
        } else {
            showColorPopup(settingsColorCircle);
        }
    });

    cpBackdrop.addEventListener('click', () => {
        hideColorPopup();
    });

    let svDragging = false;
    cpCanvas.addEventListener('mousedown', (e) => { svDragging = true; updateSv(e); });
    document.addEventListener('mousemove', (e) => { if (svDragging) updateSv(e); });
    document.addEventListener('mouseup', () => { svDragging = false; });
    function updateSv(e) {
        const rect = cpCanvas.getBoundingClientRect();
        let x = (e.clientX - rect.left)/rect.width*200, y = (e.clientY - rect.top)/rect.height*150;
        x = Math.max(0, Math.min(200, x)); y = Math.max(0, Math.min(150, y));
        cpSat = Math.round(x/200*100); cpVal = Math.round((1-y/150)*100);
        setColorFromHsv();
    }

    let hueDragging = false;
    cpHueBar.addEventListener('mousedown', (e) => { hueDragging = true; updateHue(e); });
    document.addEventListener('mousemove', (e) => { if (hueDragging) updateHue(e); });
    document.addEventListener('mouseup', () => { hueDragging = false; });
    function updateHue(e) {
        const rect = cpHueBar.getBoundingClientRect();
        let x = (e.clientX - rect.left)/rect.width*200;
        x = Math.max(0, Math.min(200, x));
        cpHue = Math.round(x/200*360);
        setColorFromHsv();
    }

    cpHexInput.addEventListener('change', () => setColorFromHex(cpHexInput.value));
    cpHexInput.addEventListener('blur', () => { cpHexInput.value = selectedAccentColor.toUpperCase(); });

    // ----- adaptation -----

    async function extractBgAccent(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(Math.floor(img.width*0.25), Math.floor(img.height*0.25), Math.floor(img.width*0.5), Math.floor(img.height*0.5)).data;
                let r=0,g=0,b=0,n=0;
                for (let i=0; i<d.length; i+=4) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; }
                resolve('#'+[r,g,b].map(c=>Math.round(c/n).toString(16).padStart(2,'0')).join(''));
            };
            img.src = dataUrl;
        });
    }

    async function updateAdaptation() {
        if (adaptToBg && useDynamicBg) {
            const bgUrl = dynamicBgEl.style.backgroundImage;
            if (bgUrl && bgUrl !== 'none' && bgUrl !== '') {
                const dataUrl = bgUrl.replace(/^url\(['"]?|['"]?\)$/g, '');
                const color = await extractBgAccent(dataUrl);
                applyAccentColor(color);
            }
        } else {
            applyAccentColor(selectedAccentColor);
        }
        updatePickerDisabled();
    }

    adaptBgToggle.addEventListener('change', () => {
        adaptToBg = adaptBgToggle.checked;
        localStorage.setItem('adaptToBg', adaptToBg);
        if (!adaptToBg) {
            cpPopup.classList.remove('active');
            cpBackdrop.classList.remove('active');
        }
        updateAdaptation();
    });

    function updateAdaptBgRow() {
        const disabled = !useDynamicBg;
        adaptBgRow.classList.toggle('disabled', disabled);
        adaptBgToggle.disabled = disabled;
    }

    // ----- background management -----

    const backgroundsList = document.getElementById('backgrounds-list');
    const importBgBtn = document.getElementById('import-bg-btn');

    const bgPreviewTooltip = document.getElementById('bg-preview-tooltip');
    const bgPreviewImg = document.getElementById('bg-preview-img');
    let previewTimeout;

    async function loadBackgroundsList() {
        const result = await window.api.listBackgrounds();
        if (result.error) return;

        backgroundsList.innerHTML = '';
        result.backgrounds.forEach(bg => {
            const row = document.createElement('div');
            row.className = 'background-item';
            row.dataset.bgName = bg.name;

            const label = document.createElement('span');
            label.textContent = bg.name;
            label.title = bg.name;

            const toggle = document.createElement('label');
            toggle.className = 'toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = bg.enabled;
            const slider = document.createElement('span');
            slider.className = 'toggle-slider';

            input.addEventListener('change', () => {
                window.api.toggleBackground(bg.name, input.checked);
            });

            toggle.appendChild(input);
            toggle.appendChild(slider);
            row.appendChild(label);
            row.appendChild(toggle);
            backgroundsList.appendChild(row);
        });

        updateBackgroundsDisabled();
    }

    backgroundsList.addEventListener('mouseover', async (e) => {
        const row = e.target.closest('.background-item');
        if (!row || !useDynamicBg) return;

        if (previewTimeout) clearTimeout(previewTimeout);

        const rect = row.getBoundingClientRect();
        bgPreviewTooltip.style.left = (rect.right + 12) + 'px';
        bgPreviewTooltip.style.top = Math.max(4, rect.top - 20) + 'px';

        const result = await window.api.getBackgroundFile(row.dataset.bgName);
        if (result.error) return;
        bgPreviewImg.src = result.dataUrl;
        bgPreviewTooltip.classList.add('active');
    });

    backgroundsList.addEventListener('mouseout', (e) => {
        if (e.target.closest('.background-item')) {
            previewTimeout = setTimeout(() => {
                bgPreviewTooltip.classList.remove('active');
            }, 120);
        }
    });

    bgPreviewTooltip.addEventListener('mouseenter', () => {
        if (previewTimeout) clearTimeout(previewTimeout);
    });

    bgPreviewTooltip.addEventListener('mouseleave', () => {
        bgPreviewTooltip.classList.remove('active');
    });

    function updateBackgroundsDisabled() {
        backgroundsList.classList.toggle('disabled', !useDynamicBg);
        importBgBtn.disabled = !useDynamicBg;
    }

    dynamicBgToggle.addEventListener('change', updateBackgroundsDisabled);

    importBgBtn.addEventListener('click', async () => {
        const result = await window.api.importBackground();
        if (result.error) {
            if (result.error !== 'cancelled') alert('Ошибка загрузки: ' + result.error);
            return;
        }
        await loadBackgroundsList();
        if (useDynamicBg) applyBackground();
    });

    loadBackgroundsList().then(() => updateBackgroundsDisabled());

    // ----- settings categories -----

    settingsCats.forEach(btn => {
        btn.addEventListener('click', () => {
            settingsCats.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            Object.values(settingsPanels).forEach(p => p.classList.remove('active'));
            const panel = settingsPanels[btn.dataset.cat];
            if (panel) panel.classList.add('active');
        });
    });

    // ----- general UI -----

    function setBlockUI(blocked) {
        document.body.classList.toggle('ui-blocked', blocked);
        changeDirBtn.disabled = blocked;
        resetDirBtn.disabled = blocked;
        settingsBtn.disabled = blocked;
        checkUpdatesBtn.disabled = blocked;
        checkClientUpdatesBtn.disabled = blocked;
        deleteGameBtn.disabled = blocked;
        verifyIntegrityBtn.disabled = blocked;
    }

    function setState(state) {
        currentState = state;
        updateUI();
    }

    function updateUI() {
        const isBusy = currentState === DOWNLOADING || currentState === PAUSED || currentState === GAME_RUNNING;
        setBlockUI(isBusy);
        verifyIntegrityBtn.style.display = (currentState === READY) ? '' : 'none';

        switch (currentState) {
            case IDLE:
                mainBtn.textContent = 'СКАЧАТЬ';
                mainBtn.disabled = false;
                mainBtn.style.display = '';
                updateBtn.style.display = 'none';
                break;
            case READY:
                mainBtn.textContent = 'ИГРАТЬ';
                mainBtn.disabled = false;
                mainBtn.style.display = '';
                updateBtn.style.display = 'none';
                break;
            case UPDATE_AVAILABLE:
                mainBtn.textContent = 'ИГРАТЬ';
                mainBtn.disabled = false;
                mainBtn.style.display = '';
                updateBtn.textContent = 'ОБНОВИТЬ';
                updateBtn.style.display = '';
                break;
            case DOWNLOADING:
                mainBtn.textContent = 'ПАУЗА';
                mainBtn.disabled = false;
                mainBtn.style.display = '';
                updateBtn.style.display = 'none';
                break;
            case PAUSED:
                mainBtn.textContent = 'ПРОДОЛЖИТЬ';
                mainBtn.disabled = false;
                mainBtn.style.display = '';
                updateBtn.style.display = 'none';
                break;
            case GAME_RUNNING:
                mainBtn.textContent = 'ИГРА...';
                mainBtn.disabled = true;
                mainBtn.style.display = '';
                updateBtn.style.display = 'none';
                break;
        }
    }

    function showProgress(show) {
        progressContainer.style.display = show ? 'flex' : 'none';
        if (!show) progressBarFill.style.width = '0%';
    }

    function setProgress(text, percent) {
        progressText.textContent = text;
        progressBarFill.style.width = Math.min(Math.max(percent, 0), 100) + '%';
    }

    async function checkInstallStatus() {
        const installed = await window.api.checkInstall(currentInstallPath);
        if (!installed) {
            setState(IDLE);
            return;
        }
        try {
            const result = await window.api.checkUpdate(currentInstallPath);
            setState(result.updateAvailable ? UPDATE_AVAILABLE : READY);
        } catch (e) {
            setState(READY);
        }
    }

    async function startInstallProcess() {
        const skipCheck = skipCheckToggle.checked;
        setState(DOWNLOADING);
        showProgress(true);
        setProgress('Подготовка...', 0);
        const result = await window.api.startUpdate(currentInstallPath, skipCheck);
        if (result.status === 'error') {
            showProgress(false);
            alert('Ошибка обновления: ' + result.message);
            await checkInstallStatus();
        }
    }

    checkInstallStatus();

    changeDirBtn.addEventListener('click', async () => {
        const selected = await window.api.selectDirectory();
        if (selected) {
            currentInstallPath = selected;
            updatePathDisplay();
            localStorage.setItem('installPath', currentInstallPath);
            await checkInstallStatus();
        }
    });

    resetDirBtn.addEventListener('click', async () => {
        if (currentInstallPath !== DEFAULT_INSTALL_PATH) {
            currentInstallPath = DEFAULT_INSTALL_PATH;
            updatePathDisplay();
            localStorage.setItem('installPath', currentInstallPath);
            await checkInstallStatus();
        }
    });

    mainBtn.addEventListener('click', async () => {
        if (mainBtn.disabled) return;

        switch (currentState) {
            case IDLE:
                await startInstallProcess();
                break;
            case READY:
            case UPDATE_AVAILABLE:
                if (window.api.launchGame(currentInstallPath)) {
                    setState(GAME_RUNNING);
                    window.api.setRpcActivity({ state: 'Играет на лучшем приватном сервере' });
                }
                break;
            case DOWNLOADING:
                setState(PAUSED);
                window.api.pauseUpdate();
                break;
            case PAUSED:
                setState(DOWNLOADING);
                window.api.resumeUpdate();
                break;
        }
    });

    updateBtn.addEventListener('click', async () => {
        if (currentState !== UPDATE_AVAILABLE) return;
        await startInstallProcess();
    });

    discordBtn.addEventListener('click', () => {
        window.api.openExternal('https://discord.gg/jd6EAGpaVg');
    });

    settingsBtn.addEventListener('click', () => {
        settingsOverlay.classList.add('active');
    });

    settingsClose.addEventListener('click', () => {
        settingsOverlay.classList.remove('active');
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove('active');
        }
    });

    checkUpdatesBtn.addEventListener('click', async () => {
        settingsOverlay.classList.remove('active');
        try {
            const result = await window.api.checkUpdate(currentInstallPath);
            if (result.error) {
                alert('Ошибка проверки: ' + result.error);
                return;
            }
            if (result.updateAvailable) {
                alert(`Доступно обновление игры: ${result.localVersion} -> ${result.remoteVersion}`);
                await checkInstallStatus();
            } else {
                alert('Установлена актуальная версия игры.');
            }
        } catch (err) {
            alert('Не удалось проверить обновления игры.');
        }
    });

    checkClientUpdatesBtn.addEventListener('click', async () => {
        settingsOverlay.classList.remove('active');
        try {
            const result = await window.api.checkForClientUpdates();
            if (result.error) {
                alert('Ошибка проверки обновлений клиента: ' + result.error);
                return;
            }
            if (result.available) {
                alert(`Доступно обновление клиента: ${result.currentVersion} -> ${result.remoteVersion}`);
            } else {
                alert(`Установлена актуальная версия клиента (${result.currentVersion}).`);
            }
        } catch (err) {
            alert('Не удалось проверить обновления клиента.');
        }
    });

    verifyIntegrityBtn.addEventListener('click', async () => {
        settingsOverlay.classList.remove('active');
        setBlockUI(true);
        showProgress(true);
        setProgress('Проверка целостности игры...', 0);
        try {
            const result = await window.api.verifyIntegrity(currentInstallPath);
            showProgress(false);

            if (result.success) {
                setBlockUI(false);
                alert(result.message);
            } else if (result.files && result.files.length > 0) {
                const doFix = confirm(result.message + '\n\nВосстановить повреждённые файлы?');
                if (doFix) {
                    showProgress(true);
                    setProgress('Восстановление файлов...', 0);
                    const fixResult = await window.api.fixFiles(currentInstallPath, result.files);
                    showProgress(false);
                    setBlockUI(false);
                    if (fixResult.success) {
                        alert(`Восстановлено ${fixResult.fixed} из ${fixResult.total} файлов.`);
                    } else {
                        alert('Ошибка восстановления: ' + fixResult.error);
                    }
                } else {
                    setBlockUI(false);
                }
            } else {
                setBlockUI(false);
                alert(result.message);
            }
        } catch (err) {
            showProgress(false);
            setBlockUI(false);
            alert('Ошибка проверки целостности игры.');
        }
    });

    deleteGameBtn.addEventListener('click', async () => {
        settingsOverlay.classList.remove('active');
        if (!confirm('Удалить все файлы игры?')) return;
        setBlockUI(true);
        const result = await window.api.deleteGame(currentInstallPath);
        if (result.success) {
            showProgress(false);
            setState(IDLE);
        } else {
            alert('Не удалось удалить игру. Возможно, файлы заняты другим процессом.\n\n' + result.error);
            await checkInstallStatus();
        }
    });

    window.api.onUpdateState((state) => {
        if (state === 'downloading') setState(DOWNLOADING);
    });

    window.api.onUpdateProgress((data) => {
        setProgress(data.text, data.percent);
    });

    window.api.onUpdateComplete(() => {
        showProgress(false);
        setState(READY);
    });

    window.api.onUpdateError((error) => {
        showProgress(false);
        alert('Ошибка обновления: ' + error);
        checkInstallStatus();
    });

    window.api.onGameClosed(() => {
        if (currentState === GAME_RUNNING) {
            setState(READY);
            window.api.setRpcActivity({ state: 'Просматривает клиент' });
        }
    });

    if (localStorage.getItem('justUpdated') === 'true') {
        localStorage.removeItem('justUpdated');
        alert('Установлена актуальная версия клиента.');
    }

    window.api.onAutoUpdaterStatus((data) => {
        if (data.status === 'downloaded') {
            localStorage.setItem('justUpdated', 'true');
            window.api.restartAndUpdate();
        }
    });

    window.api.onAutoUpdaterError((err) => {
        console.warn('Auto-updater error:', err);
    });
});
