try {
  require('electron-reloader')(module);
} catch (err) {}

const electron = require('electron');
const AutoLaunch = require('auto-launch');
const { CronJob, CronTime } = require('cron');
const electronLocalshortcut = require('electron-localshortcut');
const icon = require('./icon');
const store = require('./store');
const pjson = require('../package.json');
const wip = require('./wip');
const debug = require('electron-debug');
const ipc = require('electron-better-ipc');
const logger = require('electron-timber');

debug();

wip.setDevMode(store.get('development'));
wip.setApiKey(store.get('oauth.access_token'));

const {
  app,
  globalShortcut,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  shell,
  Tray,
} = electron;

app.on('ready', () => {
  logger.log('App ready');
  logger.log('Using access token:', store.get('oauth.access_token'));

  const autoLauncher = new AutoLaunch({ name: pjson.name });
  const tray = new Tray(icon.done);
  let composeWindow = null;
  let preferencesWindow = null;

  // Create the Application's main menu
  var template = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'About Application',
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: function() {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          selector: 'selectAll:',
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  function registerGlobalShortcut() {
    logger.log('registerGlobalShortcut()');
    try {
      const ret = globalShortcut.register(store.get('shortcut'), () => {
        onComposeClick();
      });
      if (!ret) {
        logger.error('registration failed');
      }
    } catch (error) {
      // Probably invalid shortcut
      logger.error(error);
    }
  }

  function unregisterGlobalShortcut() {
    logger.log('unregisterGlobalShortcut()');
    try {
      globalShortcut.unregister(store.get('shortcut'));
    } catch (error) {
      // Probably invalid (previous) shortcut
      logger.error(error);
    }
  }

  registerGlobalShortcut();

  function createComposeWindow() {
    composeWindow = new BrowserWindow({
      width: 600,
      height: 300,
      frame: false,
      show: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      transparent: true,
      alwaysOnTop: true,
      webPreferences: {
        devTools: true,
        nodeIntegration: true,
      },
    });

    composeWindow.loadURL(`file://${__dirname}/compose/compose.html`);

    composeWindow.on('ready-to-show', () => {
      composeWindow.show();
    });

    // Hide window when it loses focus
    // composeWindow.on('blur', event => {
    //   composeWindow.close();
    // });

    composeWindow.on('closed', () => {
      composeWindow = null;
    });

    electronLocalshortcut.register(composeWindow, 'Esc', () => {
      composeWindow.close();
    });
  }

  function onComposeClick() {
    if (composeWindow === null) {
      return createComposeWindow();
    }
    composeWindow.focus();
  }

  function createOAuthWindow() {
    logger.log('createOAuthWindow()');

    let oauthWindow = new BrowserWindow({
      backgroundColor: "#000000",
      title: `${pjson.name} - OAuth`,
      width: 400,
      height: 240,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: true,
      webPreferences: {
        nodeIntegration: true,
      },
    });

    oauthWindow.loadURL(
      `file://${__dirname}/oauth/oauth.html`,
    );

    oauthWindow.on('ready-to-show', () => {
      oauthWindow.show();
      if (process.platform === 'darwin') {
        app.dock.show();
      }
    });

    oauthWindow.on('closed', () => {
      oauthWindow = null;
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    });
  }

  function createPreferencesWindow() {
    preferencesWindow = new BrowserWindow({
      title: `${pjson.name} - Preferences`,
      width: 300,
      height: 455,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
      },
    });

    preferencesWindow.loadURL(
      `file://${__dirname}/preferences/preferences.html`,
    );

    preferencesWindow.on('ready-to-show', () => {
      preferencesWindow.show();
      if (process.platform === 'darwin') {
        app.dock.show();
      }
    });

    preferencesWindow.on('closed', () => {
      preferencesWindow = null;
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    });
  }

  function onPreferencesClick() {
    if (preferencesWindow === null) {
      return createPreferencesWindow();
    }
    preferencesWindow.focus();
  }

  function createTrayMenu() {
    const wipProfileUrl = `https://wip.chat/@${store.get('viewer.username')}`;

    let menuTemplate = new Array();

    if (store.get('development')) {
      menuTemplate.push({ label: 'Development Mode', enabled: false });
    }

    menuTemplate = menuTemplate.concat([
      {
        label: store.get('viewer.username'),
        click: () => shell.openExternal(wipProfileUrl),
        accelerator: 'CmdOrCtrl+O',
      },
      { type: 'separator' },
      {
        label: 'New Todo...',
        accelerator: store.get('shortcut'),
        click: onComposeClick,
      },
    ]);

    if (Array.isArray(store.get('viewer.products'))) {
      let submenu = new Array();

      store.get('viewer.products').forEach(function(product) {
        submenu.push({
          label: product.name,
          click: () => shell.openExternal(product.url),
        });
      });

      menuTemplate.push({ label: 'Products', submenu: submenu });
    }

    menuTemplate = menuTemplate.concat([
      { type: 'separator' },
      {
        label: `Open Chat…`,
        click: () => shell.openExternal(`tg://resolve?domain=wipchat`),
      },
      {
        label: `Open Questions…`,
        click: () => shell.openExternal(`https://wip.chat/questions`),
      },
      { type: 'separator' },
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: requestViewerData,
      },
      {
        label: 'Preferences...',
        accelerator: 'CmdOrCtrl+,',
        click: onPreferencesClick,
      },
      { type: 'separator' },
    ]);

    if (store.get('viewer.streaking')) {
      menuTemplate.push({ label: `You shipped today.`, enabled: false });
    } else {
      menuTemplate.push({ label: `Time Left: ${timeLeft()}`, enabled: false });
    }

    menuTemplate = menuTemplate.concat([
      { label: `Current Streak: ${store.get('viewer.currentStreak')}`, enabled: false },
      { label: `Best Streak: ${store.get('viewer.bestStreak')}`, enabled: false },
      { type: 'separator' },
    ]);

    menuTemplate = menuTemplate.concat([
      {
        label: `Quit`,
        accelerator: 'CmdOrCtrl+Q',
        click: () => app.quit(),
      },
    ]);

    return Menu.buildFromTemplate(menuTemplate);
  }

  function reloadTray(success) {
    if (success) {
      tray.setImage(icon.load);
      tray.setContextMenu(createTrayMenu());
      tray.setImage(store.get('viewer.streaking') ? icon.done : icon.todo);
    } else {
      tray.setContextMenu(createTrayMenu('Error', 'Error', 'Error', 'Error'));
      tray.setImage(icon.fail);
    }
  }

  function requestViewerData() {
    logger.log('requestViewerData()');
    return new Promise((resolve, reject) => {
      setTimeout(requestViewerData, 1000 * 60 * store.get('syncInterval'));

      if(!store.get('oauth')) {
        logger.warn('Aborting! No OAuth token present');
        reject();
      }

      wip.viewer()
        .then(data => {
          store.set('viewer', data);
          reloadTray(true);
          return resolve();
        })
        .catch(() => {
          // TODO: clear viewer data?
          reloadTray(false);
          return reject();
        });
    });
  }

  // Unregisters current shortcut, sets shortcut variable to new choice, and
  // finally registers the new shortcut.
  //
  // TODO: Verify shortcut is valid format
  async function setShortcut(event, shortcut) {
    unregisterGlobalShortcut();
    store.set('shortcut', shortcut);
    registerGlobalShortcut();
  }

  ipc.answerRenderer('fetchPendingTodos', async filter => {
    return await wip.pendingTodos(filter);
  });

  async function setAuthorizationCode(event, authorization_code) {
    try {
      console.log('getting access token');
      const oauth = await wip.getAccessToken(authorization_code);
      console.log(oauth);
      store.set('oauth', oauth);
      wip.setApiKey(store.get('oauth.access_token'));
      await requestViewerData();
      const data = { success: true, firstName: store.get('viewer.firstName'), shortcut: store.get('shortcut') };
      event.sender.send('authorizationCodeSet', data);
    } catch (error) {
      const data = { succcess: false };
      event.sender.send('authorizationCodeSet', data);
    }
  }

  function timeLeft() {
    const now = new Date();

    let midnight = new Date(now.valueOf());
    midnight.setHours(24);
    midnight.setMinutes(0 - now.getTimezoneOffset());
    midnight.setSeconds(0);
    midnight.setMilliseconds(0);

    const timeDifference = midnight.getTime() - now.getTime();

    const minutes = Math.floor(timeDifference / 60000);
    const hours = Math.floor(minutes / 60);

    let output = `${hours % 24}`;
    output += hours % 24 == 1 ? ` hour` : ` hours`;
    output += `, ${minutes % 60}`;
    output += minutes % 60 == 1 ? ` minute` : ` minutes`;

    return output;
  }

  function setSyncInterval(event, interval) {
    store.set('syncInterval', interval);
    event.sender.send('syncIntervalSet');
  }

  function activateLaunchAtLogin(event, isEnabled) {
    store.set('autoLaunch', isEnabled);
    isEnabled ? autoLauncher.enable() : autoLauncher.disable();
    event.sender.send('activateLaunchAtLoginSet');
  }

  function activateDevelopmentMode(event, isEnabled) {
    store.set('development', isEnabled);

    // Set WIP dev mode
    wip.devMode = isEnabled;

    // Reload menubar
    requestViewerData();

    event.sender.send('activateDevelopmentModeSet');
  }

  function activateNotifications(event, isEnabled) {
    store.set('notification.isEnabled', isEnabled);
    if (isEnabled) {
      const time = store.get('notification.time');
      const timeArray = time.split(':');
      const cronTime = `0 ${timeArray[1]} ${timeArray[0]} * * *`;
      job.setTime(new CronTime(cronTime));
      job.start();
    } else {
      job.stop();
    }
    event.sender.send('activateNotificationsSet');
  }

  function setNotificationTime(event, time) {
    store.set('notification.time', time);
    const timeArray = time.split(':');
    const cronTime = `0 ${timeArray[1]} ${timeArray[0]} * * *`;
    job.setTime(new CronTime(cronTime));
    job.start();
    event.sender.send('NotificationTimeSet');
  }

  async function createTodo(event, value, attachments) {
    const completed = !value.match(/^\/todo\b/i);
    value = value.replace(/^\/(todo|done)\b/i, '');
    var todo = wip.createTodo(value, completed, attachments);
    event.sender.send('todoSaved');

    todo.then(result => {
      logger.log(result.id);
    });

    todo.catch(() => {
      logger.error('oops');
    });
  }

  async function completeTodo(event, todo_id, attachments) {
    var todo = wip.completeTodo(todo_id, attachments);
    event.sender.send('todoSaved');

    todo.then(result => {
      logger.log(result.id);
    });

    todo.catch(() => {
      logger.error('oops');
    });
  }

  async function resetOAuth(event) {
    logger.log('resetOAuth()');

    // Clear out store
    store.set('oauth', {});
    store.set('viewer', {});

    // Unset WIP API Key
    wip.setApiKey(null);

    // Reload menu
    requestViewerData();

    // Ask for new OAuth
    createOAuthWindow();

    // Close Preferences Window
    preferencesWindow.close();
  }

  const job = new CronJob({
    cronTime: '0 0 20 00 * *',
    async onTick() {
      const data = await wip.viewer();
      if (!data.streaking && Notification.isSupported()) {
        new Notification({
          title: pjson.name,
          body: "You haven't yet shipped today",
        }).show();
      }
    },
  });

  if (store.get('notification.isEnabled')) {
    const time = store.get('notification.time');
    const timeArray = time.split(':');
    const cronTime = `0 ${timeArray[1]} ${timeArray[0]} * * *`;
    job.setTime(new CronTime(cronTime));
    job.start();
  }

  process.on('uncaughtException', () => {
    tray.setContextMenu(createTrayMenu('Error', 'Error', 'Error', 'Error'));
    tray.setImage(icon.fail);
  });

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  app.on('window-all-closed', () => {});
  tray.on('right-click', requestViewerData);
  ipcMain.on('setAuthorizationCode', setAuthorizationCode);
  ipcMain.on('setShortcut', setShortcut);
  ipcMain.on('setSyncInterval', setSyncInterval);
  ipcMain.on('activateLaunchAtLogin', activateLaunchAtLogin);
  ipcMain.on('activateDevelopmentMode', activateDevelopmentMode);
  ipcMain.on('activateNotifications', activateNotifications);
  ipcMain.on('setNotificationTime', setNotificationTime);
  ipcMain.on('createTodo', createTodo);
  ipcMain.on('completeTodo', completeTodo);
  ipcMain.on('resetOAuth', resetOAuth);

  if (!store.get('oauth.access_token')) {
    // Ask user to connect
    createOAuthWindow();
  } else {
    // Load all data
    requestViewerData();
  }
});
