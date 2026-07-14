document.addEventListener('DOMContentLoaded', () => {
    const mainBtn = document.getElementById('main-btn');
    const updateBtn = document.getElementById('update-btn');
    const installPathEl = document.getElementById('install-path');
    const changeDirBtn = document.getElementById('change-dir-btn');
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

    const IDLE = 'IDLE';
    const READY = 'READY';
    const UPDATE_AVAILABLE = 'UPDATE_AVAILABLE';
    const DOWNLOADING = 'DOWNLOADING';
    const PAUSED = 'PAUSED';
    const GAME_RUNNING = 'GAME_RUNNING';

    let currentState = IDLE;
    let currentInstallPath = localStorage.getItem('installPath') || 'C:\\Games\\CesiumGD';
    installPathEl.textContent = currentInstallPath;

    skipCheckToggle.checked = localStorage.getItem('skipCheck') === 'true';

    skipCheckToggle.addEventListener('change', () => {
        localStorage.setItem('skipCheck', skipCheckToggle.checked);
    });

    function setBlockUI(blocked) {
        document.body.classList.toggle('ui-blocked', blocked);
        changeDirBtn.disabled = blocked;
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
        if (!show) {
            progressBarFill.style.width = '0%';
        }
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
            if (result.updateAvailable) {
                setState(UPDATE_AVAILABLE);
            } else {
                setState(READY);
            }
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

    // --- Initial state ---
    checkInstallStatus();

    // --- Event listeners ---

    changeDirBtn.addEventListener('click', async () => {
        const selected = await window.api.selectDirectory();
        if (selected) {
            currentInstallPath = selected;
            installPathEl.textContent = currentInstallPath;
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

    // --- Settings ---

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
                alert(`Доступно обновление игры: ${result.localVersion} → ${result.remoteVersion}`);
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
                alert(`Доступно обновление клиента: ${result.currentVersion} → ${result.updateVersion}`);
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
        setProgress('Проверка целостности...', 0);
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
            alert('Ошибка проверки целостности.');
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

    // --- IPC events ---

    window.api.onUpdateState((state) => {
        if (state === 'downloading') {
            setState(DOWNLOADING);
        }
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
        }
    });

    // --- Auto-updater ---

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
