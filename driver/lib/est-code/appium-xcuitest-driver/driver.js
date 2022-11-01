"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.XCUITestDriver = void 0;

require("source-map-support/register");

var _driver = require("appium/driver");

var _support = require("appium/support");

var _lodash = _interopRequireDefault(require("lodash"));

var _url = _interopRequireDefault(require("url"));

var _appiumWebdriveragent = require("appium-webdriveragent");

var _lruCache = _interopRequireDefault(require("lru-cache"));

var _simulatorManagement = require("./simulator-management");

var _appiumIosSimulator = require("appium-ios-simulator");

var _certUtils = require("./cert-utils");

var _asyncbox = require("asyncbox");

var _appUtils = require("./app-utils");

var _desiredCaps = require("./desired-caps");

var _index = _interopRequireDefault(require("./commands/index"));

var _utils = require("./utils");

var _realDeviceManagement = require("./real-device-management");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _asyncLock = _interopRequireDefault(require("async-lock"));

var _path = _interopRequireDefault(require("path"));

var _appiumIdb = _interopRequireDefault(require("appium-idb"));

var _deviceConnectionsFactory = _interopRequireDefault(require("./device-connections-factory"));

var _pyIosDeviceClient = _interopRequireDefault(require("./py-ios-device-client"));

const SHUTDOWN_OTHER_FEAT_NAME = 'shutdown_other_sims';
const CUSTOMIZE_RESULT_BUNDPE_PATH = 'customize_result_bundle_path';
const SUPPORTED_EXTENSIONS = [_appUtils.IPA_EXT, _appUtils.APP_EXT];
const MAX_ARCHIVE_SCAN_DEPTH = 1;
const defaultServerCaps = {
  webStorageEnabled: false,
  locationContextEnabled: false,
  browserName: '',
  platform: 'MAC',
  javascriptEnabled: true,
  databaseEnabled: false,
  takesScreenshot: true,
  networkConnectionEnabled: false
};
const WDA_SIM_STARTUP_RETRIES = 2;
const WDA_REAL_DEV_STARTUP_RETRIES = 1;
const WDA_REAL_DEV_TUTORIAL_URL = 'https://github.com/appium/appium-xcuitest-driver/blob/master/docs/real-device-config.md';
const WDA_STARTUP_RETRY_INTERVAL = 10000;
const DEFAULT_SETTINGS = {
  nativeWebTap: false,
  nativeWebTapStrict: false,
  useJSONSource: false,
  shouldUseCompactResponses: true,
  elementResponseAttributes: 'type,label',
  mjpegServerScreenshotQuality: 25,
  mjpegServerFramerate: 10,
  screenshotQuality: 1,
  mjpegScalingFactor: 100,
  reduceMotion: null
};
const SHARED_RESOURCES_GUARD = new _asyncLock.default();
const WEB_ELEMENTS_CACHE_SIZE = 500;
const NO_PROXY_NATIVE_LIST = [['DELETE', /window/], ['GET', /^\/session\/[^\/]+$/], ['GET', /alert_text/], ['GET', /alert\/[^\/]+/], ['GET', /appium/], ['GET', /attribute/], ['GET', /context/], ['GET', /location/], ['GET', /log/], ['GET', /screenshot/], ['GET', /size/], ['GET', /source/], ['GET', /timeouts$/], ['GET', /url/], ['GET', /window/], ['POST', /accept_alert/], ['POST', /actions$/], ['POST', /alert_text/], ['POST', /alert\/[^\/]+/], ['POST', /appium/], ['POST', /appium\/device\/is_locked/], ['POST', /appium\/device\/lock/], ['POST', /appium\/device\/unlock/], ['POST', /back/], ['POST', /clear/], ['POST', /context/], ['POST', /dismiss_alert/], ['POST', /element\/active/], ['POST', /element$/], ['POST', /elements$/], ['POST', /execute/], ['POST', /keys/], ['POST', /log/], ['POST', /moveto/], ['POST', /receive_async_response/], ['POST', /session\/[^\/]+\/location/], ['POST', /shake/], ['POST', /timeouts/], ['POST', /touch/], ['POST', /url/], ['POST', /value/], ['POST', /window/], ['DELETE', /cookie/], ['GET', /cookie/], ['POST', /cookie/]];
const NO_PROXY_WEB_LIST = [['GET', /attribute/], ['GET', /element/], ['GET', /text/], ['GET', /title/], ['POST', /clear/], ['POST', /click/], ['POST', /element/], ['POST', /forward/], ['POST', /frame/], ['POST', /keys/], ['POST', /refresh/]].concat(NO_PROXY_NATIVE_LIST);
const MEMOIZED_FUNCTIONS = ['getStatusBarHeight', 'getDevicePixelRatio', 'getScreenInfo'];

class XCUITestDriver extends _driver.BaseDriver {
  constructor(opts = {}, shouldValidateCaps = true) {
    super(opts, shouldValidateCaps);
    this.desiredCapConstraints = _desiredCaps.desiredCapConstraints;
    this.locatorStrategies = ['xpath', 'id', 'name', 'class name', '-ios predicate string', '-ios class chain', 'accessibility id', 'css selector'];
    this.webLocatorStrategies = ['link text', 'css selector', 'tag name', 'link text', 'partial link text'];
    this.resetIos();
    this.settings = new _driver.DeviceSettings(DEFAULT_SETTINGS, this.onSettingsUpdate.bind(this));
    this.logs = {};

    for (const fn of MEMOIZED_FUNCTIONS) {
      this[fn] = _lodash.default.memoize(this[fn]);
    }
  }

  async onSettingsUpdate(key, value) {
    if (key !== 'nativeWebTap' && key !== 'nativeWebTapStrict') {
      return await this.proxyCommand('/appium/settings', 'POST', {
        settings: {
          [key]: value
        }
      });
    }

    this.opts[key] = !!value;
  }

  resetIos() {
    this.opts = this.opts || {};
    this.wda = null;
    this.opts.device = null;
    this.jwpProxyActive = false;
    this.proxyReqRes = null;
    this.jwpProxyAvoid = [];
    this.safari = false;
    this.cachedWdaStatus = null;
    this.curWebFrames = [];
    this._currentUrl = null;
    this.curContext = null;
    this.xcodeVersion = {};
    this.contexts = [];
    this.implicitWaitMs = 0;
    this.asynclibWaitMs = 0;
    this.pageLoadMs = 6000;
    this.landscapeWebCoordsOffset = 0;
    this.remote = null;
    this._conditionInducerService = null;
    this.webElementsCache = new _lruCache.default({
      max: WEB_ELEMENTS_CACHE_SIZE
    });
  }

  get driverData() {
    return {};
  }

  async getStatus() {
    if (typeof this.driverInfo === 'undefined') {
      this.driverInfo = await (0, _utils.getDriverInfo)();
    }

    let status = {
      build: {
        version: this.driverInfo.version
      }
    };

    if (this.cachedWdaStatus) {
      status.wda = this.cachedWdaStatus;
    }

    return status;
  }

  mergeCliArgsToOpts() {
    let didMerge = false;

    for (const [key, value] of Object.entries(this.cliArgs ?? {})) {
      if (_lodash.default.has(this.opts, key)) {
        this.log.info(`CLI arg '${key}' with value '${value}' overwrites value '${this.opts[key]}' sent in via caps)`);
        didMerge = true;
      }

      this.opts[key] = value;
    }

    return didMerge;
  }

  async createSession(...args) {
    this.lifecycleData = {};

    try {
      let [sessionId, caps] = await super.createSession(...args);
      this.opts.sessionId = sessionId;

      if (this.mergeCliArgsToOpts()) {
        this.validateDesiredCaps({ ...caps,
          ...this.cliArgs
        });
      }

      await this.start();
      caps = Object.assign({}, defaultServerCaps, caps);
      caps.udid = this.opts.udid;

      if (_lodash.default.has(this.opts, 'nativeWebTap')) {
        await this.updateSettings({
          nativeWebTap: this.opts.nativeWebTap
        });
      }

      if (_lodash.default.has(this.opts, 'nativeWebTapStrict')) {
        await this.updateSettings({
          nativeWebTapStrict: this.opts.nativeWebTapStrict
        });
      }

      if (_lodash.default.has(this.opts, 'useJSONSource')) {
        await this.updateSettings({
          useJSONSource: this.opts.useJSONSource
        });
      }

      let wdaSettings = {
        elementResponseAttributes: DEFAULT_SETTINGS.elementResponseAttributes,
        shouldUseCompactResponses: DEFAULT_SETTINGS.shouldUseCompactResponses
      };

      if (_lodash.default.has(this.opts, 'elementResponseAttributes')) {
        wdaSettings.elementResponseAttributes = this.opts.elementResponseAttributes;
      }

      if (_lodash.default.has(this.opts, 'shouldUseCompactResponses')) {
        wdaSettings.shouldUseCompactResponses = this.opts.shouldUseCompactResponses;
      }

      if (_lodash.default.has(this.opts, 'mjpegServerScreenshotQuality')) {
        wdaSettings.mjpegServerScreenshotQuality = this.opts.mjpegServerScreenshotQuality;
      }

      if (_lodash.default.has(this.opts, 'mjpegServerFramerate')) {
        wdaSettings.mjpegServerFramerate = this.opts.mjpegServerFramerate;
      }

      if (_lodash.default.has(this.opts, 'screenshotQuality')) {
        this.log.info(`Setting the quality of phone screenshot: '${this.opts.screenshotQuality}'`);
        wdaSettings.screenshotQuality = this.opts.screenshotQuality;
      }

      await this.updateSettings(wdaSettings);

      if (this.opts.mjpegScreenshotUrl) {
        this.log.info(`Starting MJPEG stream reading URL: '${this.opts.mjpegScreenshotUrl}'`);
        this.mjpegStream = new _support.mjpeg.MJpegStream(this.opts.mjpegScreenshotUrl);
        await this.mjpegStream.start();
      }

      return [sessionId, caps];
    } catch (e) {
      this.log.error(JSON.stringify(e));
      await this.deleteSession();
      throw e;
    }
  }

  getDefaultUrl() {
    return this.isRealDevice() ? `http://127.0.0.1:${this.opts.wdaLocalPort || 8100}/health` : `http://${this.opts.address.includes(':') ? `[${this.opts.address}]` : this.opts.address}:${this.opts.port}/welcome`;
  }

  async start() {
    this.opts.noReset = !!this.opts.noReset;
    this.opts.fullReset = !!this.opts.fullReset;
    await (0, _utils.printUser)();
    this.opts.iosSdkVersion = null;
    const {
      device,
      udid,
      realDevice
    } = await this.determineDevice();
    this.log.info(`Determining device to run tests on: udid: '${udid}', real device: ${realDevice}`);
    this.opts.device = device;
    this.opts.udid = udid;
    this.opts.realDevice = realDevice;

    if (this.opts.simulatorDevicesSetPath) {
      if (realDevice) {
        this.log.info(`The 'simulatorDevicesSetPath' capability is only supported for Simulator devices`);
      } else {
        this.log.info(`Setting simulator devices set path to '${this.opts.simulatorDevicesSetPath}'`);
        this.opts.device.devicesSetPath = this.opts.simulatorDevicesSetPath;
      }
    }

    if (!this.opts.platformVersion && this.opts.device) {
      this.opts.platformVersion = await this.opts.device.getPlatformVersion();
      this.log.info(`No platformVersion specified. Using device version: '${this.opts.platformVersion}'`);
    }

    const normalizedVersion = (0, _utils.normalizePlatformVersion)(this.opts.platformVersion);

    if (this.opts.platformVersion !== normalizedVersion) {
      this.log.info(`Normalized platformVersion capability value '${this.opts.platformVersion}' to '${normalizedVersion}'`);
      this.opts.platformVersion = normalizedVersion;
    }

    if (_support.util.compareVersions(this.opts.platformVersion, '<', '9.3')) {
      throw new Error(`Platform version must be 9.3 or above. '${this.opts.platformVersion}' is not supported.`);
    }

    if (_lodash.default.isEmpty(this.xcodeVersion) && (!this.opts.webDriverAgentUrl || !this.opts.realDevice)) {
      this.xcodeVersion = await (0, _utils.getAndCheckXcodeVersion)();
    }

    this.logEvent('xcodeDetailsRetrieved');

    if (_lodash.default.toLower(this.opts.browserName) === 'safari') {
      this.log.info('Safari test requested');
      this.safari = true;
      this.opts.app = undefined;
      this.opts.processArguments = this.opts.processArguments || {};
      this.opts.bundleId = _appUtils.SAFARI_BUNDLE_ID;
      this._currentUrl = this.opts.safariInitialUrl || this.getDefaultUrl();
    } else if (this.opts.app || this.opts.bundleId) {
      await this.configureApp();
    }

    this.logEvent('appConfigured');

    if (this.opts.app) {
      await (0, _utils.checkAppPresent)(this.opts.app);

      if (!this.opts.bundleId) {
        this.opts.bundleId = await (0, _appUtils.extractBundleId)(this.opts.app);
      }
    }

    await this.runReset();
    this.wda = new _appiumWebdriveragent.WebDriverAgent(this.xcodeVersion, this.opts, this.log);
    this.wda.retrieveDerivedDataPath().catch(e => this.log.debug(e));

    const memoizedLogInfo = _lodash.default.memoize(() => {
      this.log.info("'skipLogCapture' is set. Skipping starting logs such as crash, system, safari console and safari network.");
    });

    const startLogCapture = async () => {
      if (this.opts.skipLogCapture) {
        memoizedLogInfo();
        return false;
      }

      const result = await this.startLogCapture();

      if (result) {
        this.logEvent('logCaptureStarted');
      }

      return result;
    };

    const isLogCaptureStarted = await startLogCapture();
    this.log.info(`Setting up ${this.isRealDevice() ? 'real device' : 'simulator'}`);

    if (this.isSimulator()) {
      if (this.opts.shutdownOtherSimulators) {
        this.ensureFeatureEnabled(SHUTDOWN_OTHER_FEAT_NAME);
        await (0, _simulatorManagement.shutdownOtherSimulators)(this.opts.device);
      }

      if (this.isSafari() && this.opts.safariGlobalPreferences) {
        if (await this.opts.device.updateSafariGlobalSettings(this.opts.safariGlobalPreferences)) {
          this.log.debug(`Safari global preferences updated`);
        }
      }

      this.localConfig = await (0, _simulatorManagement.setLocaleAndPreferences)(this.opts.device, this.opts, this.isSafari(), async sim => {
        await (0, _simulatorManagement.shutdownSimulator)(sim);
        await (0, _simulatorManagement.setLocaleAndPreferences)(sim, this.opts, this.isSafari());
      });

      if (this.opts.customSSLCert && !(await (0, _certUtils.doesSupportKeychainApi)(this.opts.device))) {
        const certHead = _lodash.default.truncate(this.opts.customSSLCert, {
          length: 20
        });

        this.log.info(`Installing the custom SSL certificate '${certHead}'`);

        if (await (0, _certUtils.hasCertificateLegacy)(this.opts.device, this.opts.customSSLCert)) {
          this.log.info(`SSL certificate '${certHead}' already installed`);
        } else {
          this.log.info(`Making sure Simulator is shut down, ' +
            'so that SSL certificate installation takes effect`);
          await (0, _simulatorManagement.shutdownSimulator)(this.opts.device);
          await (0, _certUtils.installCertificateLegacy)(this.opts.device, this.opts.customSSLCert);
        }

        this.logEvent('customCertInstalled');
      }

      await this.startSim();

      if (this.opts.customSSLCert && (await (0, _certUtils.doesSupportKeychainApi)(this.opts.device))) {
        await (0, _certUtils.installCertificate)(this.opts.device, this.opts.customSSLCert);
        this.logEvent('customCertInstalled');
      }

      if (this.opts.launchWithIDB && this.isSimulator()) {
        try {
          const idb = new _appiumIdb.default({
            udid
          });
          await idb.connect();
          this.opts.device.idb = idb;
        } catch (e) {
          this.log.info(`idb will not be used for Simulator interaction. Original error: ${e.message}`);
        }
      }

      this.logEvent('simStarted');

      if (!isLogCaptureStarted) {
        await startLogCapture();
      }
    } else if (this.opts.customSSLCert) {
      await new _pyIosDeviceClient.default(udid).installProfile({
        payload: this.opts.customSSLCert
      });
    }

    if (this.opts.app) {
      await this.installAUT();
      this.logEvent('appInstalled');
    }

    if (!this.opts.app && this.opts.bundleId && !this.isSafari()) {
      if (!(await this.opts.device.isAppInstalled(this.opts.bundleId))) {
        this.log.errorAndThrow(`App with bundle identifier '${this.opts.bundleId}' unknown`);
      }
    }

    if (this.opts.permissions) {
      if (this.isSimulator()) {
        this.log.debug('Setting the requested permissions before WDA is started');

        for (const [bundleId, permissionsMapping] of _lodash.default.toPairs(JSON.parse(this.opts.permissions))) {
          await this.opts.device.setPermissions(bundleId, permissionsMapping);
        }
      } else {
        this.log.warn('Setting permissions is only supported on Simulator. ' + 'The "permissions" capability will be ignored.');
      }
    }

    if (this.isSimulator()) {
      if (this.opts.calendarAccessAuthorized) {
        await this.opts.device.enableCalendarAccess(this.opts.bundleId);
      } else if (this.opts.calendarAccessAuthorized === false) {
        await this.opts.device.disableCalendarAccess(this.opts.bundleId);
      }
    }

    await this.startWda(this.opts.sessionId, realDevice);
    await this.setReduceMotion(this.opts.reduceMotion);
    await this.setInitialOrientation(this.opts.orientation);
    this.logEvent('orientationSet');

    if (this.isSafari() || this.opts.autoWebview) {
      await this.activateRecentWebview();
    }

    if (this.isSafari()) {
      if (!(this.opts.safariInitialUrl === '' || this.opts.noReset && _lodash.default.isNil(this.opts.safariInitialUrl))) {
        this.log.info(`About to set the initial Safari URL to '${this.getCurrentUrl()}'.` + `Use 'safariInitialUrl' capability in order to customize it`);
        await this.setUrl(this.getCurrentUrl());
      } else {
        this.setCurrentUrl(await this.getUrl());
      }
    }
  }

  async startWda(sessionId, realDevice) {
    if (!_support.util.hasValue(this.wda.webDriverAgentUrl)) {
      await this.wda.cleanupObsoleteProcesses();
    }

    const usePortForwarding = this.isRealDevice() && !this.wda.webDriverAgentUrl && (0, _utils.isLocalHost)(this.wda.wdaBaseUrl);
    await _deviceConnectionsFactory.default.requestConnection(this.opts.udid, this.wda.url.port, {
      devicePort: usePortForwarding ? this.wda.wdaRemotePort : null,
      usePortForwarding
    });
    let synchronizationKey = XCUITestDriver.name;

    if (this.opts.useXctestrunFile || !(await this.wda.isSourceFresh())) {
      const derivedDataPath = await this.wda.retrieveDerivedDataPath();

      if (derivedDataPath) {
        synchronizationKey = _path.default.normalize(derivedDataPath);
      }
    }

    this.log.debug(`Starting WebDriverAgent initialization with the synchronization key '${synchronizationKey}'`);

    if (SHARED_RESOURCES_GUARD.isBusy() && !this.opts.derivedDataPath && !this.opts.bootstrapPath) {
      this.log.debug(`Consider setting a unique 'derivedDataPath' capability value for each parallel driver instance ` + `to avoid conflicts and speed up the building process`);
    }

    return await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
      if (this.opts.useNewWDA) {
        this.log.debug(`Capability 'useNewWDA' set to true, so uninstalling WDA before proceeding`);
        await this.wda.quitAndUninstall();
        this.logEvent('wdaUninstalled');
      } else if (!_support.util.hasValue(this.wda.webDriverAgentUrl)) {
        await this.wda.setupCaching();
      }

      const quitAndUninstall = async msg => {
        this.log.debug(msg);

        if (this.opts.webDriverAgentUrl) {
          this.log.debug('Not quitting/uninstalling WebDriverAgent since webDriverAgentUrl capability is provided');
          throw new Error(msg);
        }

        this.log.warn('Quitting and uninstalling WebDriverAgent');
        await this.wda.quitAndUninstall();
        throw new Error(msg);
      };

      if (this.opts.resultBundlePath) {
        this.ensureFeatureEnabled(CUSTOMIZE_RESULT_BUNDPE_PATH);
      }

      const startupRetries = this.opts.wdaStartupRetries || (this.isRealDevice() ? WDA_REAL_DEV_STARTUP_RETRIES : WDA_SIM_STARTUP_RETRIES);
      const startupRetryInterval = this.opts.wdaStartupRetryInterval || WDA_STARTUP_RETRY_INTERVAL;
      this.log.debug(`Trying to start WebDriverAgent ${startupRetries} times with ${startupRetryInterval}ms interval`);

      if (!_support.util.hasValue(this.opts.wdaStartupRetries) && !_support.util.hasValue(this.opts.wdaStartupRetryInterval)) {
        this.log.debug(`These values can be customized by changing wdaStartupRetries/wdaStartupRetryInterval capabilities`);
      }

      let retryCount = 0;
      await (0, _asyncbox.retryInterval)(startupRetries, startupRetryInterval, async () => {
        this.logEvent('wdaStartAttempted');

        if (retryCount > 0) {
          this.log.info(`Retrying WDA startup (${retryCount + 1} of ${startupRetries})`);
        }

        try {
          const retries = this.xcodeVersion.major >= 10 ? 2 : 1;
          this.cachedWdaStatus = await (0, _asyncbox.retry)(retries, this.wda.launch.bind(this.wda), sessionId, realDevice);
        } catch (err) {
          this.logEvent('wdaStartFailed');
          retryCount++;
          let errorMsg = `Unable to launch WebDriverAgent because of xcodebuild failure: ${err.message}`;

          if (this.isRealDevice()) {
            errorMsg += `. Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` + `Try to remove the WebDriverAgentRunner application from the device if it is installed ` + `and reboot the device.`;
          }

          await quitAndUninstall(errorMsg);
        }

        this.proxyReqRes = this.wda.proxyReqRes.bind(this.wda);
        this.jwpProxyActive = true;
        let originalStacktrace = null;

        //----------EST CODE----------
        //----------------------------

        const args = this.opts.processArguments ? this.opts.processArguments.args || [] : [];

        if (!_lodash.default.isArray(args)) {
          throw new Error(`processArguments.args capability is expected to be an array. ` + `${JSON.stringify(args)} is given instead`);
        }

        if (_support.util.hasValue(this.opts.language)) {
          args.push('-AppleLanguages', `(${this.opts.language})`);
          args.push('-NSLanguages', `(${this.opts.language})`);
        }

        if (_support.util.hasValue(this.opts.locale)) {
          args.push('-AppleLocale', this.opts.locale);
        }

        try {
          await this.opts.device.launchApp(this.opts.app, args);
        } catch (err) {
          _logger.default.debug(`Failed to launch app (${err.message}).`);
        }

        //----------------------------
        //----------EST CODE----------

        try {
          await (0, _asyncbox.retryInterval)(15, 1000, async () => {
            this.logEvent('wdaSessionAttempted');
            this.log.debug('Sending createSession command to WDA');

            try {
              this.cachedWdaStatus = this.cachedWdaStatus || (await this.proxyCommand('/status', 'GET'));
              await this.startWdaSession(this.opts.bundleId, this.opts.processArguments);
            } catch (err) {
              originalStacktrace = err.stack;
              this.log.debug(`Failed to create WDA session (${err.message}). Retrying...`);
              throw err;
            }
          });
          this.logEvent('wdaSessionStarted');
        } catch (err) {
          if (originalStacktrace) {
            this.log.debug(originalStacktrace);
          }

          let errorMsg = `Unable to start WebDriverAgent session because of xcodebuild failure: ${err.message}`;

          if (this.isRealDevice()) {
            errorMsg += ` Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` + `Try to remove the WebDriverAgentRunner application from the device if it is installed ` + `and reboot the device.`;
          }

          await quitAndUninstall(errorMsg);
        }

        if (this.opts.clearSystemFiles && !this.opts.webDriverAgentUrl) {
          await (0, _utils.markSystemFilesForCleanup)(this.wda);
        }

        this.wda.fullyStarted = true;
        this.logEvent('wdaStarted');
      });
    });
  }

  async runReset(opts = null) {
    this.logEvent('resetStarted');

    if (this.isRealDevice()) {
      await (0, _realDeviceManagement.runRealDeviceReset)(this.opts.device, opts || this.opts);
    } else {
      await (0, _simulatorManagement.runSimulatorReset)(this.opts.device, opts || this.opts);
    }

    this.logEvent('resetComplete');
  }

  async deleteSession() {
    await (0, _utils.removeAllSessionWebSocketHandlers)(this.server, this.sessionId);

    for (const recorder of _lodash.default.compact([this._recentScreenRecorder, this._audioRecorder, this._trafficCapture])) {
      await recorder.interrupt(true);
      await recorder.cleanup();
    }

    if (!_lodash.default.isEmpty(this._perfRecorders)) {
      await _bluebird.default.all(this._perfRecorders.map(x => x.stop(true)));
      this._perfRecorders = [];
    }

    if (this._conditionInducerService) {
      this.mobileDisableConditionInducer();
    }

    await this.stop();

    if (this.wda && !this.opts.webDriverAgentUrl) {
      if (this.opts.clearSystemFiles) {
        let synchronizationKey = XCUITestDriver.name;
        const derivedDataPath = await this.wda.retrieveDerivedDataPath();

        if (derivedDataPath) {
          synchronizationKey = _path.default.normalize(derivedDataPath);
        }

        await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
          await (0, _utils.clearSystemFiles)(this.wda);
        });
      } else {
        this.log.debug('Not clearing log files. Use `clearSystemFiles` capability to turn on.');
      }
    }

    if (this.remote) {
      this.log.debug('Found a remote debugger session. Removing...');
      await this.stopRemote();
    }

    if (this.opts.resetOnSessionStartOnly === false) {
      await this.runReset(Object.assign({}, this.opts, {
        enforceSimulatorShutdown: true
      }));
    }

    if (this.isSimulator() && !this.opts.noReset && !!this.opts.device) {
      if (this.lifecycleData.createSim) {
        this.log.debug(`Deleting simulator created for this run (udid: '${this.opts.udid}')`);
        await (0, _simulatorManagement.shutdownSimulator)(this.opts.device);
        await this.opts.device.delete();
      }
    }

    const shouldResetLocationServivce = this.isRealDevice() && !!this.opts.resetLocationService;

    if (shouldResetLocationServivce) {
      try {
        await this.mobileResetLocationService();
      } catch (ignore) {}
    }

    if (!_lodash.default.isEmpty(this.logs)) {
      await this.logs.syslog.stopCapture();
      this.logs = {};
    }

    if (this.mjpegStream) {
      this.log.info('Closing MJPEG stream');
      this.mjpegStream.stop();
    }

    this.resetIos();
    await super.deleteSession();
  }

  async stop() {
    this.jwpProxyActive = false;
    this.proxyReqRes = null;

    if (this.wda && this.wda.fullyStarted) {
      if (this.wda.jwproxy) {
        try {
          await this.proxyCommand(`/session/${this.sessionId}`, 'DELETE');
        } catch (err) {
          this.log.debug(`Unable to DELETE session on WDA: '${err.message}'. Continuing shutdown.`);
        }
      }

      if (!this.wda.webDriverAgentUrl && this.opts.useNewWDA) {
        await this.wda.quit();
      }
    }

    _deviceConnectionsFactory.default.releaseConnection(this.opts.udid);
  }

  async executeCommand(cmd, ...args) {
    this.log.debug(`Executing command '${cmd}'`);

    if (cmd === 'receiveAsyncResponse') {
      return await this.receiveAsyncResponse(...args);
    }

    if (cmd === 'getStatus') {
      return await this.getStatus();
    }

    return await super.executeCommand(cmd, ...args);
  }

  async configureApp() {
    function appIsPackageOrBundle(app) {
      return /^([a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)+$/.test(app);
    }

    if (!this.opts.bundleId && appIsPackageOrBundle(this.opts.app)) {
      this.opts.bundleId = this.opts.app;
      this.opts.app = '';
    }

    if (this.opts.bundleId && appIsPackageOrBundle(this.opts.bundleId) && (this.opts.app === '' || appIsPackageOrBundle(this.opts.app))) {
      this.log.debug('App is an iOS bundle, will attempt to run as pre-existing');
      return;
    }

    switch (_lodash.default.toLower(this.opts.app)) {
      case 'settings':
        this.opts.bundleId = 'com.apple.Preferences';
        this.opts.app = null;
        return;

      case 'calendar':
        this.opts.bundleId = 'com.apple.mobilecal';
        this.opts.app = null;
        return;
    }

    this.opts.app = await this.helpers.configureApp(this.opts.app, {
      onPostProcess: this.onPostConfigureApp.bind(this),
      supportedExtensions: SUPPORTED_EXTENSIONS
    });
  }

  async unzipApp(appPath, depth = 0) {
    if (depth > MAX_ARCHIVE_SCAN_DEPTH) {
      throw new Error('Nesting of package bundles is not supported');
    }

    const [rootDir, matchedPaths] = await (0, _appUtils.findApps)(appPath, SUPPORTED_EXTENSIONS);

    if (_lodash.default.isEmpty(matchedPaths)) {
      this.log.debug(`'${_path.default.basename(appPath)}' has no bundles`);
    } else {
      this.log.debug(`Found ${_support.util.pluralize('bundle', matchedPaths.length, true)} in ` + `'${_path.default.basename(appPath)}': ${matchedPaths}`);
    }

    try {
      for (const matchedPath of matchedPaths) {
        const fullPath = _path.default.join(rootDir, matchedPath);

        if (await (0, _appUtils.isAppBundle)(fullPath)) {
          const supportedPlatforms = await (0, _appUtils.fetchSupportedAppPlatforms)(fullPath);

          if (this.isSimulator() && !supportedPlatforms.some(p => _lodash.default.includes(p, 'Simulator'))) {
            this.log.info(`'${matchedPath}' does not have Simulator devices in the list of supported platforms ` + `(${supportedPlatforms.join(',')}). Skipping it`);
            ;
            continue;
          }

          if (this.isRealDevice() && !supportedPlatforms.some(p => _lodash.default.includes(p, 'OS'))) {
            this.log.info(`'${matchedPath}' does not have real devices in the list of supported platforms ` + `(${supportedPlatforms.join(',')}). Skipping it`);
            ;
            continue;
          }

          this.log.info(`'${matchedPath}' is the resulting application bundle selected from '${appPath}'`);
          return await (0, _appUtils.isolateAppBundle)(fullPath);
        } else if (_lodash.default.endsWith(_lodash.default.toLower(fullPath), _appUtils.IPA_EXT) && (await _support.fs.stat(fullPath)).isFile()) {
          try {
            return await this.unzipApp(fullPath, depth + 1);
          } catch (e) {
            this.log.warn(`Skipping processing of '${matchedPath}': ${e.message}`);
          }
        }
      }
    } finally {
      await _support.fs.rimraf(rootDir);
    }

    throw new Error(`${this.opts.app} did not have any matching ${_appUtils.APP_EXT} or ${_appUtils.IPA_EXT} ` + `bundles. Please make sure the provided package is valid and contains at least one matching ` + `application bundle which is not nested.`);
  }

  async onPostConfigureApp({
    cachedAppInfo,
    isUrl,
    appPath
  }) {
    if (_lodash.default.isPlainObject(cachedAppInfo) && (await _support.fs.stat(appPath)).isFile() && (await _support.fs.hash(appPath)) === cachedAppInfo.packageHash && (await _support.fs.exists(cachedAppInfo.fullPath)) && (await _support.fs.glob('**/*', {
      cwd: cachedAppInfo.fullPath,
      strict: false,
      nosort: true
    })).length === cachedAppInfo.integrity.folder) {
      this.log.info(`Using '${cachedAppInfo.fullPath}' which was cached from '${appPath}'`);
      return {
        appPath: cachedAppInfo.fullPath
      };
    }

    if (await (0, _appUtils.isAppBundle)(appPath)) {
      return false;
    }

    try {
      return {
        appPath: await this.unzipApp(appPath)
      };
    } finally {
      if (isUrl) {
        await _support.fs.rimraf(appPath);
      }
    }
  }

  async determineDevice() {
    this.lifecycleData.createSim = false;
    this.opts.deviceName = (0, _utils.translateDeviceName)(this.opts.platformVersion, this.opts.deviceName);

    const setupVersionCaps = async () => {
      this.opts.iosSdkVersion = await (0, _utils.getAndCheckIosSdkVersion)();
      this.log.info(`iOS SDK Version set to '${this.opts.iosSdkVersion}'`);

      if (!this.opts.platformVersion && this.opts.iosSdkVersion) {
        this.log.info(`No platformVersion specified. Using the latest version Xcode supports: '${this.opts.iosSdkVersion}'. ` + `This may cause problems if a simulator does not exist for this platform version.`);
        this.opts.platformVersion = (0, _utils.normalizePlatformVersion)(this.opts.iosSdkVersion);
      }
    };

    if (this.opts.udid) {
      if (this.opts.udid.toLowerCase() === 'auto') {
        try {
          this.opts.udid = await (0, _utils.detectUdid)();
        } catch (err) {
          this.log.warn(`Cannot detect any connected real devices. Falling back to Simulator. Original error: ${err.message}`);
          const device = await (0, _simulatorManagement.getExistingSim)(this.opts);

          if (!device) {
            this.log.errorAndThrow(`Cannot detect udid for ${this.opts.deviceName} Simulator running iOS ${this.opts.platformVersion}`);
          }

          this.opts.udid = device.udid;
          const devicePlatform = (0, _utils.normalizePlatformVersion)(await device.getPlatformVersion());

          if (this.opts.platformVersion !== devicePlatform) {
            this.opts.platformVersion = devicePlatform;
            this.log.info(`Set platformVersion to '${devicePlatform}' to match the device with given UDID`);
          }

          await setupVersionCaps();
          return {
            device,
            realDevice: false,
            udid: device.udid
          };
        }
      } else {
        const devices = await (0, _realDeviceManagement.getConnectedDevices)();
        this.log.debug(`Available devices: ${devices.join(', ')}`);

        if (!devices.includes(this.opts.udid)) {
          this.log.debug(`No real device with udid '${this.opts.udid}'. Looking for simulator`);

          try {
            const device = await (0, _appiumIosSimulator.getSimulator)(this.opts.udid, {
              devicesSetPath: this.opts.simulatorDevicesSetPath
            });
            return {
              device,
              realDevice: false,
              udid: this.opts.udid
            };
          } catch (ign) {
            throw new Error(`Unknown device or simulator UDID: '${this.opts.udid}'`);
          }
        }
      }

      const device = await (0, _realDeviceManagement.getRealDeviceObj)(this.opts.udid);
      return {
        device,
        realDevice: true,
        udid: this.opts.udid
      };
    }

    await setupVersionCaps();

    if (this.opts.enforceFreshSimulatorCreation) {
      this.log.debug(`New simulator is requested. If this is not wanted, set 'enforceFreshSimulatorCreation' capability to false`);
    } else {
      const device = await (0, _simulatorManagement.getExistingSim)(this.opts);

      if (device) {
        return {
          device,
          realDevice: false,
          udid: device.udid
        };
      }

      this.log.info('Simulator udid not provided');
    }

    this.log.info('Using desired caps to create a new simulator');
    const device = await this.createSim();
    return {
      device,
      realDevice: false,
      udid: device.udid
    };
  }

  async startSim() {
    const runOpts = {
      scaleFactor: this.opts.scaleFactor,
      connectHardwareKeyboard: !!this.opts.connectHardwareKeyboard,
      pasteboardAutomaticSync: this.opts.simulatorPasteboardAutomaticSync ?? 'off',
      isHeadless: !!this.opts.isHeadless,
      tracePointer: this.opts.simulatorTracePointer,
      devicePreferences: {}
    };

    if (this.opts.SimulatorWindowCenter) {
      runOpts.devicePreferences.SimulatorWindowCenter = this.opts.SimulatorWindowCenter;
    }

    if (_lodash.default.isInteger(this.opts.simulatorStartupTimeout)) {
      runOpts.startupTimeout = this.opts.simulatorStartupTimeout;
    }

    const orientation = _lodash.default.isString(this.opts.orientation) && this.opts.orientation.toUpperCase();

    switch (orientation) {
      case 'LANDSCAPE':
        runOpts.devicePreferences.SimulatorWindowOrientation = 'LandscapeLeft';
        runOpts.devicePreferences.SimulatorWindowRotationAngle = 90;
        break;

      case 'PORTRAIT':
        runOpts.devicePreferences.SimulatorWindowOrientation = 'Portrait';
        runOpts.devicePreferences.SimulatorWindowRotationAngle = 0;
        break;
    }

    await this.opts.device.run(runOpts);
  }

  async createSim() {
    this.lifecycleData.createSim = true;
    const platformName = this.isTvOS() ? _desiredCaps.PLATFORM_NAME_TVOS : _desiredCaps.PLATFORM_NAME_IOS;
    const sim = await (0, _simulatorManagement.createSim)(this.opts, platformName);
    this.log.info(`Created simulator with udid '${sim.udid}'.`);
    return sim;
  }

  async launchApp() {
    const APP_LAUNCH_TIMEOUT = 20 * 1000;
    this.logEvent('appLaunchAttempted');
    await this.opts.device.simctl.launchApp(this.opts.bundleId);

    let checkStatus = async () => {
      let response = await this.proxyCommand('/status', 'GET');
      let currentApp = response.currentApp.bundleID;

      if (currentApp !== this.opts.bundleId) {
        throw new Error(`${this.opts.bundleId} not in foreground. ${currentApp} is in foreground`);
      }
    };

    this.log.info(`Waiting for '${this.opts.bundleId}' to be in foreground`);
    let retries = parseInt(APP_LAUNCH_TIMEOUT / 200, 10);
    await (0, _asyncbox.retryInterval)(retries, 200, checkStatus);
    this.log.info(`${this.opts.bundleId} is in foreground`);
    this.logEvent('appLaunched');
  }

  async startWdaSession(bundleId, processArguments) {
    const args = processArguments ? processArguments.args || [] : [];

    if (!_lodash.default.isArray(args)) {
      throw new Error(`processArguments.args capability is expected to be an array. ` + `${JSON.stringify(args)} is given instead`);
    }

    const env = processArguments ? processArguments.env || {} : {};

    if (!_lodash.default.isPlainObject(env)) {
      throw new Error(`processArguments.env capability is expected to be a dictionary. ` + `${JSON.stringify(env)} is given instead`);
    }

    if (_support.util.hasValue(this.opts.language)) {
      args.push('-AppleLanguages', `(${this.opts.language})`);
      args.push('-NSLanguages', `(${this.opts.language})`);
    }

    if (_support.util.hasValue(this.opts.locale)) {
      args.push('-AppleLocale', this.opts.locale);
    }

    if (this.opts.noReset) {
      if (_lodash.default.isNil(this.opts.shouldTerminateApp)) {
        this.opts.shouldTerminateApp = false;
      }

      if (_lodash.default.isNil(this.opts.forceAppLaunch)) {
        this.opts.forceAppLaunch = false;
      }
    }

    const wdaCaps = {
      bundleId: this.opts.autoLaunch === false ? undefined : bundleId,
      arguments: args,
      environment: env,
      eventloopIdleDelaySec: this.opts.wdaEventloopIdleDelay ?? 0,
      shouldWaitForQuiescence: this.opts.waitForQuiescence ?? true,
      shouldUseTestManagerForVisibilityDetection: this.opts.simpleIsVisibleCheck ?? false,
      maxTypingFrequency: this.opts.maxTypingFrequency ?? 60,
      shouldUseSingletonTestManager: this.opts.shouldUseSingletonTestManager ?? true,
      waitForIdleTimeout: this.opts.waitForIdleTimeout,
      shouldUseCompactResponses: this.opts.shouldUseCompactResponses,
      elementResponseFields: this.opts.elementResponseFields,
      disableAutomaticScreenshots: this.opts.disableAutomaticScreenshots,
      shouldTerminateApp: this.opts.shouldTerminateApp ?? true,
      forceAppLaunch: this.opts.forceAppLaunch ?? true,
      useNativeCachingStrategy: this.opts.useNativeCachingStrategy ?? true,
      forceSimulatorSoftwareKeyboardPresence: this.opts.forceSimulatorSoftwareKeyboardPresence ?? (this.opts.connectHardwareKeyboard === true ? false : true)
    };

    if (this.opts.autoAcceptAlerts) {
      wdaCaps.defaultAlertAction = 'accept';
    } else if (this.opts.autoDismissAlerts) {
      wdaCaps.defaultAlertAction = 'dismiss';
    }

    await this.proxyCommand('/session', 'POST', {
      capabilities: {
        firstMatch: [wdaCaps],
        alwaysMatch: {}
      }
    });
  }

  proxyActive() {
    return this.jwpProxyActive;
  }

  getProxyAvoidList() {
    if (this.isWebview()) {
      return NO_PROXY_WEB_LIST;
    }

    return NO_PROXY_NATIVE_LIST;
  }

  canProxy() {
    return true;
  }

  isSafari() {
    return !!this.safari;
  }

  isRealDevice() {
    return this.opts.realDevice;
  }

  isSimulator() {
    return !this.opts.realDevice;
  }

  isTvOS() {
    return _lodash.default.toLower(this.opts.platformName) === _lodash.default.toLower(_desiredCaps.PLATFORM_NAME_TVOS);
  }

  isWebview() {
    return this.isSafari() || this.isWebContext();
  }

  validateLocatorStrategy(strategy) {
    super.validateLocatorStrategy(strategy, this.isWebContext());
  }

  validateDesiredCaps(caps) {
    if (!super.validateDesiredCaps(caps)) {
      return false;
    }

    if (_lodash.default.toLower(caps.browserName) !== 'safari' && !caps.app && !caps.bundleId) {
      this.log.info('The desired capabilities include neither an app nor a bundleId. ' + 'WebDriverAgent will be started without the default app');
    }

    if (!_support.util.coerceVersion(caps.platformVersion, false)) {
      this.log.warn(`'platformVersion' capability ('${caps.platformVersion}') is not a valid version number. ` + `Consider fixing it or be ready to experience an inconsistent driver behavior.`);
    }

    let verifyProcessArgument = processArguments => {
      const {
        args,
        env
      } = processArguments;

      if (!_lodash.default.isNil(args) && !_lodash.default.isArray(args)) {
        this.log.errorAndThrow('processArguments.args must be an array of strings');
      }

      if (!_lodash.default.isNil(env) && !_lodash.default.isPlainObject(env)) {
        this.log.errorAndThrow('processArguments.env must be an object <key,value> pair {a:b, c:d}');
      }
    };

    if (caps.processArguments) {
      if (_lodash.default.isString(caps.processArguments)) {
        try {
          caps.processArguments = JSON.parse(caps.processArguments);
          verifyProcessArgument(caps.processArguments);
        } catch (err) {
          this.log.errorAndThrow(`processArguments must be a JSON format or an object with format {args : [], env : {a:b, c:d}}. ` + `Both environment and argument can be null. Error: ${err}`);
        }
      } else if (_lodash.default.isPlainObject(caps.processArguments)) {
        verifyProcessArgument(caps.processArguments);
      } else {
        this.log.errorAndThrow(`'processArguments must be an object, or a string JSON object with format {args : [], env : {a:b, c:d}}. ` + `Both environment and argument can be null.`);
      }
    }

    if (caps.keychainPath && !caps.keychainPassword || !caps.keychainPath && caps.keychainPassword) {
      this.log.errorAndThrow(`If 'keychainPath' is set, 'keychainPassword' must also be set (and vice versa).`);
    }

    this.opts.resetOnSessionStartOnly = !_support.util.hasValue(this.opts.resetOnSessionStartOnly) || this.opts.resetOnSessionStartOnly;
    this.opts.useNewWDA = _support.util.hasValue(this.opts.useNewWDA) ? this.opts.useNewWDA : false;

    if (caps.commandTimeouts) {
      caps.commandTimeouts = (0, _utils.normalizeCommandTimeouts)(caps.commandTimeouts);
    }

    if (_lodash.default.isString(caps.webDriverAgentUrl)) {
      const {
        protocol,
        host
      } = _url.default.parse(caps.webDriverAgentUrl);

      if (_lodash.default.isEmpty(protocol) || _lodash.default.isEmpty(host)) {
        this.log.errorAndThrow(`'webDriverAgentUrl' capability is expected to contain a valid WebDriverAgent server URL. ` + `'${caps.webDriverAgentUrl}' is given instead`);
      }
    }

    if (caps.browserName) {
      if (caps.bundleId) {
        this.log.errorAndThrow(`'browserName' cannot be set together with 'bundleId' capability`);
      }

      if (caps.app) {
        this.log.warn(`The capabilities should generally not include both an 'app' and a 'browserName'`);
      }
    }

    if (caps.permissions) {
      try {
        for (const [bundleId, perms] of _lodash.default.toPairs(JSON.parse(caps.permissions))) {
          if (!_lodash.default.isString(bundleId)) {
            throw new Error(`'${JSON.stringify(bundleId)}' must be a string`);
          }

          if (!_lodash.default.isPlainObject(perms)) {
            throw new Error(`'${JSON.stringify(perms)}' must be a JSON object`);
          }
        }
      } catch (e) {
        this.log.errorAndThrow(`'${caps.permissions}' is expected to be a valid object with format ` + `{"<bundleId1>": {"<serviceName1>": "<serviceStatus1>", ...}, ...}. Original error: ${e.message}`);
      }
    }

    if (caps.platformVersion && !_support.util.coerceVersion(caps.platformVersion, false)) {
      this.log.errorAndThrow(`'platformVersion' must be a valid version number. ` + `'${caps.platformVersion}' is given instead.`);
    }

    if (caps.additionalWebviewBundleIds) {
      caps.additionalWebviewBundleIds = this.helpers.parseCapsArray(caps.additionalWebviewBundleIds);
    }

    return true;
  }

  async installAUT() {
    if (this.isSafari()) {
      return;
    }

    await (0, _appUtils.verifyApplicationPlatform)(this.opts.app, {
      isSimulator: this.isSimulator(),
      isTvOS: this.isTvOS()
    });

    if (this.isRealDevice()) {
      await (0, _realDeviceManagement.installToRealDevice)(this.opts.device, this.opts.app, this.opts.bundleId, {
        noReset: this.opts.noReset,
        timeout: this.opts.appPushTimeout,
        strategy: this.opts.appInstallStrategy
      });
    } else {
      await (0, _simulatorManagement.installToSimulator)(this.opts.device, this.opts.app, this.opts.bundleId, {
        noReset: this.opts.noReset,
        newSimulator: this.lifecycleData.createSim
      });
    }

    if (this.opts.otherApps) {
      await this.installOtherApps(this.opts.otherApps);
    }

    if (_support.util.hasValue(this.opts.iosInstallPause)) {
      let pause = parseInt(this.opts.iosInstallPause, 10);
      this.log.debug(`iosInstallPause set. Pausing ${pause} ms before continuing`);
      await _bluebird.default.delay(pause);
    }
  }

  async installOtherApps(otherApps) {
    if (this.isRealDevice()) {
      this.log.warn('Capability otherApps is only supported for Simulators');
      return;
    }

    let appsList;

    try {
      appsList = this.helpers.parseCapsArray(otherApps);
    } catch (e) {
      this.log.errorAndThrow(`Could not parse "otherApps" capability: ${e.message}`);
    }

    if (_lodash.default.isEmpty(appsList)) {
      this.log.info(`Got zero apps from 'otherApps' capability value. Doing nothing`);
      return;
    }

    const appPaths = await _bluebird.default.all(appsList.map(app => this.helpers.configureApp(app, '.app')));

    for (const otherApp of appPaths) {
      await (0, _simulatorManagement.installToSimulator)(this.opts.device, otherApp, undefined, {
        noReset: this.opts.noReset,
        newSimulator: this.lifecycleData.createSim
      });
    }
  }

  async setReduceMotion(isEnabled) {
    if (this.isRealDevice() || !_lodash.default.isBoolean(isEnabled)) {
      return;
    }

    this.log.info(`Setting reduceMotion to ${isEnabled}`);
    await this.updateSettings({
      reduceMotion: isEnabled
    });
  }

  async setInitialOrientation(orientation) {
    if (!_lodash.default.isString(orientation)) {
      this.log.info('Skipping setting of the initial display orientation. ' + 'Set the "orientation" capability to either "LANDSCAPE" or "PORTRAIT", if this is an undesired behavior.');
      return;
    }

    orientation = orientation.toUpperCase();

    if (!_lodash.default.includes(['LANDSCAPE', 'PORTRAIT'], orientation)) {
      this.log.debug(`Unable to set initial orientation to '${orientation}'`);
      return;
    }

    this.log.debug(`Setting initial orientation to '${orientation}'`);

    try {
      await this.proxyCommand('/orientation', 'POST', {
        orientation
      });
      this.opts.curOrientation = orientation;
    } catch (err) {
      this.log.warn(`Setting initial orientation failed with: ${err.message}`);
    }
  }

  _getCommandTimeout(cmdName) {
    if (this.opts.commandTimeouts) {
      if (cmdName && _lodash.default.has(this.opts.commandTimeouts, cmdName)) {
        return this.opts.commandTimeouts[cmdName];
      }

      return this.opts.commandTimeouts[_utils.DEFAULT_TIMEOUT_KEY];
    }
  }

  async getSession() {
    const driverSession = await super.getSession();

    if (!this.wdaCaps) {
      this.wdaCaps = await this.proxyCommand('/', 'GET');
    }

    const shouldGetDeviceCaps = _lodash.default.isBoolean(this.opts.includeDeviceCapsToSessionInfo) ? this.opts.includeDeviceCapsToSessionInfo : true;

    if (shouldGetDeviceCaps && !this.deviceCaps) {
      const {
        statusBarSize,
        scale
      } = await this.getScreenInfo();
      this.deviceCaps = {
        pixelRatio: scale,
        statBarHeight: statusBarSize.height,
        viewportRect: await this.getViewportRect()
      };
    }

    this.log.info('Merging WDA caps over Appium caps for session detail response');
    return Object.assign({
      udid: this.opts.udid
    }, driverSession, this.wdaCaps.capabilities, this.deviceCaps || {});
  }

  async reset() {
    if (this.opts.noReset) {
      let opts = _lodash.default.cloneDeep(this.opts);

      opts.noReset = false;
      opts.fullReset = false;
      const shutdownHandler = this.resetOnUnexpectedShutdown;

      this.resetOnUnexpectedShutdown = () => {};

      try {
        await this.runReset(opts);
      } finally {
        this.resetOnUnexpectedShutdown = shutdownHandler;
      }
    }

    await super.reset();
  }

}

exports.XCUITestDriver = XCUITestDriver;
Object.assign(XCUITestDriver.prototype, _index.default);
var _default = XCUITestDriver;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTSFVURE9XTl9PVEhFUl9GRUFUX05BTUUiLCJDVVNUT01JWkVfUkVTVUxUX0JVTkRQRV9QQVRIIiwiU1VQUE9SVEVEX0VYVEVOU0lPTlMiLCJJUEFfRVhUIiwiQVBQX0VYVCIsIk1BWF9BUkNISVZFX1NDQU5fREVQVEgiLCJkZWZhdWx0U2VydmVyQ2FwcyIsIndlYlN0b3JhZ2VFbmFibGVkIiwibG9jYXRpb25Db250ZXh0RW5hYmxlZCIsImJyb3dzZXJOYW1lIiwicGxhdGZvcm0iLCJqYXZhc2NyaXB0RW5hYmxlZCIsImRhdGFiYXNlRW5hYmxlZCIsInRha2VzU2NyZWVuc2hvdCIsIm5ldHdvcmtDb25uZWN0aW9uRW5hYmxlZCIsIldEQV9TSU1fU1RBUlRVUF9SRVRSSUVTIiwiV0RBX1JFQUxfREVWX1NUQVJUVVBfUkVUUklFUyIsIldEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkwiLCJXREFfU1RBUlRVUF9SRVRSWV9JTlRFUlZBTCIsIkRFRkFVTFRfU0VUVElOR1MiLCJuYXRpdmVXZWJUYXAiLCJuYXRpdmVXZWJUYXBTdHJpY3QiLCJ1c2VKU09OU291cmNlIiwic2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcyIsImVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXMiLCJtanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5IiwibWpwZWdTZXJ2ZXJGcmFtZXJhdGUiLCJzY3JlZW5zaG90UXVhbGl0eSIsIm1qcGVnU2NhbGluZ0ZhY3RvciIsInJlZHVjZU1vdGlvbiIsIlNIQVJFRF9SRVNPVVJDRVNfR1VBUkQiLCJBc3luY0xvY2siLCJXRUJfRUxFTUVOVFNfQ0FDSEVfU0laRSIsIk5PX1BST1hZX05BVElWRV9MSVNUIiwiTk9fUFJPWFlfV0VCX0xJU1QiLCJjb25jYXQiLCJNRU1PSVpFRF9GVU5DVElPTlMiLCJYQ1VJVGVzdERyaXZlciIsIkJhc2VEcml2ZXIiLCJjb25zdHJ1Y3RvciIsIm9wdHMiLCJzaG91bGRWYWxpZGF0ZUNhcHMiLCJkZXNpcmVkQ2FwQ29uc3RyYWludHMiLCJsb2NhdG9yU3RyYXRlZ2llcyIsIndlYkxvY2F0b3JTdHJhdGVnaWVzIiwicmVzZXRJb3MiLCJzZXR0aW5ncyIsIkRldmljZVNldHRpbmdzIiwib25TZXR0aW5nc1VwZGF0ZSIsImJpbmQiLCJsb2dzIiwiZm4iLCJfIiwibWVtb2l6ZSIsImtleSIsInZhbHVlIiwicHJveHlDb21tYW5kIiwid2RhIiwiZGV2aWNlIiwiandwUHJveHlBY3RpdmUiLCJwcm94eVJlcVJlcyIsImp3cFByb3h5QXZvaWQiLCJzYWZhcmkiLCJjYWNoZWRXZGFTdGF0dXMiLCJjdXJXZWJGcmFtZXMiLCJfY3VycmVudFVybCIsImN1ckNvbnRleHQiLCJ4Y29kZVZlcnNpb24iLCJjb250ZXh0cyIsImltcGxpY2l0V2FpdE1zIiwiYXN5bmNsaWJXYWl0TXMiLCJwYWdlTG9hZE1zIiwibGFuZHNjYXBlV2ViQ29vcmRzT2Zmc2V0IiwicmVtb3RlIiwiX2NvbmRpdGlvbkluZHVjZXJTZXJ2aWNlIiwid2ViRWxlbWVudHNDYWNoZSIsIkxSVSIsIm1heCIsImRyaXZlckRhdGEiLCJnZXRTdGF0dXMiLCJkcml2ZXJJbmZvIiwiZ2V0RHJpdmVySW5mbyIsInN0YXR1cyIsImJ1aWxkIiwidmVyc2lvbiIsIm1lcmdlQ2xpQXJnc1RvT3B0cyIsImRpZE1lcmdlIiwiT2JqZWN0IiwiZW50cmllcyIsImNsaUFyZ3MiLCJoYXMiLCJsb2ciLCJpbmZvIiwiY3JlYXRlU2Vzc2lvbiIsImFyZ3MiLCJsaWZlY3ljbGVEYXRhIiwic2Vzc2lvbklkIiwiY2FwcyIsInZhbGlkYXRlRGVzaXJlZENhcHMiLCJzdGFydCIsImFzc2lnbiIsInVkaWQiLCJ1cGRhdGVTZXR0aW5ncyIsIndkYVNldHRpbmdzIiwibWpwZWdTY3JlZW5zaG90VXJsIiwibWpwZWdTdHJlYW0iLCJtanBlZyIsIk1KcGVnU3RyZWFtIiwiZSIsImVycm9yIiwiSlNPTiIsInN0cmluZ2lmeSIsImRlbGV0ZVNlc3Npb24iLCJnZXREZWZhdWx0VXJsIiwiaXNSZWFsRGV2aWNlIiwid2RhTG9jYWxQb3J0IiwiYWRkcmVzcyIsImluY2x1ZGVzIiwicG9ydCIsIm5vUmVzZXQiLCJmdWxsUmVzZXQiLCJwcmludFVzZXIiLCJpb3NTZGtWZXJzaW9uIiwicmVhbERldmljZSIsImRldGVybWluZURldmljZSIsInNpbXVsYXRvckRldmljZXNTZXRQYXRoIiwiZGV2aWNlc1NldFBhdGgiLCJwbGF0Zm9ybVZlcnNpb24iLCJnZXRQbGF0Zm9ybVZlcnNpb24iLCJub3JtYWxpemVkVmVyc2lvbiIsIm5vcm1hbGl6ZVBsYXRmb3JtVmVyc2lvbiIsInV0aWwiLCJjb21wYXJlVmVyc2lvbnMiLCJFcnJvciIsImlzRW1wdHkiLCJ3ZWJEcml2ZXJBZ2VudFVybCIsImdldEFuZENoZWNrWGNvZGVWZXJzaW9uIiwibG9nRXZlbnQiLCJ0b0xvd2VyIiwiYXBwIiwidW5kZWZpbmVkIiwicHJvY2Vzc0FyZ3VtZW50cyIsImJ1bmRsZUlkIiwiU0FGQVJJX0JVTkRMRV9JRCIsInNhZmFyaUluaXRpYWxVcmwiLCJjb25maWd1cmVBcHAiLCJjaGVja0FwcFByZXNlbnQiLCJleHRyYWN0QnVuZGxlSWQiLCJydW5SZXNldCIsIldlYkRyaXZlckFnZW50IiwicmV0cmlldmVEZXJpdmVkRGF0YVBhdGgiLCJjYXRjaCIsImRlYnVnIiwibWVtb2l6ZWRMb2dJbmZvIiwic3RhcnRMb2dDYXB0dXJlIiwic2tpcExvZ0NhcHR1cmUiLCJyZXN1bHQiLCJpc0xvZ0NhcHR1cmVTdGFydGVkIiwiaXNTaW11bGF0b3IiLCJzaHV0ZG93bk90aGVyU2ltdWxhdG9ycyIsImVuc3VyZUZlYXR1cmVFbmFibGVkIiwiaXNTYWZhcmkiLCJzYWZhcmlHbG9iYWxQcmVmZXJlbmNlcyIsInVwZGF0ZVNhZmFyaUdsb2JhbFNldHRpbmdzIiwibG9jYWxDb25maWciLCJzZXRMb2NhbGVBbmRQcmVmZXJlbmNlcyIsInNpbSIsInNodXRkb3duU2ltdWxhdG9yIiwiY3VzdG9tU1NMQ2VydCIsImRvZXNTdXBwb3J0S2V5Y2hhaW5BcGkiLCJjZXJ0SGVhZCIsInRydW5jYXRlIiwibGVuZ3RoIiwiaGFzQ2VydGlmaWNhdGVMZWdhY3kiLCJpbnN0YWxsQ2VydGlmaWNhdGVMZWdhY3kiLCJzdGFydFNpbSIsImluc3RhbGxDZXJ0aWZpY2F0ZSIsImxhdW5jaFdpdGhJREIiLCJpZGIiLCJJREIiLCJjb25uZWN0IiwibWVzc2FnZSIsIlB5aWRldmljZSIsImluc3RhbGxQcm9maWxlIiwicGF5bG9hZCIsImluc3RhbGxBVVQiLCJpc0FwcEluc3RhbGxlZCIsImVycm9yQW5kVGhyb3ciLCJwZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zTWFwcGluZyIsInRvUGFpcnMiLCJwYXJzZSIsInNldFBlcm1pc3Npb25zIiwid2FybiIsImNhbGVuZGFyQWNjZXNzQXV0aG9yaXplZCIsImVuYWJsZUNhbGVuZGFyQWNjZXNzIiwiZGlzYWJsZUNhbGVuZGFyQWNjZXNzIiwic3RhcnRXZGEiLCJzZXRSZWR1Y2VNb3Rpb24iLCJzZXRJbml0aWFsT3JpZW50YXRpb24iLCJvcmllbnRhdGlvbiIsImF1dG9XZWJ2aWV3IiwiYWN0aXZhdGVSZWNlbnRXZWJ2aWV3IiwiaXNOaWwiLCJnZXRDdXJyZW50VXJsIiwic2V0VXJsIiwic2V0Q3VycmVudFVybCIsImdldFVybCIsImhhc1ZhbHVlIiwiY2xlYW51cE9ic29sZXRlUHJvY2Vzc2VzIiwidXNlUG9ydEZvcndhcmRpbmciLCJpc0xvY2FsSG9zdCIsIndkYUJhc2VVcmwiLCJERVZJQ0VfQ09OTkVDVElPTlNfRkFDVE9SWSIsInJlcXVlc3RDb25uZWN0aW9uIiwidXJsIiwiZGV2aWNlUG9ydCIsIndkYVJlbW90ZVBvcnQiLCJzeW5jaHJvbml6YXRpb25LZXkiLCJuYW1lIiwidXNlWGN0ZXN0cnVuRmlsZSIsImlzU291cmNlRnJlc2giLCJkZXJpdmVkRGF0YVBhdGgiLCJwYXRoIiwibm9ybWFsaXplIiwiaXNCdXN5IiwiYm9vdHN0cmFwUGF0aCIsImFjcXVpcmUiLCJ1c2VOZXdXREEiLCJxdWl0QW5kVW5pbnN0YWxsIiwic2V0dXBDYWNoaW5nIiwibXNnIiwicmVzdWx0QnVuZGxlUGF0aCIsInN0YXJ0dXBSZXRyaWVzIiwid2RhU3RhcnR1cFJldHJpZXMiLCJzdGFydHVwUmV0cnlJbnRlcnZhbCIsIndkYVN0YXJ0dXBSZXRyeUludGVydmFsIiwicmV0cnlDb3VudCIsInJldHJ5SW50ZXJ2YWwiLCJyZXRyaWVzIiwibWFqb3IiLCJyZXRyeSIsImxhdW5jaCIsImVyciIsImVycm9yTXNnIiwib3JpZ2luYWxTdGFja3RyYWNlIiwic3RhcnRXZGFTZXNzaW9uIiwic3RhY2siLCJjbGVhclN5c3RlbUZpbGVzIiwibWFya1N5c3RlbUZpbGVzRm9yQ2xlYW51cCIsImZ1bGx5U3RhcnRlZCIsInJ1blJlYWxEZXZpY2VSZXNldCIsInJ1blNpbXVsYXRvclJlc2V0IiwicmVtb3ZlQWxsU2Vzc2lvbldlYlNvY2tldEhhbmRsZXJzIiwic2VydmVyIiwicmVjb3JkZXIiLCJjb21wYWN0IiwiX3JlY2VudFNjcmVlblJlY29yZGVyIiwiX2F1ZGlvUmVjb3JkZXIiLCJfdHJhZmZpY0NhcHR1cmUiLCJpbnRlcnJ1cHQiLCJjbGVhbnVwIiwiX3BlcmZSZWNvcmRlcnMiLCJCIiwiYWxsIiwibWFwIiwieCIsInN0b3AiLCJtb2JpbGVEaXNhYmxlQ29uZGl0aW9uSW5kdWNlciIsInN0b3BSZW1vdGUiLCJyZXNldE9uU2Vzc2lvblN0YXJ0T25seSIsImVuZm9yY2VTaW11bGF0b3JTaHV0ZG93biIsImNyZWF0ZVNpbSIsImRlbGV0ZSIsInNob3VsZFJlc2V0TG9jYXRpb25TZXJ2aXZjZSIsInJlc2V0TG9jYXRpb25TZXJ2aWNlIiwibW9iaWxlUmVzZXRMb2NhdGlvblNlcnZpY2UiLCJpZ25vcmUiLCJzeXNsb2ciLCJzdG9wQ2FwdHVyZSIsImp3cHJveHkiLCJxdWl0IiwicmVsZWFzZUNvbm5lY3Rpb24iLCJleGVjdXRlQ29tbWFuZCIsImNtZCIsInJlY2VpdmVBc3luY1Jlc3BvbnNlIiwiYXBwSXNQYWNrYWdlT3JCdW5kbGUiLCJ0ZXN0IiwiaGVscGVycyIsIm9uUG9zdFByb2Nlc3MiLCJvblBvc3RDb25maWd1cmVBcHAiLCJzdXBwb3J0ZWRFeHRlbnNpb25zIiwidW56aXBBcHAiLCJhcHBQYXRoIiwiZGVwdGgiLCJyb290RGlyIiwibWF0Y2hlZFBhdGhzIiwiZmluZEFwcHMiLCJiYXNlbmFtZSIsInBsdXJhbGl6ZSIsIm1hdGNoZWRQYXRoIiwiZnVsbFBhdGgiLCJqb2luIiwiaXNBcHBCdW5kbGUiLCJzdXBwb3J0ZWRQbGF0Zm9ybXMiLCJmZXRjaFN1cHBvcnRlZEFwcFBsYXRmb3JtcyIsInNvbWUiLCJwIiwiaXNvbGF0ZUFwcEJ1bmRsZSIsImVuZHNXaXRoIiwiZnMiLCJzdGF0IiwiaXNGaWxlIiwicmltcmFmIiwiY2FjaGVkQXBwSW5mbyIsImlzVXJsIiwiaXNQbGFpbk9iamVjdCIsImhhc2giLCJwYWNrYWdlSGFzaCIsImV4aXN0cyIsImdsb2IiLCJjd2QiLCJzdHJpY3QiLCJub3NvcnQiLCJpbnRlZ3JpdHkiLCJmb2xkZXIiLCJkZXZpY2VOYW1lIiwidHJhbnNsYXRlRGV2aWNlTmFtZSIsInNldHVwVmVyc2lvbkNhcHMiLCJnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24iLCJ0b0xvd2VyQ2FzZSIsImRldGVjdFVkaWQiLCJnZXRFeGlzdGluZ1NpbSIsImRldmljZVBsYXRmb3JtIiwiZGV2aWNlcyIsImdldENvbm5lY3RlZERldmljZXMiLCJnZXRTaW11bGF0b3IiLCJpZ24iLCJnZXRSZWFsRGV2aWNlT2JqIiwiZW5mb3JjZUZyZXNoU2ltdWxhdG9yQ3JlYXRpb24iLCJydW5PcHRzIiwic2NhbGVGYWN0b3IiLCJjb25uZWN0SGFyZHdhcmVLZXlib2FyZCIsInBhc3RlYm9hcmRBdXRvbWF0aWNTeW5jIiwic2ltdWxhdG9yUGFzdGVib2FyZEF1dG9tYXRpY1N5bmMiLCJpc0hlYWRsZXNzIiwidHJhY2VQb2ludGVyIiwic2ltdWxhdG9yVHJhY2VQb2ludGVyIiwiZGV2aWNlUHJlZmVyZW5jZXMiLCJTaW11bGF0b3JXaW5kb3dDZW50ZXIiLCJpc0ludGVnZXIiLCJzaW11bGF0b3JTdGFydHVwVGltZW91dCIsInN0YXJ0dXBUaW1lb3V0IiwiaXNTdHJpbmciLCJ0b1VwcGVyQ2FzZSIsIlNpbXVsYXRvcldpbmRvd09yaWVudGF0aW9uIiwiU2ltdWxhdG9yV2luZG93Um90YXRpb25BbmdsZSIsInJ1biIsInBsYXRmb3JtTmFtZSIsImlzVHZPUyIsIlBMQVRGT1JNX05BTUVfVFZPUyIsIlBMQVRGT1JNX05BTUVfSU9TIiwibGF1bmNoQXBwIiwiQVBQX0xBVU5DSF9USU1FT1VUIiwic2ltY3RsIiwiY2hlY2tTdGF0dXMiLCJyZXNwb25zZSIsImN1cnJlbnRBcHAiLCJidW5kbGVJRCIsInBhcnNlSW50IiwiaXNBcnJheSIsImVudiIsImxhbmd1YWdlIiwicHVzaCIsImxvY2FsZSIsInNob3VsZFRlcm1pbmF0ZUFwcCIsImZvcmNlQXBwTGF1bmNoIiwid2RhQ2FwcyIsImF1dG9MYXVuY2giLCJhcmd1bWVudHMiLCJlbnZpcm9ubWVudCIsImV2ZW50bG9vcElkbGVEZWxheVNlYyIsIndkYUV2ZW50bG9vcElkbGVEZWxheSIsInNob3VsZFdhaXRGb3JRdWllc2NlbmNlIiwid2FpdEZvclF1aWVzY2VuY2UiLCJzaG91bGRVc2VUZXN0TWFuYWdlckZvclZpc2liaWxpdHlEZXRlY3Rpb24iLCJzaW1wbGVJc1Zpc2libGVDaGVjayIsIm1heFR5cGluZ0ZyZXF1ZW5jeSIsInNob3VsZFVzZVNpbmdsZXRvblRlc3RNYW5hZ2VyIiwid2FpdEZvcklkbGVUaW1lb3V0IiwiZWxlbWVudFJlc3BvbnNlRmllbGRzIiwiZGlzYWJsZUF1dG9tYXRpY1NjcmVlbnNob3RzIiwidXNlTmF0aXZlQ2FjaGluZ1N0cmF0ZWd5IiwiZm9yY2VTaW11bGF0b3JTb2Z0d2FyZUtleWJvYXJkUHJlc2VuY2UiLCJhdXRvQWNjZXB0QWxlcnRzIiwiZGVmYXVsdEFsZXJ0QWN0aW9uIiwiYXV0b0Rpc21pc3NBbGVydHMiLCJjYXBhYmlsaXRpZXMiLCJmaXJzdE1hdGNoIiwiYWx3YXlzTWF0Y2giLCJwcm94eUFjdGl2ZSIsImdldFByb3h5QXZvaWRMaXN0IiwiaXNXZWJ2aWV3IiwiY2FuUHJveHkiLCJpc1dlYkNvbnRleHQiLCJ2YWxpZGF0ZUxvY2F0b3JTdHJhdGVneSIsInN0cmF0ZWd5IiwiY29lcmNlVmVyc2lvbiIsInZlcmlmeVByb2Nlc3NBcmd1bWVudCIsImtleWNoYWluUGF0aCIsImtleWNoYWluUGFzc3dvcmQiLCJjb21tYW5kVGltZW91dHMiLCJub3JtYWxpemVDb21tYW5kVGltZW91dHMiLCJwcm90b2NvbCIsImhvc3QiLCJwZXJtcyIsImFkZGl0aW9uYWxXZWJ2aWV3QnVuZGxlSWRzIiwicGFyc2VDYXBzQXJyYXkiLCJ2ZXJpZnlBcHBsaWNhdGlvblBsYXRmb3JtIiwiaW5zdGFsbFRvUmVhbERldmljZSIsInRpbWVvdXQiLCJhcHBQdXNoVGltZW91dCIsImFwcEluc3RhbGxTdHJhdGVneSIsImluc3RhbGxUb1NpbXVsYXRvciIsIm5ld1NpbXVsYXRvciIsIm90aGVyQXBwcyIsImluc3RhbGxPdGhlckFwcHMiLCJpb3NJbnN0YWxsUGF1c2UiLCJwYXVzZSIsImRlbGF5IiwiYXBwc0xpc3QiLCJhcHBQYXRocyIsIm90aGVyQXBwIiwiaXNFbmFibGVkIiwiaXNCb29sZWFuIiwiY3VyT3JpZW50YXRpb24iLCJfZ2V0Q29tbWFuZFRpbWVvdXQiLCJjbWROYW1lIiwiREVGQVVMVF9USU1FT1VUX0tFWSIsImdldFNlc3Npb24iLCJkcml2ZXJTZXNzaW9uIiwic2hvdWxkR2V0RGV2aWNlQ2FwcyIsImluY2x1ZGVEZXZpY2VDYXBzVG9TZXNzaW9uSW5mbyIsImRldmljZUNhcHMiLCJzdGF0dXNCYXJTaXplIiwic2NhbGUiLCJnZXRTY3JlZW5JbmZvIiwicGl4ZWxSYXRpbyIsInN0YXRCYXJIZWlnaHQiLCJoZWlnaHQiLCJ2aWV3cG9ydFJlY3QiLCJnZXRWaWV3cG9ydFJlY3QiLCJyZXNldCIsImNsb25lRGVlcCIsInNodXRkb3duSGFuZGxlciIsInJlc2V0T25VbmV4cGVjdGVkU2h1dGRvd24iLCJwcm90b3R5cGUiLCJjb21tYW5kcyJdLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9kcml2ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQmFzZURyaXZlciwgRGV2aWNlU2V0dGluZ3MgfSBmcm9tICdhcHBpdW0vZHJpdmVyJztcbmltcG9ydCB7IHV0aWwsIG1qcGVnLCBmcyB9IGZyb20gJ2FwcGl1bS9zdXBwb3J0JztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgdXJsIGZyb20gJ3VybCc7XG5pbXBvcnQgeyBXZWJEcml2ZXJBZ2VudCB9IGZyb20gJ2FwcGl1bS13ZWJkcml2ZXJhZ2VudCc7XG5pbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XG5pbXBvcnQge1xuICBjcmVhdGVTaW0sIGdldEV4aXN0aW5nU2ltLCBydW5TaW11bGF0b3JSZXNldCwgaW5zdGFsbFRvU2ltdWxhdG9yLFxuICBzaHV0ZG93bk90aGVyU2ltdWxhdG9ycywgc2h1dGRvd25TaW11bGF0b3IsIHNldExvY2FsZUFuZFByZWZlcmVuY2VzXG59IGZyb20gJy4vc2ltdWxhdG9yLW1hbmFnZW1lbnQnO1xuaW1wb3J0IHsgZ2V0U2ltdWxhdG9yIH0gZnJvbSAnYXBwaXVtLWlvcy1zaW11bGF0b3InO1xuaW1wb3J0IHtcbiAgZG9lc1N1cHBvcnRLZXljaGFpbkFwaSwgaW5zdGFsbENlcnRpZmljYXRlLCBpbnN0YWxsQ2VydGlmaWNhdGVMZWdhY3ksXG4gIGhhc0NlcnRpZmljYXRlTGVnYWN5LFxufSBmcm9tICcuL2NlcnQtdXRpbHMnO1xuaW1wb3J0IHsgcmV0cnlJbnRlcnZhbCwgcmV0cnkgfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQge1xuICB2ZXJpZnlBcHBsaWNhdGlvblBsYXRmb3JtLCBleHRyYWN0QnVuZGxlSWQsIFNBRkFSSV9CVU5ETEVfSUQsXG4gIGZldGNoU3VwcG9ydGVkQXBwUGxhdGZvcm1zLCBBUFBfRVhULCBJUEFfRVhULFxuICBpc0FwcEJ1bmRsZSwgZmluZEFwcHMsIGlzb2xhdGVBcHBCdW5kbGUsXG59IGZyb20gJy4vYXBwLXV0aWxzJztcbmltcG9ydCB7XG4gIGRlc2lyZWRDYXBDb25zdHJhaW50cywgUExBVEZPUk1fTkFNRV9JT1MsIFBMQVRGT1JNX05BTUVfVFZPU1xufSBmcm9tICcuL2Rlc2lyZWQtY2Fwcyc7XG5pbXBvcnQgY29tbWFuZHMgZnJvbSAnLi9jb21tYW5kcy9pbmRleCc7XG5pbXBvcnQge1xuICBkZXRlY3RVZGlkLCBnZXRBbmRDaGVja1hjb2RlVmVyc2lvbiwgZ2V0QW5kQ2hlY2tJb3NTZGtWZXJzaW9uLFxuICBjaGVja0FwcFByZXNlbnQsIGdldERyaXZlckluZm8sXG4gIGNsZWFyU3lzdGVtRmlsZXMsIHRyYW5zbGF0ZURldmljZU5hbWUsIG5vcm1hbGl6ZUNvbW1hbmRUaW1lb3V0cyxcbiAgREVGQVVMVF9USU1FT1VUX0tFWSwgbWFya1N5c3RlbUZpbGVzRm9yQ2xlYW51cCxcbiAgcHJpbnRVc2VyLCByZW1vdmVBbGxTZXNzaW9uV2ViU29ja2V0SGFuZGxlcnMsXG4gIG5vcm1hbGl6ZVBsYXRmb3JtVmVyc2lvbiwgaXNMb2NhbEhvc3Rcbn0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQge1xuICBnZXRDb25uZWN0ZWREZXZpY2VzLCBydW5SZWFsRGV2aWNlUmVzZXQsIGluc3RhbGxUb1JlYWxEZXZpY2UsXG4gIGdldFJlYWxEZXZpY2VPYmpcbn0gZnJvbSAnLi9yZWFsLWRldmljZS1tYW5hZ2VtZW50JztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCBBc3luY0xvY2sgZnJvbSAnYXN5bmMtbG9jayc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBJREIgZnJvbSAnYXBwaXVtLWlkYic7XG5pbXBvcnQgREVWSUNFX0NPTk5FQ1RJT05TX0ZBQ1RPUlkgZnJvbSAnLi9kZXZpY2UtY29ubmVjdGlvbnMtZmFjdG9yeSc7XG5pbXBvcnQgUHlpZGV2aWNlIGZyb20gJy4vcHktaW9zLWRldmljZS1jbGllbnQnO1xuXG5cbmNvbnN0IFNIVVRET1dOX09USEVSX0ZFQVRfTkFNRSA9ICdzaHV0ZG93bl9vdGhlcl9zaW1zJztcbmNvbnN0IENVU1RPTUlaRV9SRVNVTFRfQlVORFBFX1BBVEggPSAnY3VzdG9taXplX3Jlc3VsdF9idW5kbGVfcGF0aCc7XG5cbmNvbnN0IFNVUFBPUlRFRF9FWFRFTlNJT05TID0gW0lQQV9FWFQsIEFQUF9FWFRdO1xuY29uc3QgTUFYX0FSQ0hJVkVfU0NBTl9ERVBUSCA9IDE7XG5jb25zdCBkZWZhdWx0U2VydmVyQ2FwcyA9IHtcbiAgd2ViU3RvcmFnZUVuYWJsZWQ6IGZhbHNlLFxuICBsb2NhdGlvbkNvbnRleHRFbmFibGVkOiBmYWxzZSxcbiAgYnJvd3Nlck5hbWU6ICcnLFxuICBwbGF0Zm9ybTogJ01BQycsXG4gIGphdmFzY3JpcHRFbmFibGVkOiB0cnVlLFxuICBkYXRhYmFzZUVuYWJsZWQ6IGZhbHNlLFxuICB0YWtlc1NjcmVlbnNob3Q6IHRydWUsXG4gIG5ldHdvcmtDb25uZWN0aW9uRW5hYmxlZDogZmFsc2UsXG59O1xuY29uc3QgV0RBX1NJTV9TVEFSVFVQX1JFVFJJRVMgPSAyO1xuY29uc3QgV0RBX1JFQUxfREVWX1NUQVJUVVBfUkVUUklFUyA9IDE7XG5jb25zdCBXREFfUkVBTF9ERVZfVFVUT1JJQUxfVVJMID0gJ2h0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtLXhjdWl0ZXN0LWRyaXZlci9ibG9iL21hc3Rlci9kb2NzL3JlYWwtZGV2aWNlLWNvbmZpZy5tZCc7XG5jb25zdCBXREFfU1RBUlRVUF9SRVRSWV9JTlRFUlZBTCA9IDEwMDAwO1xuY29uc3QgREVGQVVMVF9TRVRUSU5HUyA9IHtcbiAgbmF0aXZlV2ViVGFwOiBmYWxzZSxcbiAgbmF0aXZlV2ViVGFwU3RyaWN0OiBmYWxzZSxcbiAgdXNlSlNPTlNvdXJjZTogZmFsc2UsXG4gIHNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXM6IHRydWUsXG4gIGVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXM6ICd0eXBlLGxhYmVsJyxcbiAgLy8gUmVhZCBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL1dlYkRyaXZlckFnZW50L2Jsb2IvbWFzdGVyL1dlYkRyaXZlckFnZW50TGliL1V0aWxpdGllcy9GQkNvbmZpZ3VyYXRpb24ubSBmb3IgZm9sbG93aW5nIHNldHRpbmdzJyB2YWx1ZXNcbiAgbWpwZWdTZXJ2ZXJTY3JlZW5zaG90UXVhbGl0eTogMjUsXG4gIG1qcGVnU2VydmVyRnJhbWVyYXRlOiAxMCxcbiAgc2NyZWVuc2hvdFF1YWxpdHk6IDEsXG4gIG1qcGVnU2NhbGluZ0ZhY3RvcjogMTAwLFxuICAvLyBzZXQgYHJlZHVjZU1vdGlvbmAgdG8gYG51bGxgIHNvIHRoYXQgaXQgd2lsbCBiZSB2ZXJpZmllZCBidXQgc3RpbGwgc2V0IGVpdGhlciB0cnVlL2ZhbHNlXG4gIHJlZHVjZU1vdGlvbjogbnVsbCxcbn07XG4vLyBUaGlzIGxvY2sgYXNzdXJlcywgdGhhdCBlYWNoIGRyaXZlciBzZXNzaW9uIGRvZXMgbm90XG4vLyBhZmZlY3Qgc2hhcmVkIHJlc291cmNlcyBvZiB0aGUgb3RoZXIgcGFyYWxsZWwgc2Vzc2lvbnNcbmNvbnN0IFNIQVJFRF9SRVNPVVJDRVNfR1VBUkQgPSBuZXcgQXN5bmNMb2NrKCk7XG5jb25zdCBXRUJfRUxFTUVOVFNfQ0FDSEVfU0laRSA9IDUwMDtcblxuLyogZXNsaW50LWRpc2FibGUgbm8tdXNlbGVzcy1lc2NhcGUgKi9cbmNvbnN0IE5PX1BST1hZX05BVElWRV9MSVNUID0gW1xuICBbJ0RFTEVURScsIC93aW5kb3cvXSxcbiAgWydHRVQnLCAvXlxcL3Nlc3Npb25cXC9bXlxcL10rJC9dLFxuICBbJ0dFVCcsIC9hbGVydF90ZXh0L10sXG4gIFsnR0VUJywgL2FsZXJ0XFwvW15cXC9dKy9dLFxuICBbJ0dFVCcsIC9hcHBpdW0vXSxcbiAgWydHRVQnLCAvYXR0cmlidXRlL10sXG4gIFsnR0VUJywgL2NvbnRleHQvXSxcbiAgWydHRVQnLCAvbG9jYXRpb24vXSxcbiAgWydHRVQnLCAvbG9nL10sXG4gIFsnR0VUJywgL3NjcmVlbnNob3QvXSxcbiAgWydHRVQnLCAvc2l6ZS9dLFxuICBbJ0dFVCcsIC9zb3VyY2UvXSxcbiAgWydHRVQnLCAvdGltZW91dHMkL10sXG4gIFsnR0VUJywgL3VybC9dLFxuICBbJ0dFVCcsIC93aW5kb3cvXSxcbiAgWydQT1NUJywgL2FjY2VwdF9hbGVydC9dLFxuICBbJ1BPU1QnLCAvYWN0aW9ucyQvXSxcbiAgWydQT1NUJywgL2FsZXJ0X3RleHQvXSxcbiAgWydQT1NUJywgL2FsZXJ0XFwvW15cXC9dKy9dLFxuICBbJ1BPU1QnLCAvYXBwaXVtL10sXG4gIFsnUE9TVCcsIC9hcHBpdW1cXC9kZXZpY2VcXC9pc19sb2NrZWQvXSxcbiAgWydQT1NUJywgL2FwcGl1bVxcL2RldmljZVxcL2xvY2svXSxcbiAgWydQT1NUJywgL2FwcGl1bVxcL2RldmljZVxcL3VubG9jay9dLFxuICBbJ1BPU1QnLCAvYmFjay9dLFxuICBbJ1BPU1QnLCAvY2xlYXIvXSxcbiAgWydQT1NUJywgL2NvbnRleHQvXSxcbiAgWydQT1NUJywgL2Rpc21pc3NfYWxlcnQvXSxcbiAgWydQT1NUJywgL2VsZW1lbnRcXC9hY3RpdmUvXSwgLy8gTUpTT05XUCBnZXQgYWN0aXZlIGVsZW1lbnQgc2hvdWxkIHByb3h5XG4gIFsnUE9TVCcsIC9lbGVtZW50JC9dLFxuICBbJ1BPU1QnLCAvZWxlbWVudHMkL10sXG4gIFsnUE9TVCcsIC9leGVjdXRlL10sXG4gIFsnUE9TVCcsIC9rZXlzL10sXG4gIFsnUE9TVCcsIC9sb2cvXSxcbiAgWydQT1NUJywgL21vdmV0by9dLFxuICBbJ1BPU1QnLCAvcmVjZWl2ZV9hc3luY19yZXNwb25zZS9dLCAvLyBhbHdheXMsIGluIGNhc2UgY29udGV4dCBzd2l0Y2hlcyB3aGlsZSB3YWl0aW5nXG4gIFsnUE9TVCcsIC9zZXNzaW9uXFwvW15cXC9dK1xcL2xvY2F0aW9uL10sIC8vIGdlbyBsb2NhdGlvbiwgYnV0IG5vdCBlbGVtZW50IGxvY2F0aW9uXG4gIFsnUE9TVCcsIC9zaGFrZS9dLFxuICBbJ1BPU1QnLCAvdGltZW91dHMvXSxcbiAgWydQT1NUJywgL3RvdWNoL10sXG4gIFsnUE9TVCcsIC91cmwvXSxcbiAgWydQT1NUJywgL3ZhbHVlL10sXG4gIFsnUE9TVCcsIC93aW5kb3cvXSxcbiAgWydERUxFVEUnLCAvY29va2llL10sXG4gIFsnR0VUJywgL2Nvb2tpZS9dLFxuICBbJ1BPU1QnLCAvY29va2llL10sXG5dO1xuY29uc3QgTk9fUFJPWFlfV0VCX0xJU1QgPSBbXG4gIFsnR0VUJywgL2F0dHJpYnV0ZS9dLFxuICBbJ0dFVCcsIC9lbGVtZW50L10sXG4gIFsnR0VUJywgL3RleHQvXSxcbiAgWydHRVQnLCAvdGl0bGUvXSxcbiAgWydQT1NUJywgL2NsZWFyL10sXG4gIFsnUE9TVCcsIC9jbGljay9dLFxuICBbJ1BPU1QnLCAvZWxlbWVudC9dLFxuICBbJ1BPU1QnLCAvZm9yd2FyZC9dLFxuICBbJ1BPU1QnLCAvZnJhbWUvXSxcbiAgWydQT1NUJywgL2tleXMvXSxcbiAgWydQT1NUJywgL3JlZnJlc2gvXSxcbl0uY29uY2F0KE5PX1BST1hZX05BVElWRV9MSVNUKTtcbi8qIGVzbGludC1lbmFibGUgbm8tdXNlbGVzcy1lc2NhcGUgKi9cblxuY29uc3QgTUVNT0laRURfRlVOQ1RJT05TID0gW1xuICAnZ2V0U3RhdHVzQmFySGVpZ2h0JyxcbiAgJ2dldERldmljZVBpeGVsUmF0aW8nLFxuICAnZ2V0U2NyZWVuSW5mbycsXG5dO1xuXG5cbmNsYXNzIFhDVUlUZXN0RHJpdmVyIGV4dGVuZHMgQmFzZURyaXZlciB7XG4gIGNvbnN0cnVjdG9yIChvcHRzID0ge30sIHNob3VsZFZhbGlkYXRlQ2FwcyA9IHRydWUpIHtcbiAgICBzdXBlcihvcHRzLCBzaG91bGRWYWxpZGF0ZUNhcHMpO1xuXG4gICAgdGhpcy5kZXNpcmVkQ2FwQ29uc3RyYWludHMgPSBkZXNpcmVkQ2FwQ29uc3RyYWludHM7XG5cbiAgICB0aGlzLmxvY2F0b3JTdHJhdGVnaWVzID0gW1xuICAgICAgJ3hwYXRoJyxcbiAgICAgICdpZCcsXG4gICAgICAnbmFtZScsXG4gICAgICAnY2xhc3MgbmFtZScsXG4gICAgICAnLWlvcyBwcmVkaWNhdGUgc3RyaW5nJyxcbiAgICAgICctaW9zIGNsYXNzIGNoYWluJyxcbiAgICAgICdhY2Nlc3NpYmlsaXR5IGlkJyxcbiAgICAgICdjc3Mgc2VsZWN0b3InLFxuICAgIF07XG4gICAgdGhpcy53ZWJMb2NhdG9yU3RyYXRlZ2llcyA9IFtcbiAgICAgICdsaW5rIHRleHQnLFxuICAgICAgJ2NzcyBzZWxlY3RvcicsXG4gICAgICAndGFnIG5hbWUnLFxuICAgICAgJ2xpbmsgdGV4dCcsXG4gICAgICAncGFydGlhbCBsaW5rIHRleHQnLFxuICAgIF07XG4gICAgdGhpcy5yZXNldElvcygpO1xuICAgIHRoaXMuc2V0dGluZ3MgPSBuZXcgRGV2aWNlU2V0dGluZ3MoREVGQVVMVF9TRVRUSU5HUywgdGhpcy5vblNldHRpbmdzVXBkYXRlLmJpbmQodGhpcykpO1xuICAgIHRoaXMubG9ncyA9IHt9O1xuXG4gICAgLy8gbWVtb2l6ZSBmdW5jdGlvbnMgaGVyZSwgc28gdGhhdCB0aGV5IGFyZSBkb25lIG9uIGEgcGVyLWluc3RhbmNlIGJhc2lzXG4gICAgZm9yIChjb25zdCBmbiBvZiBNRU1PSVpFRF9GVU5DVElPTlMpIHtcbiAgICAgIHRoaXNbZm5dID0gXy5tZW1vaXplKHRoaXNbZm5dKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvblNldHRpbmdzVXBkYXRlIChrZXksIHZhbHVlKSB7XG4gICAgaWYgKGtleSAhPT0gJ25hdGl2ZVdlYlRhcCcgJiYga2V5ICE9PSAnbmF0aXZlV2ViVGFwU3RyaWN0Jykge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucHJveHlDb21tYW5kKCcvYXBwaXVtL3NldHRpbmdzJywgJ1BPU1QnLCB7XG4gICAgICAgIHNldHRpbmdzOiB7W2tleV06IHZhbHVlfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHRoaXMub3B0c1trZXldID0gISF2YWx1ZTtcbiAgfVxuXG4gIHJlc2V0SW9zICgpIHtcbiAgICB0aGlzLm9wdHMgPSB0aGlzLm9wdHMgfHwge307XG4gICAgdGhpcy53ZGEgPSBudWxsO1xuICAgIHRoaXMub3B0cy5kZXZpY2UgPSBudWxsO1xuICAgIHRoaXMuandwUHJveHlBY3RpdmUgPSBmYWxzZTtcbiAgICB0aGlzLnByb3h5UmVxUmVzID0gbnVsbDtcbiAgICB0aGlzLmp3cFByb3h5QXZvaWQgPSBbXTtcbiAgICB0aGlzLnNhZmFyaSA9IGZhbHNlO1xuICAgIHRoaXMuY2FjaGVkV2RhU3RhdHVzID0gbnVsbDtcblxuICAgIHRoaXMuY3VyV2ViRnJhbWVzID0gW107XG4gICAgdGhpcy5fY3VycmVudFVybCA9IG51bGw7XG4gICAgdGhpcy5jdXJDb250ZXh0ID0gbnVsbDtcbiAgICB0aGlzLnhjb2RlVmVyc2lvbiA9IHt9O1xuICAgIHRoaXMuY29udGV4dHMgPSBbXTtcbiAgICB0aGlzLmltcGxpY2l0V2FpdE1zID0gMDtcbiAgICB0aGlzLmFzeW5jbGliV2FpdE1zID0gMDtcbiAgICB0aGlzLnBhZ2VMb2FkTXMgPSA2MDAwO1xuICAgIHRoaXMubGFuZHNjYXBlV2ViQ29vcmRzT2Zmc2V0ID0gMDtcbiAgICB0aGlzLnJlbW90ZSA9IG51bGw7XG4gICAgdGhpcy5fY29uZGl0aW9uSW5kdWNlclNlcnZpY2UgPSBudWxsO1xuXG4gICAgdGhpcy53ZWJFbGVtZW50c0NhY2hlID0gbmV3IExSVSh7XG4gICAgICBtYXg6IFdFQl9FTEVNRU5UU19DQUNIRV9TSVpFLFxuICAgIH0pO1xuICB9XG5cbiAgZ2V0IGRyaXZlckRhdGEgKCkge1xuICAgIC8vIFRPRE8gZmlsbCBvdXQgcmVzb3VyY2UgaW5mbyBoZXJlXG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgYXN5bmMgZ2V0U3RhdHVzICgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuZHJpdmVySW5mbyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRoaXMuZHJpdmVySW5mbyA9IGF3YWl0IGdldERyaXZlckluZm8oKTtcbiAgICB9XG4gICAgbGV0IHN0YXR1cyA9IHtidWlsZDoge3ZlcnNpb246IHRoaXMuZHJpdmVySW5mby52ZXJzaW9ufX07XG4gICAgaWYgKHRoaXMuY2FjaGVkV2RhU3RhdHVzKSB7XG4gICAgICBzdGF0dXMud2RhID0gdGhpcy5jYWNoZWRXZGFTdGF0dXM7XG4gICAgfVxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBtZXJnZUNsaUFyZ3NUb09wdHMgKCkge1xuICAgIGxldCBkaWRNZXJnZSA9IGZhbHNlO1xuICAgIC8vIHRoaXMuY2xpQXJncyBzaG91bGQgbmV2ZXIgaW5jbHVkZSBhbnl0aGluZyB3ZSBkbyBub3QgZXhwZWN0LlxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuY2xpQXJncyA/PyB7fSkpIHtcbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsIGtleSkpIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgQ0xJIGFyZyAnJHtrZXl9JyB3aXRoIHZhbHVlICcke3ZhbHVlfScgb3ZlcndyaXRlcyB2YWx1ZSAnJHt0aGlzLm9wdHNba2V5XX0nIHNlbnQgaW4gdmlhIGNhcHMpYCk7XG4gICAgICAgIGRpZE1lcmdlID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMub3B0c1trZXldID0gdmFsdWU7XG4gICAgfVxuICAgIHJldHVybiBkaWRNZXJnZTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVNlc3Npb24gKC4uLmFyZ3MpIHtcbiAgICB0aGlzLmxpZmVjeWNsZURhdGEgPSB7fTsgLy8gdGhpcyBpcyB1c2VkIGZvciBrZWVwaW5nIHRyYWNrIG9mIHRoZSBzdGF0ZSB3ZSBzdGFydCBzbyB3aGVuIHdlIGRlbGV0ZSB0aGUgc2Vzc2lvbiB3ZSBjYW4gcHV0IHRoaW5ncyBiYWNrXG4gICAgdHJ5IHtcbiAgICAgIGxldCBbc2Vzc2lvbklkLCBjYXBzXSA9IGF3YWl0IHN1cGVyLmNyZWF0ZVNlc3Npb24oLi4uYXJncyk7XG4gICAgICB0aGlzLm9wdHMuc2Vzc2lvbklkID0gc2Vzc2lvbklkO1xuXG4gICAgICAvLyBtZXJnZSBjbGkgYXJncyB0byBvcHRzLCBhbmQgaWYgd2UgZGlkIG1lcmdlIGFueSwgcmV2YWxpZGF0ZSBvcHRzIHRvIGVuc3VyZSB0aGUgZmluYWwgc2V0XG4gICAgICAvLyBpcyBhbHNvIGNvbnNpc3RlbnRcbiAgICAgIGlmICh0aGlzLm1lcmdlQ2xpQXJnc1RvT3B0cygpKSB7XG4gICAgICAgIHRoaXMudmFsaWRhdGVEZXNpcmVkQ2Fwcyh7Li4uY2FwcywgLi4udGhpcy5jbGlBcmdzfSk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnQoKTtcblxuICAgICAgLy8gbWVyZ2Ugc2VydmVyIGNhcGFiaWxpdGllcyArIGRlc2lyZWQgY2FwYWJpbGl0aWVzXG4gICAgICBjYXBzID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdFNlcnZlckNhcHMsIGNhcHMpO1xuICAgICAgLy8gdXBkYXRlIHRoZSB1ZGlkIHdpdGggd2hhdCBpcyBhY3R1YWxseSB1c2VkXG4gICAgICBjYXBzLnVkaWQgPSB0aGlzLm9wdHMudWRpZDtcbiAgICAgIC8vIGVuc3VyZSB3ZSB0cmFjayBuYXRpdmVXZWJUYXAgY2FwYWJpbGl0eSBhcyBhIHNldHRpbmcgYXMgd2VsbFxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ25hdGl2ZVdlYlRhcCcpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlU2V0dGluZ3Moe25hdGl2ZVdlYlRhcDogdGhpcy5vcHRzLm5hdGl2ZVdlYlRhcH0pO1xuICAgICAgfVxuICAgICAgLy8gZW5zdXJlIHdlIHRyYWNrIG5hdGl2ZVdlYlRhcFN0cmljdCBjYXBhYmlsaXR5IGFzIGEgc2V0dGluZyBhcyB3ZWxsXG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnbmF0aXZlV2ViVGFwU3RyaWN0JykpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh7bmF0aXZlV2ViVGFwU3RyaWN0OiB0aGlzLm9wdHMubmF0aXZlV2ViVGFwU3RyaWN0fSk7XG4gICAgICB9XG4gICAgICAvLyBlbnN1cmUgd2UgdHJhY2sgdXNlSlNPTlNvdXJjZSBjYXBhYmlsaXR5IGFzIGEgc2V0dGluZyBhcyB3ZWxsXG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAndXNlSlNPTlNvdXJjZScpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlU2V0dGluZ3Moe3VzZUpTT05Tb3VyY2U6IHRoaXMub3B0cy51c2VKU09OU291cmNlfSk7XG4gICAgICB9XG5cbiAgICAgIGxldCB3ZGFTZXR0aW5ncyA9IHtcbiAgICAgICAgZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlczogREVGQVVMVF9TRVRUSU5HUy5lbGVtZW50UmVzcG9uc2VBdHRyaWJ1dGVzLFxuICAgICAgICBzaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzOiBERUZBVUxUX1NFVFRJTkdTLnNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXMsXG4gICAgICB9O1xuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ2VsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXMnKSkge1xuICAgICAgICB3ZGFTZXR0aW5ncy5lbGVtZW50UmVzcG9uc2VBdHRyaWJ1dGVzID0gdGhpcy5vcHRzLmVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXM7XG4gICAgICB9XG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcycpKSB7XG4gICAgICAgIHdkYVNldHRpbmdzLnNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXMgPSB0aGlzLm9wdHMuc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcztcbiAgICAgIH1cbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICdtanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5JykpIHtcbiAgICAgICAgd2RhU2V0dGluZ3MubWpwZWdTZXJ2ZXJTY3JlZW5zaG90UXVhbGl0eSA9IHRoaXMub3B0cy5tanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5O1xuICAgICAgfVxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ21qcGVnU2VydmVyRnJhbWVyYXRlJykpIHtcbiAgICAgICAgd2RhU2V0dGluZ3MubWpwZWdTZXJ2ZXJGcmFtZXJhdGUgPSB0aGlzLm9wdHMubWpwZWdTZXJ2ZXJGcmFtZXJhdGU7XG4gICAgICB9XG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnc2NyZWVuc2hvdFF1YWxpdHknKSkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBTZXR0aW5nIHRoZSBxdWFsaXR5IG9mIHBob25lIHNjcmVlbnNob3Q6ICcke3RoaXMub3B0cy5zY3JlZW5zaG90UXVhbGl0eX0nYCk7XG4gICAgICAgIHdkYVNldHRpbmdzLnNjcmVlbnNob3RRdWFsaXR5ID0gdGhpcy5vcHRzLnNjcmVlbnNob3RRdWFsaXR5O1xuICAgICAgfVxuICAgICAgLy8gZW5zdXJlIFdEQSBnZXRzIG91ciBkZWZhdWx0cyBpbnN0ZWFkIG9mIHdoYXRldmVyIGl0cyBvd24gbWlnaHQgYmVcbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlU2V0dGluZ3Mod2RhU2V0dGluZ3MpO1xuXG4gICAgICAvLyB0dXJuIG9uIG1qcGVnIHN0cmVhbSByZWFkaW5nIGlmIHJlcXVlc3RlZFxuICAgICAgaWYgKHRoaXMub3B0cy5tanBlZ1NjcmVlbnNob3RVcmwpIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgU3RhcnRpbmcgTUpQRUcgc3RyZWFtIHJlYWRpbmcgVVJMOiAnJHt0aGlzLm9wdHMubWpwZWdTY3JlZW5zaG90VXJsfSdgKTtcbiAgICAgICAgdGhpcy5tanBlZ1N0cmVhbSA9IG5ldyBtanBlZy5NSnBlZ1N0cmVhbSh0aGlzLm9wdHMubWpwZWdTY3JlZW5zaG90VXJsKTtcbiAgICAgICAgYXdhaXQgdGhpcy5tanBlZ1N0cmVhbS5zdGFydCgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFtzZXNzaW9uSWQsIGNhcHNdO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMubG9nLmVycm9yKEpTT04uc3RyaW5naWZ5KGUpKTtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlU2Vzc2lvbigpO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGVmYXVsdCBVUkwgZm9yIFNhZmFyaSBicm93c2VyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBkZWZhdWx0IFVSTFxuICAgKi9cbiAgZ2V0RGVmYXVsdFVybCAoKSB7XG4gICAgLy8gU2V0dGluZyB0aGlzIHRvIHNvbWUgZXh0ZXJuYWwgVVJMIHNsb3dzIGRvd24gQXBwaXVtIHN0YXJ0dXBcbiAgICByZXR1cm4gdGhpcy5pc1JlYWxEZXZpY2UoKVxuICAgICAgPyBgaHR0cDovLzEyNy4wLjAuMToke3RoaXMub3B0cy53ZGFMb2NhbFBvcnQgfHwgODEwMH0vaGVhbHRoYFxuICAgICAgOiBgaHR0cDovLyR7XG4gICAgICAgIHRoaXMub3B0cy5hZGRyZXNzLmluY2x1ZGVzKCc6JykgPyBgWyR7dGhpcy5vcHRzLmFkZHJlc3N9XWAgOiB0aGlzLm9wdHMuYWRkcmVzc1xuICAgICAgfToke3RoaXMub3B0cy5wb3J0fS93ZWxjb21lYDtcbiAgfVxuXG4gIGFzeW5jIHN0YXJ0ICgpIHtcbiAgICB0aGlzLm9wdHMubm9SZXNldCA9ICEhdGhpcy5vcHRzLm5vUmVzZXQ7XG4gICAgdGhpcy5vcHRzLmZ1bGxSZXNldCA9ICEhdGhpcy5vcHRzLmZ1bGxSZXNldDtcblxuICAgIGF3YWl0IHByaW50VXNlcigpO1xuXG4gICAgdGhpcy5vcHRzLmlvc1Nka1ZlcnNpb24gPSBudWxsOyAvLyBGb3IgV0RBIGFuZCB4Y29kZWJ1aWxkXG4gICAgY29uc3Qge2RldmljZSwgdWRpZCwgcmVhbERldmljZX0gPSBhd2FpdCB0aGlzLmRldGVybWluZURldmljZSgpO1xuICAgIHRoaXMubG9nLmluZm8oYERldGVybWluaW5nIGRldmljZSB0byBydW4gdGVzdHMgb246IHVkaWQ6ICcke3VkaWR9JywgcmVhbCBkZXZpY2U6ICR7cmVhbERldmljZX1gKTtcbiAgICB0aGlzLm9wdHMuZGV2aWNlID0gZGV2aWNlO1xuICAgIHRoaXMub3B0cy51ZGlkID0gdWRpZDtcbiAgICB0aGlzLm9wdHMucmVhbERldmljZSA9IHJlYWxEZXZpY2U7XG5cbiAgICBpZiAodGhpcy5vcHRzLnNpbXVsYXRvckRldmljZXNTZXRQYXRoKSB7XG4gICAgICBpZiAocmVhbERldmljZSkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBUaGUgJ3NpbXVsYXRvckRldmljZXNTZXRQYXRoJyBjYXBhYmlsaXR5IGlzIG9ubHkgc3VwcG9ydGVkIGZvciBTaW11bGF0b3IgZGV2aWNlc2ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgU2V0dGluZyBzaW11bGF0b3IgZGV2aWNlcyBzZXQgcGF0aCB0byAnJHt0aGlzLm9wdHMuc2ltdWxhdG9yRGV2aWNlc1NldFBhdGh9J2ApO1xuICAgICAgICB0aGlzLm9wdHMuZGV2aWNlLmRldmljZXNTZXRQYXRoID0gdGhpcy5vcHRzLnNpbXVsYXRvckRldmljZXNTZXRQYXRoO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGF0IHRoaXMgcG9pbnQgaWYgdGhlcmUgaXMgbm8gcGxhdGZvcm1WZXJzaW9uLCBnZXQgaXQgZnJvbSB0aGUgZGV2aWNlXG4gICAgaWYgKCF0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uICYmIHRoaXMub3B0cy5kZXZpY2UpIHtcbiAgICAgIHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gPSBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmdldFBsYXRmb3JtVmVyc2lvbigpO1xuICAgICAgdGhpcy5sb2cuaW5mbyhgTm8gcGxhdGZvcm1WZXJzaW9uIHNwZWNpZmllZC4gVXNpbmcgZGV2aWNlIHZlcnNpb246ICcke3RoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb259J2ApO1xuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRWZXJzaW9uID0gbm9ybWFsaXplUGxhdGZvcm1WZXJzaW9uKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24pO1xuICAgIGlmICh0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uICE9PSBub3JtYWxpemVkVmVyc2lvbikge1xuICAgICAgdGhpcy5sb2cuaW5mbyhgTm9ybWFsaXplZCBwbGF0Zm9ybVZlcnNpb24gY2FwYWJpbGl0eSB2YWx1ZSAnJHt0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9ufScgdG8gJyR7bm9ybWFsaXplZFZlcnNpb259J2ApO1xuICAgICAgdGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiA9IG5vcm1hbGl6ZWRWZXJzaW9uO1xuICAgIH1cbiAgICBpZiAodXRpbC5jb21wYXJlVmVyc2lvbnModGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiwgJzwnLCAnOS4zJykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUGxhdGZvcm0gdmVyc2lvbiBtdXN0IGJlIDkuMyBvciBhYm92ZS4gJyR7dGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbn0nIGlzIG5vdCBzdXBwb3J0ZWQuYCk7XG4gICAgfVxuXG4gICAgaWYgKF8uaXNFbXB0eSh0aGlzLnhjb2RlVmVyc2lvbikgJiYgKCF0aGlzLm9wdHMud2ViRHJpdmVyQWdlbnRVcmwgfHwgIXRoaXMub3B0cy5yZWFsRGV2aWNlKSkge1xuICAgICAgLy8gbm8gYHdlYkRyaXZlckFnZW50VXJsYCwgb3Igb24gYSBzaW11bGF0b3IsIHNvIHdlIG5lZWQgYW4gWGNvZGUgdmVyc2lvblxuICAgICAgdGhpcy54Y29kZVZlcnNpb24gPSBhd2FpdCBnZXRBbmRDaGVja1hjb2RlVmVyc2lvbigpO1xuICAgIH1cbiAgICB0aGlzLmxvZ0V2ZW50KCd4Y29kZURldGFpbHNSZXRyaWV2ZWQnKTtcblxuICAgIGlmIChfLnRvTG93ZXIodGhpcy5vcHRzLmJyb3dzZXJOYW1lKSA9PT0gJ3NhZmFyaScpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ1NhZmFyaSB0ZXN0IHJlcXVlc3RlZCcpO1xuICAgICAgdGhpcy5zYWZhcmkgPSB0cnVlO1xuICAgICAgdGhpcy5vcHRzLmFwcCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMub3B0cy5wcm9jZXNzQXJndW1lbnRzID0gdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMgfHwge307XG4gICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSBTQUZBUklfQlVORExFX0lEO1xuICAgICAgdGhpcy5fY3VycmVudFVybCA9IHRoaXMub3B0cy5zYWZhcmlJbml0aWFsVXJsIHx8IHRoaXMuZ2V0RGVmYXVsdFVybCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5vcHRzLmFwcCB8fCB0aGlzLm9wdHMuYnVuZGxlSWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuY29uZmlndXJlQXBwKCk7XG4gICAgfVxuICAgIHRoaXMubG9nRXZlbnQoJ2FwcENvbmZpZ3VyZWQnKTtcblxuICAgIC8vIGZhaWwgdmVyeSBlYXJseSBpZiB0aGUgYXBwIGRvZXNuJ3QgYWN0dWFsbHkgZXhpc3RcbiAgICAvLyBvciBpZiBidW5kbGUgaWQgZG9lc24ndCBwb2ludCB0byBhbiBpbnN0YWxsZWQgYXBwXG4gICAgaWYgKHRoaXMub3B0cy5hcHApIHtcbiAgICAgIGF3YWl0IGNoZWNrQXBwUHJlc2VudCh0aGlzLm9wdHMuYXBwKTtcblxuICAgICAgaWYgKCF0aGlzLm9wdHMuYnVuZGxlSWQpIHtcbiAgICAgICAgdGhpcy5vcHRzLmJ1bmRsZUlkID0gYXdhaXQgZXh0cmFjdEJ1bmRsZUlkKHRoaXMub3B0cy5hcHApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuUmVzZXQoKTtcblxuICAgIHRoaXMud2RhID0gbmV3IFdlYkRyaXZlckFnZW50KHRoaXMueGNvZGVWZXJzaW9uLCB0aGlzLm9wdHMsIHRoaXMubG9nKTtcbiAgICAvLyBEZXJpdmVkIGRhdGEgcGF0aCByZXRyaWV2YWwgaXMgYW4gZXhwZW5zaXZlIG9wZXJhdGlvblxuICAgIC8vIFdlIGNvdWxkIHN0YXJ0IHRoYXQgbm93IGluIGJhY2tncm91bmQgYW5kIGdldCB0aGUgY2FjaGVkIHJlc3VsdFxuICAgIC8vIHdoZW5ldmVyIGl0IGlzIG5lZWRlZFxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBwcm9taXNlL3ByZWZlci1hd2FpdC10by10aGVuXG4gICAgdGhpcy53ZGEucmV0cmlldmVEZXJpdmVkRGF0YVBhdGgoKS5jYXRjaCgoZSkgPT4gdGhpcy5sb2cuZGVidWcoZSkpO1xuXG4gICAgY29uc3QgbWVtb2l6ZWRMb2dJbmZvID0gXy5tZW1vaXplKCgpID0+IHtcbiAgICAgIHRoaXMubG9nLmluZm8oXCInc2tpcExvZ0NhcHR1cmUnIGlzIHNldC4gU2tpcHBpbmcgc3RhcnRpbmcgbG9ncyBzdWNoIGFzIGNyYXNoLCBzeXN0ZW0sIHNhZmFyaSBjb25zb2xlIGFuZCBzYWZhcmkgbmV0d29yay5cIik7XG4gICAgfSk7XG4gICAgY29uc3Qgc3RhcnRMb2dDYXB0dXJlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMub3B0cy5za2lwTG9nQ2FwdHVyZSkge1xuICAgICAgICBtZW1vaXplZExvZ0luZm8oKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0YXJ0TG9nQ2FwdHVyZSgpO1xuICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICB0aGlzLmxvZ0V2ZW50KCdsb2dDYXB0dXJlU3RhcnRlZCcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICAgIGNvbnN0IGlzTG9nQ2FwdHVyZVN0YXJ0ZWQgPSBhd2FpdCBzdGFydExvZ0NhcHR1cmUoKTtcblxuICAgIHRoaXMubG9nLmluZm8oYFNldHRpbmcgdXAgJHt0aGlzLmlzUmVhbERldmljZSgpID8gJ3JlYWwgZGV2aWNlJyA6ICdzaW11bGF0b3InfWApO1xuXG4gICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSkge1xuICAgICAgaWYgKHRoaXMub3B0cy5zaHV0ZG93bk90aGVyU2ltdWxhdG9ycykge1xuICAgICAgICB0aGlzLmVuc3VyZUZlYXR1cmVFbmFibGVkKFNIVVRET1dOX09USEVSX0ZFQVRfTkFNRSk7XG4gICAgICAgIGF3YWl0IHNodXRkb3duT3RoZXJTaW11bGF0b3JzKHRoaXMub3B0cy5kZXZpY2UpO1xuICAgICAgfVxuXG4gICAgICAvLyB0aGlzIHNob3VsZCBiZSBkb25lIGJlZm9yZSB0aGUgc2ltdWxhdG9yIGlzIHN0YXJ0ZWRcbiAgICAgIC8vIGlmIGl0IGlzIGFscmVhZHkgcnVubmluZywgdGhpcyBjYXAgd29uJ3Qgd29yaywgd2hpY2ggaXMgZG9jdW1lbnRlZFxuICAgICAgaWYgKHRoaXMuaXNTYWZhcmkoKSAmJiB0aGlzLm9wdHMuc2FmYXJpR2xvYmFsUHJlZmVyZW5jZXMpIHtcbiAgICAgICAgaWYgKGF3YWl0IHRoaXMub3B0cy5kZXZpY2UudXBkYXRlU2FmYXJpR2xvYmFsU2V0dGluZ3ModGhpcy5vcHRzLnNhZmFyaUdsb2JhbFByZWZlcmVuY2VzKSkge1xuICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBTYWZhcmkgZ2xvYmFsIHByZWZlcmVuY2VzIHVwZGF0ZWRgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmxvY2FsQ29uZmlnID0gYXdhaXQgc2V0TG9jYWxlQW5kUHJlZmVyZW5jZXModGhpcy5vcHRzLmRldmljZSwgdGhpcy5vcHRzLCB0aGlzLmlzU2FmYXJpKCksIGFzeW5jIChzaW0pID0+IHtcbiAgICAgICAgYXdhaXQgc2h1dGRvd25TaW11bGF0b3Ioc2ltKTtcblxuICAgICAgICAvLyB3ZSBkb24ndCBrbm93IGlmIHRoZXJlIG5lZWRzIHRvIGJlIGNoYW5nZXMgYSBwcmlvcmksIHNvIGNoYW5nZSBmaXJzdC5cbiAgICAgICAgLy8gc29tZXRpbWVzIHRoZSBzaHV0ZG93biBwcm9jZXNzIGNoYW5nZXMgdGhlIHNldHRpbmdzLCBzbyByZXNldCB0aGVtLFxuICAgICAgICAvLyBrbm93aW5nIHRoYXQgdGhlIHNpbSBpcyBhbHJlYWR5IHNodXRcbiAgICAgICAgYXdhaXQgc2V0TG9jYWxlQW5kUHJlZmVyZW5jZXMoc2ltLCB0aGlzLm9wdHMsIHRoaXMuaXNTYWZhcmkoKSk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0ICYmICEoYXdhaXQgZG9lc1N1cHBvcnRLZXljaGFpbkFwaSh0aGlzLm9wdHMuZGV2aWNlKSkpIHtcbiAgICAgICAgY29uc3QgY2VydEhlYWQgPSBfLnRydW5jYXRlKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0LCB7bGVuZ3RoOiAyMH0pO1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBJbnN0YWxsaW5nIHRoZSBjdXN0b20gU1NMIGNlcnRpZmljYXRlICcke2NlcnRIZWFkfSdgKTtcbiAgICAgICAgaWYgKGF3YWl0IGhhc0NlcnRpZmljYXRlTGVnYWN5KHRoaXMub3B0cy5kZXZpY2UsIHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0KSkge1xuICAgICAgICAgIHRoaXMubG9nLmluZm8oYFNTTCBjZXJ0aWZpY2F0ZSAnJHtjZXJ0SGVhZH0nIGFscmVhZHkgaW5zdGFsbGVkYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbyhgTWFraW5nIHN1cmUgU2ltdWxhdG9yIGlzIHNodXQgZG93biwgJyArXG4gICAgICAgICAgICAnc28gdGhhdCBTU0wgY2VydGlmaWNhdGUgaW5zdGFsbGF0aW9uIHRha2VzIGVmZmVjdGApO1xuICAgICAgICAgIGF3YWl0IHNodXRkb3duU2ltdWxhdG9yKHRoaXMub3B0cy5kZXZpY2UpO1xuICAgICAgICAgIGF3YWl0IGluc3RhbGxDZXJ0aWZpY2F0ZUxlZ2FjeSh0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMuY3VzdG9tU1NMQ2VydCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dFdmVudCgnY3VzdG9tQ2VydEluc3RhbGxlZCcpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0U2ltKCk7XG5cbiAgICAgIGlmICh0aGlzLm9wdHMuY3VzdG9tU1NMQ2VydCAmJiBhd2FpdCBkb2VzU3VwcG9ydEtleWNoYWluQXBpKHRoaXMub3B0cy5kZXZpY2UpKSB7XG4gICAgICAgIC8vIFNpbXVsYXRvciBtdXN0IGJlIGJvb3RlZCBpbiBvcmRlciB0byBjYWxsIHRoaXMgaGVscGVyXG4gICAgICAgIGF3YWl0IGluc3RhbGxDZXJ0aWZpY2F0ZSh0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMuY3VzdG9tU1NMQ2VydCk7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ2N1c3RvbUNlcnRJbnN0YWxsZWQnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMub3B0cy5sYXVuY2hXaXRoSURCICYmIHRoaXMuaXNTaW11bGF0b3IoKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGlkYiA9IG5ldyBJREIoe3VkaWR9KTtcbiAgICAgICAgICBhd2FpdCBpZGIuY29ubmVjdCgpO1xuICAgICAgICAgIHRoaXMub3B0cy5kZXZpY2UuaWRiID0gaWRiO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbyhgaWRiIHdpbGwgbm90IGJlIHVzZWQgZm9yIFNpbXVsYXRvciBpbnRlcmFjdGlvbi4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nRXZlbnQoJ3NpbVN0YXJ0ZWQnKTtcbiAgICAgIGlmICghaXNMb2dDYXB0dXJlU3RhcnRlZCkge1xuICAgICAgICAvLyBSZXRyeSBsb2cgY2FwdHVyZSBpZiBTaW11bGF0b3Igd2FzIG5vdCBydW5uaW5nIGJlZm9yZVxuICAgICAgICBhd2FpdCBzdGFydExvZ0NhcHR1cmUoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0KSB7XG4gICAgICBhd2FpdCBuZXcgUHlpZGV2aWNlKHVkaWQpLmluc3RhbGxQcm9maWxlKHtwYXlsb2FkOiB0aGlzLm9wdHMuY3VzdG9tU1NMQ2VydH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMuYXBwKSB7XG4gICAgICBhd2FpdCB0aGlzLmluc3RhbGxBVVQoKTtcbiAgICAgIHRoaXMubG9nRXZlbnQoJ2FwcEluc3RhbGxlZCcpO1xuICAgIH1cblxuICAgIC8vIGlmIHdlIG9ubHkgaGF2ZSBidW5kbGUgaWRlbnRpZmllciBhbmQgbm8gYXBwLCBmYWlsIGlmIGl0IGlzIG5vdCBhbHJlYWR5IGluc3RhbGxlZFxuICAgIGlmICghdGhpcy5vcHRzLmFwcCAmJiB0aGlzLm9wdHMuYnVuZGxlSWQgJiYgIXRoaXMuaXNTYWZhcmkoKSkge1xuICAgICAgaWYgKCFhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmlzQXBwSW5zdGFsbGVkKHRoaXMub3B0cy5idW5kbGVJZCkpIHtcbiAgICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgQXBwIHdpdGggYnVuZGxlIGlkZW50aWZpZXIgJyR7dGhpcy5vcHRzLmJ1bmRsZUlkfScgdW5rbm93bmApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMucGVybWlzc2lvbnMpIHtcbiAgICAgIGlmICh0aGlzLmlzU2ltdWxhdG9yKCkpIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoJ1NldHRpbmcgdGhlIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBiZWZvcmUgV0RBIGlzIHN0YXJ0ZWQnKTtcbiAgICAgICAgZm9yIChjb25zdCBbYnVuZGxlSWQsIHBlcm1pc3Npb25zTWFwcGluZ10gb2YgXy50b1BhaXJzKEpTT04ucGFyc2UodGhpcy5vcHRzLnBlcm1pc3Npb25zKSkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLnNldFBlcm1pc3Npb25zKGJ1bmRsZUlkLCBwZXJtaXNzaW9uc01hcHBpbmcpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdTZXR0aW5nIHBlcm1pc3Npb25zIGlzIG9ubHkgc3VwcG9ydGVkIG9uIFNpbXVsYXRvci4gJyArXG4gICAgICAgICAgJ1RoZSBcInBlcm1pc3Npb25zXCIgY2FwYWJpbGl0eSB3aWxsIGJlIGlnbm9yZWQuJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSkge1xuICAgICAgaWYgKHRoaXMub3B0cy5jYWxlbmRhckFjY2Vzc0F1dGhvcml6ZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5vcHRzLmRldmljZS5lbmFibGVDYWxlbmRhckFjY2Vzcyh0aGlzLm9wdHMuYnVuZGxlSWQpO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLm9wdHMuY2FsZW5kYXJBY2Nlc3NBdXRob3JpemVkID09PSBmYWxzZSkge1xuICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmRpc2FibGVDYWxlbmRhckFjY2Vzcyh0aGlzLm9wdHMuYnVuZGxlSWQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc3RhcnRXZGEodGhpcy5vcHRzLnNlc3Npb25JZCwgcmVhbERldmljZSk7XG5cbiAgICBhd2FpdCB0aGlzLnNldFJlZHVjZU1vdGlvbih0aGlzLm9wdHMucmVkdWNlTW90aW9uKTtcblxuICAgIGF3YWl0IHRoaXMuc2V0SW5pdGlhbE9yaWVudGF0aW9uKHRoaXMub3B0cy5vcmllbnRhdGlvbik7XG4gICAgdGhpcy5sb2dFdmVudCgnb3JpZW50YXRpb25TZXQnKTtcblxuICAgIGlmICh0aGlzLmlzU2FmYXJpKCkgfHwgdGhpcy5vcHRzLmF1dG9XZWJ2aWV3KSB7XG4gICAgICBhd2FpdCB0aGlzLmFjdGl2YXRlUmVjZW50V2VidmlldygpO1xuICAgIH1cbiAgICBpZiAodGhpcy5pc1NhZmFyaSgpKSB7XG4gICAgICBpZiAoISh0aGlzLm9wdHMuc2FmYXJpSW5pdGlhbFVybCA9PT0gJydcbiAgICAgICAgICB8fCAodGhpcy5vcHRzLm5vUmVzZXQgJiYgXy5pc05pbCh0aGlzLm9wdHMuc2FmYXJpSW5pdGlhbFVybCkpKSkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBBYm91dCB0byBzZXQgdGhlIGluaXRpYWwgU2FmYXJpIFVSTCB0byAnJHt0aGlzLmdldEN1cnJlbnRVcmwoKX0nLmAgK1xuICAgICAgICAgIGBVc2UgJ3NhZmFyaUluaXRpYWxVcmwnIGNhcGFiaWxpdHkgaW4gb3JkZXIgdG8gY3VzdG9taXplIGl0YCk7XG4gICAgICAgIGF3YWl0IHRoaXMuc2V0VXJsKHRoaXMuZ2V0Q3VycmVudFVybCgpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuc2V0Q3VycmVudFVybChhd2FpdCB0aGlzLmdldFVybCgpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3RhcnQgV2ViRHJpdmVyQWdlbnRSdW5uZXJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHNlc3Npb25JZCAtIFRoZSBpZCBvZiB0aGUgdGFyZ2V0IHNlc3Npb24gdG8gbGF1bmNoIFdEQSB3aXRoLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHJlYWxEZXZpY2UgLSBFcXVhbHMgdG8gdHJ1ZSBpZiB0aGUgdGVzdCB0YXJnZXQgZGV2aWNlIGlzIGEgcmVhbCBkZXZpY2UuXG4gICAqL1xuICBhc3luYyBzdGFydFdkYSAoc2Vzc2lvbklkLCByZWFsRGV2aWNlKSB7XG4gICAgLy8gRG9uJ3QgY2xlYW51cCB0aGUgcHJvY2Vzc2VzIGlmIHdlYkRyaXZlckFnZW50VXJsIGlzIHNldFxuICAgIGlmICghdXRpbC5oYXNWYWx1ZSh0aGlzLndkYS53ZWJEcml2ZXJBZ2VudFVybCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2RhLmNsZWFudXBPYnNvbGV0ZVByb2Nlc3NlcygpO1xuICAgIH1cblxuICAgIGNvbnN0IHVzZVBvcnRGb3J3YXJkaW5nID0gdGhpcy5pc1JlYWxEZXZpY2UoKVxuICAgICAgJiYgIXRoaXMud2RhLndlYkRyaXZlckFnZW50VXJsXG4gICAgICAmJiBpc0xvY2FsSG9zdCh0aGlzLndkYS53ZGFCYXNlVXJsKTtcbiAgICBhd2FpdCBERVZJQ0VfQ09OTkVDVElPTlNfRkFDVE9SWS5yZXF1ZXN0Q29ubmVjdGlvbih0aGlzLm9wdHMudWRpZCwgdGhpcy53ZGEudXJsLnBvcnQsIHtcbiAgICAgIGRldmljZVBvcnQ6IHVzZVBvcnRGb3J3YXJkaW5nID8gdGhpcy53ZGEud2RhUmVtb3RlUG9ydCA6IG51bGwsXG4gICAgICB1c2VQb3J0Rm9yd2FyZGluZyxcbiAgICB9KTtcblxuICAgIC8vIExldCBtdWx0aXBsZSBXREEgYmluYXJpZXMgd2l0aCBkaWZmZXJlbnQgZGVyaXZlZCBkYXRhIGZvbGRlcnMgYmUgYnVpbHQgaW4gcGFyYWxsZWxcbiAgICAvLyBDb25jdXJyZW50IFdEQSBidWlsZHMgZnJvbSB0aGUgc2FtZSBzb3VyY2Ugd2lsbCBjYXVzZSB4Y29kZWJ1aWxkIHN5bmNocm9uaXphdGlvbiBlcnJvcnNcbiAgICBsZXQgc3luY2hyb25pemF0aW9uS2V5ID0gWENVSVRlc3REcml2ZXIubmFtZTtcbiAgICBpZiAodGhpcy5vcHRzLnVzZVhjdGVzdHJ1bkZpbGUgfHwgIShhd2FpdCB0aGlzLndkYS5pc1NvdXJjZUZyZXNoKCkpKSB7XG4gICAgICAvLyBGaXJzdC10aW1lIGNvbXBpbGF0aW9uIGlzIGFuIGV4cGVuc2l2ZSBvcGVyYXRpb24sIHdoaWNoIGlzIGRvbmUgZmFzdGVyIGlmIGV4ZWN1dGVkXG4gICAgICAvLyBzZXF1ZW50aWFsbHkuIFhjb2RlYnVpbGQgc3ByZWFkcyB0aGUgbG9hZCBjYXVzZWQgYnkgdGhlIGNsYW5nIGNvbXBpbGVyIHRvIGFsbCBhdmFpbGFibGUgQ1BVIGNvcmVzXG4gICAgICBjb25zdCBkZXJpdmVkRGF0YVBhdGggPSBhd2FpdCB0aGlzLndkYS5yZXRyaWV2ZURlcml2ZWREYXRhUGF0aCgpO1xuICAgICAgaWYgKGRlcml2ZWREYXRhUGF0aCkge1xuICAgICAgICBzeW5jaHJvbml6YXRpb25LZXkgPSBwYXRoLm5vcm1hbGl6ZShkZXJpdmVkRGF0YVBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmxvZy5kZWJ1ZyhgU3RhcnRpbmcgV2ViRHJpdmVyQWdlbnQgaW5pdGlhbGl6YXRpb24gd2l0aCB0aGUgc3luY2hyb25pemF0aW9uIGtleSAnJHtzeW5jaHJvbml6YXRpb25LZXl9J2ApO1xuICAgIGlmIChTSEFSRURfUkVTT1VSQ0VTX0dVQVJELmlzQnVzeSgpICYmICF0aGlzLm9wdHMuZGVyaXZlZERhdGFQYXRoICYmICF0aGlzLm9wdHMuYm9vdHN0cmFwUGF0aCkge1xuICAgICAgdGhpcy5sb2cuZGVidWcoYENvbnNpZGVyIHNldHRpbmcgYSB1bmlxdWUgJ2Rlcml2ZWREYXRhUGF0aCcgY2FwYWJpbGl0eSB2YWx1ZSBmb3IgZWFjaCBwYXJhbGxlbCBkcml2ZXIgaW5zdGFuY2UgYCArXG4gICAgICAgIGB0byBhdm9pZCBjb25mbGljdHMgYW5kIHNwZWVkIHVwIHRoZSBidWlsZGluZyBwcm9jZXNzYCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBTSEFSRURfUkVTT1VSQ0VTX0dVQVJELmFjcXVpcmUoc3luY2hyb25pemF0aW9uS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5vcHRzLnVzZU5ld1dEQSkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgQ2FwYWJpbGl0eSAndXNlTmV3V0RBJyBzZXQgdG8gdHJ1ZSwgc28gdW5pbnN0YWxsaW5nIFdEQSBiZWZvcmUgcHJvY2VlZGluZ2ApO1xuICAgICAgICBhd2FpdCB0aGlzLndkYS5xdWl0QW5kVW5pbnN0YWxsKCk7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVVuaW5zdGFsbGVkJyk7XG4gICAgICB9IGVsc2UgaWYgKCF1dGlsLmhhc1ZhbHVlKHRoaXMud2RhLndlYkRyaXZlckFnZW50VXJsKSkge1xuICAgICAgICBhd2FpdCB0aGlzLndkYS5zZXR1cENhY2hpbmcoKTtcbiAgICAgIH1cblxuICAgICAgLy8gbG9jYWwgaGVscGVyIGZvciB0aGUgdHdvIHBsYWNlcyB3ZSBuZWVkIHRvIHVuaW5zdGFsbCB3ZGEgYW5kIHJlLXN0YXJ0IGl0XG4gICAgICBjb25zdCBxdWl0QW5kVW5pbnN0YWxsID0gYXN5bmMgKG1zZykgPT4ge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1Zyhtc2cpO1xuICAgICAgICBpZiAodGhpcy5vcHRzLndlYkRyaXZlckFnZW50VXJsKSB7XG4gICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ05vdCBxdWl0dGluZy91bmluc3RhbGxpbmcgV2ViRHJpdmVyQWdlbnQgc2luY2Ugd2ViRHJpdmVyQWdlbnRVcmwgY2FwYWJpbGl0eSBpcyBwcm92aWRlZCcpO1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ1F1aXR0aW5nIGFuZCB1bmluc3RhbGxpbmcgV2ViRHJpdmVyQWdlbnQnKTtcbiAgICAgICAgYXdhaXQgdGhpcy53ZGEucXVpdEFuZFVuaW5zdGFsbCgpO1xuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgfTtcblxuICAgICAgLy8gVXNlZCBpbiB0aGUgZm9sbG93aW5nIFdEQSBidWlsZFxuICAgICAgaWYgKHRoaXMub3B0cy5yZXN1bHRCdW5kbGVQYXRoKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRmVhdHVyZUVuYWJsZWQoQ1VTVE9NSVpFX1JFU1VMVF9CVU5EUEVfUEFUSCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHN0YXJ0dXBSZXRyaWVzID0gdGhpcy5vcHRzLndkYVN0YXJ0dXBSZXRyaWVzIHx8ICh0aGlzLmlzUmVhbERldmljZSgpID8gV0RBX1JFQUxfREVWX1NUQVJUVVBfUkVUUklFUyA6IFdEQV9TSU1fU1RBUlRVUF9SRVRSSUVTKTtcbiAgICAgIGNvbnN0IHN0YXJ0dXBSZXRyeUludGVydmFsID0gdGhpcy5vcHRzLndkYVN0YXJ0dXBSZXRyeUludGVydmFsIHx8IFdEQV9TVEFSVFVQX1JFVFJZX0lOVEVSVkFMO1xuICAgICAgdGhpcy5sb2cuZGVidWcoYFRyeWluZyB0byBzdGFydCBXZWJEcml2ZXJBZ2VudCAke3N0YXJ0dXBSZXRyaWVzfSB0aW1lcyB3aXRoICR7c3RhcnR1cFJldHJ5SW50ZXJ2YWx9bXMgaW50ZXJ2YWxgKTtcbiAgICAgIGlmICghdXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJpZXMpICYmICF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy53ZGFTdGFydHVwUmV0cnlJbnRlcnZhbCkpIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoYFRoZXNlIHZhbHVlcyBjYW4gYmUgY3VzdG9taXplZCBieSBjaGFuZ2luZyB3ZGFTdGFydHVwUmV0cmllcy93ZGFTdGFydHVwUmV0cnlJbnRlcnZhbCBjYXBhYmlsaXRpZXNgKTtcbiAgICAgIH1cbiAgICAgIGxldCByZXRyeUNvdW50ID0gMDtcbiAgICAgIGF3YWl0IHJldHJ5SW50ZXJ2YWwoc3RhcnR1cFJldHJpZXMsIHN0YXJ0dXBSZXRyeUludGVydmFsLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVN0YXJ0QXR0ZW1wdGVkJyk7XG4gICAgICAgIGlmIChyZXRyeUNvdW50ID4gMCkge1xuICAgICAgICAgIHRoaXMubG9nLmluZm8oYFJldHJ5aW5nIFdEQSBzdGFydHVwICgke3JldHJ5Q291bnQgKyAxfSBvZiAke3N0YXJ0dXBSZXRyaWVzfSlgKTtcbiAgICAgICAgfVxuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIG9uIHhjb2RlIDEwIGluc3RhbGxkIHdpbGwgb2Z0ZW4gdHJ5IHRvIGFjY2VzcyB0aGUgYXBwIGZyb20gaXRzIHN0YWdpbmdcbiAgICAgICAgICAvLyBkaXJlY3RvcnkgYmVmb3JlIGZ1bGx5IG1vdmluZyBpdCB0aGVyZSwgYW5kIGZhaWwuIFJldHJ5aW5nIG9uY2VcbiAgICAgICAgICAvLyBpbW1lZGlhdGVseSBoZWxwc1xuICAgICAgICAgIGNvbnN0IHJldHJpZXMgPSB0aGlzLnhjb2RlVmVyc2lvbi5tYWpvciA+PSAxMCA/IDIgOiAxO1xuICAgICAgICAgIHRoaXMuY2FjaGVkV2RhU3RhdHVzID0gYXdhaXQgcmV0cnkocmV0cmllcywgdGhpcy53ZGEubGF1bmNoLmJpbmQodGhpcy53ZGEpLCBzZXNzaW9uSWQsIHJlYWxEZXZpY2UpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICB0aGlzLmxvZ0V2ZW50KCd3ZGFTdGFydEZhaWxlZCcpO1xuICAgICAgICAgIHJldHJ5Q291bnQrKztcbiAgICAgICAgICBsZXQgZXJyb3JNc2cgPSBgVW5hYmxlIHRvIGxhdW5jaCBXZWJEcml2ZXJBZ2VudCBiZWNhdXNlIG9mIHhjb2RlYnVpbGQgZmFpbHVyZTogJHtlcnIubWVzc2FnZX1gO1xuICAgICAgICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICAgICAgICBlcnJvck1zZyArPSBgLiBNYWtlIHN1cmUgeW91IGZvbGxvdyB0aGUgdHV0b3JpYWwgYXQgJHtXREFfUkVBTF9ERVZfVFVUT1JJQUxfVVJMfS4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgICBgVHJ5IHRvIHJlbW92ZSB0aGUgV2ViRHJpdmVyQWdlbnRSdW5uZXIgYXBwbGljYXRpb24gZnJvbSB0aGUgZGV2aWNlIGlmIGl0IGlzIGluc3RhbGxlZCBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBhbmQgcmVib290IHRoZSBkZXZpY2UuYDtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgcXVpdEFuZFVuaW5zdGFsbChlcnJvck1zZyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnByb3h5UmVxUmVzID0gdGhpcy53ZGEucHJveHlSZXFSZXMuYmluZCh0aGlzLndkYSk7XG4gICAgICAgIHRoaXMuandwUHJveHlBY3RpdmUgPSB0cnVlO1xuXG4gICAgICAgIGxldCBvcmlnaW5hbFN0YWNrdHJhY2UgPSBudWxsO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHJldHJ5SW50ZXJ2YWwoMTUsIDEwMDAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVNlc3Npb25BdHRlbXB0ZWQnKTtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKCdTZW5kaW5nIGNyZWF0ZVNlc3Npb24gY29tbWFuZCB0byBXREEnKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHRoaXMuY2FjaGVkV2RhU3RhdHVzID0gdGhpcy5jYWNoZWRXZGFTdGF0dXMgfHwgYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9zdGF0dXMnLCAnR0VUJyk7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuc3RhcnRXZGFTZXNzaW9uKHRoaXMub3B0cy5idW5kbGVJZCwgdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgIG9yaWdpbmFsU3RhY2t0cmFjZSA9IGVyci5zdGFjaztcbiAgICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoYEZhaWxlZCB0byBjcmVhdGUgV0RBIHNlc3Npb24gKCR7ZXJyLm1lc3NhZ2V9KS4gUmV0cnlpbmcuLi5gKTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVNlc3Npb25TdGFydGVkJyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGlmIChvcmlnaW5hbFN0YWNrdHJhY2UpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmRlYnVnKG9yaWdpbmFsU3RhY2t0cmFjZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxldCBlcnJvck1zZyA9IGBVbmFibGUgdG8gc3RhcnQgV2ViRHJpdmVyQWdlbnQgc2Vzc2lvbiBiZWNhdXNlIG9mIHhjb2RlYnVpbGQgZmFpbHVyZTogJHtlcnIubWVzc2FnZX1gO1xuICAgICAgICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICAgICAgICBlcnJvck1zZyArPSBgIE1ha2Ugc3VyZSB5b3UgZm9sbG93IHRoZSB0dXRvcmlhbCBhdCAke1dEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkx9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBUcnkgdG8gcmVtb3ZlIHRoZSBXZWJEcml2ZXJBZ2VudFJ1bm5lciBhcHBsaWNhdGlvbiBmcm9tIHRoZSBkZXZpY2UgaWYgaXQgaXMgaW5zdGFsbGVkIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYGFuZCByZWJvb3QgdGhlIGRldmljZS5gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBxdWl0QW5kVW5pbnN0YWxsKGVycm9yTXNnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLm9wdHMuY2xlYXJTeXN0ZW1GaWxlcyAmJiAhdGhpcy5vcHRzLndlYkRyaXZlckFnZW50VXJsKSB7XG4gICAgICAgICAgYXdhaXQgbWFya1N5c3RlbUZpbGVzRm9yQ2xlYW51cCh0aGlzLndkYSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB3ZSBleHBlY3QgY2VydGFpbiBzb2NrZXQgZXJyb3JzIHVudGlsIHRoaXMgcG9pbnQsIGJ1dCBub3dcbiAgICAgICAgLy8gbWFyayB0aGluZ3MgYXMgZnVsbHkgd29ya2luZ1xuICAgICAgICB0aGlzLndkYS5mdWxseVN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLmxvZ0V2ZW50KCd3ZGFTdGFydGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHJ1blJlc2V0IChvcHRzID0gbnVsbCkge1xuICAgIHRoaXMubG9nRXZlbnQoJ3Jlc2V0U3RhcnRlZCcpO1xuICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICBhd2FpdCBydW5SZWFsRGV2aWNlUmVzZXQodGhpcy5vcHRzLmRldmljZSwgb3B0cyB8fCB0aGlzLm9wdHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBydW5TaW11bGF0b3JSZXNldCh0aGlzLm9wdHMuZGV2aWNlLCBvcHRzIHx8IHRoaXMub3B0cyk7XG4gICAgfVxuICAgIHRoaXMubG9nRXZlbnQoJ3Jlc2V0Q29tcGxldGUnKTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZVNlc3Npb24gKCkge1xuICAgIGF3YWl0IHJlbW92ZUFsbFNlc3Npb25XZWJTb2NrZXRIYW5kbGVycyh0aGlzLnNlcnZlciwgdGhpcy5zZXNzaW9uSWQpO1xuXG4gICAgZm9yIChjb25zdCByZWNvcmRlciBvZiBfLmNvbXBhY3QoW1xuICAgICAgdGhpcy5fcmVjZW50U2NyZWVuUmVjb3JkZXIsIHRoaXMuX2F1ZGlvUmVjb3JkZXIsIHRoaXMuX3RyYWZmaWNDYXB0dXJlXG4gICAgXSkpIHtcbiAgICAgIGF3YWl0IHJlY29yZGVyLmludGVycnVwdCh0cnVlKTtcbiAgICAgIGF3YWl0IHJlY29yZGVyLmNsZWFudXAoKTtcbiAgICB9XG5cbiAgICBpZiAoIV8uaXNFbXB0eSh0aGlzLl9wZXJmUmVjb3JkZXJzKSkge1xuICAgICAgYXdhaXQgQi5hbGwodGhpcy5fcGVyZlJlY29yZGVycy5tYXAoKHgpID0+IHguc3RvcCh0cnVlKSkpO1xuICAgICAgdGhpcy5fcGVyZlJlY29yZGVycyA9IFtdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9jb25kaXRpb25JbmR1Y2VyU2VydmljZSkge1xuICAgICAgdGhpcy5tb2JpbGVEaXNhYmxlQ29uZGl0aW9uSW5kdWNlcigpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc3RvcCgpO1xuXG4gICAgaWYgKHRoaXMud2RhICYmICF0aGlzLm9wdHMud2ViRHJpdmVyQWdlbnRVcmwpIHtcbiAgICAgIGlmICh0aGlzLm9wdHMuY2xlYXJTeXN0ZW1GaWxlcykge1xuICAgICAgICBsZXQgc3luY2hyb25pemF0aW9uS2V5ID0gWENVSVRlc3REcml2ZXIubmFtZTtcbiAgICAgICAgY29uc3QgZGVyaXZlZERhdGFQYXRoID0gYXdhaXQgdGhpcy53ZGEucmV0cmlldmVEZXJpdmVkRGF0YVBhdGgoKTtcbiAgICAgICAgaWYgKGRlcml2ZWREYXRhUGF0aCkge1xuICAgICAgICAgIHN5bmNocm9uaXphdGlvbktleSA9IHBhdGgubm9ybWFsaXplKGRlcml2ZWREYXRhUGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgU0hBUkVEX1JFU09VUkNFU19HVUFSRC5hY3F1aXJlKHN5bmNocm9uaXphdGlvbktleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGNsZWFyU3lzdGVtRmlsZXModGhpcy53ZGEpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKCdOb3QgY2xlYXJpbmcgbG9nIGZpbGVzLiBVc2UgYGNsZWFyU3lzdGVtRmlsZXNgIGNhcGFiaWxpdHkgdG8gdHVybiBvbi4nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5yZW1vdGUpIHtcbiAgICAgIHRoaXMubG9nLmRlYnVnKCdGb3VuZCBhIHJlbW90ZSBkZWJ1Z2dlciBzZXNzaW9uLiBSZW1vdmluZy4uLicpO1xuICAgICAgYXdhaXQgdGhpcy5zdG9wUmVtb3RlKCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seSA9PT0gZmFsc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUmVzZXQoT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5vcHRzLCB7XG4gICAgICAgIGVuZm9yY2VTaW11bGF0b3JTaHV0ZG93bjogdHJ1ZSxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1NpbXVsYXRvcigpICYmICF0aGlzLm9wdHMubm9SZXNldCAmJiAhIXRoaXMub3B0cy5kZXZpY2UpIHtcbiAgICAgIGlmICh0aGlzLmxpZmVjeWNsZURhdGEuY3JlYXRlU2ltKSB7XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKGBEZWxldGluZyBzaW11bGF0b3IgY3JlYXRlZCBmb3IgdGhpcyBydW4gKHVkaWQ6ICcke3RoaXMub3B0cy51ZGlkfScpYCk7XG4gICAgICAgIGF3YWl0IHNodXRkb3duU2ltdWxhdG9yKHRoaXMub3B0cy5kZXZpY2UpO1xuICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmRlbGV0ZSgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNob3VsZFJlc2V0TG9jYXRpb25TZXJ2aXZjZSA9IHRoaXMuaXNSZWFsRGV2aWNlKCkgJiYgISF0aGlzLm9wdHMucmVzZXRMb2NhdGlvblNlcnZpY2U7XG4gICAgaWYgKHNob3VsZFJlc2V0TG9jYXRpb25TZXJ2aXZjZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5tb2JpbGVSZXNldExvY2F0aW9uU2VydmljZSgpO1xuICAgICAgfSBjYXRjaCAoaWdub3JlKSB7IC8qIElnbm9yZSB0aGlzIGVycm9yIHNpbmNlIG1vYmlsZVJlc2V0TG9jYXRpb25TZXJ2aWNlIGFscmVhZHkgbG9nZ2VkIHRoZSBlcnJvciAqLyB9XG4gICAgfVxuXG4gICAgaWYgKCFfLmlzRW1wdHkodGhpcy5sb2dzKSkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dzLnN5c2xvZy5zdG9wQ2FwdHVyZSgpO1xuICAgICAgdGhpcy5sb2dzID0ge307XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWpwZWdTdHJlYW0pIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ0Nsb3NpbmcgTUpQRUcgc3RyZWFtJyk7XG4gICAgICB0aGlzLm1qcGVnU3RyZWFtLnN0b3AoKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlc2V0SW9zKCk7XG5cbiAgICBhd2FpdCBzdXBlci5kZWxldGVTZXNzaW9uKCk7XG4gIH1cblxuICBhc3luYyBzdG9wICgpIHtcbiAgICB0aGlzLmp3cFByb3h5QWN0aXZlID0gZmFsc2U7XG4gICAgdGhpcy5wcm94eVJlcVJlcyA9IG51bGw7XG5cblxuICAgIGlmICh0aGlzLndkYSAmJiB0aGlzLndkYS5mdWxseVN0YXJ0ZWQpIHtcbiAgICAgIGlmICh0aGlzLndkYS5qd3Byb3h5KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoYC9zZXNzaW9uLyR7dGhpcy5zZXNzaW9uSWR9YCwgJ0RFTEVURScpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAvLyBhbiBlcnJvciBoZXJlIHNob3VsZCBub3Qgc2hvcnQtY2lyY3VpdCB0aGUgcmVzdCBvZiBjbGVhbiB1cFxuICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBVbmFibGUgdG8gREVMRVRFIHNlc3Npb24gb24gV0RBOiAnJHtlcnIubWVzc2FnZX0nLiBDb250aW51aW5nIHNodXRkb3duLmApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMud2RhLndlYkRyaXZlckFnZW50VXJsICYmIHRoaXMub3B0cy51c2VOZXdXREEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53ZGEucXVpdCgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIERFVklDRV9DT05ORUNUSU9OU19GQUNUT1JZLnJlbGVhc2VDb25uZWN0aW9uKHRoaXMub3B0cy51ZGlkKTtcbiAgfVxuXG4gIGFzeW5jIGV4ZWN1dGVDb21tYW5kIChjbWQsIC4uLmFyZ3MpIHtcbiAgICB0aGlzLmxvZy5kZWJ1ZyhgRXhlY3V0aW5nIGNvbW1hbmQgJyR7Y21kfSdgKTtcblxuICAgIGlmIChjbWQgPT09ICdyZWNlaXZlQXN5bmNSZXNwb25zZScpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlY2VpdmVBc3luY1Jlc3BvbnNlKC4uLmFyZ3MpO1xuICAgIH1cbiAgICAvLyBUT0RPOiBvbmNlIHRoaXMgZml4IGdldHMgaW50byBiYXNlIGRyaXZlciByZW1vdmUgZnJvbSBoZXJlXG4gICAgaWYgKGNtZCA9PT0gJ2dldFN0YXR1cycpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmdldFN0YXR1cygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgc3VwZXIuZXhlY3V0ZUNvbW1hbmQoY21kLCAuLi5hcmdzKTtcbiAgfVxuXG4gIGFzeW5jIGNvbmZpZ3VyZUFwcCAoKSB7XG4gICAgZnVuY3Rpb24gYXBwSXNQYWNrYWdlT3JCdW5kbGUgKGFwcCkge1xuICAgICAgcmV0dXJuICgvXihbYS16QS1aMC05XFwtX10rXFwuW2EtekEtWjAtOVxcLV9dKykrJC8pLnRlc3QoYXBwKTtcbiAgICB9XG5cbiAgICAvLyB0aGUgYXBwIG5hbWUgaXMgYSBidW5kbGVJZCBhc3NpZ24gaXQgdG8gdGhlIGJ1bmRsZUlkIHByb3BlcnR5XG4gICAgaWYgKCF0aGlzLm9wdHMuYnVuZGxlSWQgJiYgYXBwSXNQYWNrYWdlT3JCdW5kbGUodGhpcy5vcHRzLmFwcCkpIHtcbiAgICAgIHRoaXMub3B0cy5idW5kbGVJZCA9IHRoaXMub3B0cy5hcHA7XG4gICAgICB0aGlzLm9wdHMuYXBwID0gJyc7XG4gICAgfVxuICAgIC8vIHdlIGhhdmUgYSBidW5kbGUgSUQsIGJ1dCBubyBhcHAsIG9yIGFwcCBpcyBhbHNvIGEgYnVuZGxlXG4gICAgaWYgKCh0aGlzLm9wdHMuYnVuZGxlSWQgJiYgYXBwSXNQYWNrYWdlT3JCdW5kbGUodGhpcy5vcHRzLmJ1bmRsZUlkKSkgJiZcbiAgICAgICAgKHRoaXMub3B0cy5hcHAgPT09ICcnIHx8IGFwcElzUGFja2FnZU9yQnVuZGxlKHRoaXMub3B0cy5hcHApKSkge1xuICAgICAgdGhpcy5sb2cuZGVidWcoJ0FwcCBpcyBhbiBpT1MgYnVuZGxlLCB3aWxsIGF0dGVtcHQgdG8gcnVuIGFzIHByZS1leGlzdGluZycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIGNoZWNrIGZvciBzdXBwb3J0ZWQgYnVpbGQtaW4gYXBwc1xuICAgIHN3aXRjaCAoXy50b0xvd2VyKHRoaXMub3B0cy5hcHApKSB7XG4gICAgICBjYXNlICdzZXR0aW5ncyc6XG4gICAgICAgIHRoaXMub3B0cy5idW5kbGVJZCA9ICdjb20uYXBwbGUuUHJlZmVyZW5jZXMnO1xuICAgICAgICB0aGlzLm9wdHMuYXBwID0gbnVsbDtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnY2FsZW5kYXInOlxuICAgICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSAnY29tLmFwcGxlLm1vYmlsZWNhbCc7XG4gICAgICAgIHRoaXMub3B0cy5hcHAgPSBudWxsO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5vcHRzLmFwcCA9IGF3YWl0IHRoaXMuaGVscGVycy5jb25maWd1cmVBcHAodGhpcy5vcHRzLmFwcCwge1xuICAgICAgb25Qb3N0UHJvY2VzczogdGhpcy5vblBvc3RDb25maWd1cmVBcHAuYmluZCh0aGlzKSxcbiAgICAgIHN1cHBvcnRlZEV4dGVuc2lvbnM6IFNVUFBPUlRFRF9FWFRFTlNJT05TXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVW56aXAgdGhlIGdpdmVuIGFyY2hpdmUgYW5kIGZpbmQgYSBtYXRjaGluZyAuYXBwIGJ1bmRsZSBpbiBpdFxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXBwUGF0aCBUaGUgcGF0aCB0byB0aGUgYXJjaGl2ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGRlcHRoIFswXSB0aGUgY3VycmVudCBuZXN0aW5nIGRlcHRoLiBBcHAgYnVuZGxlcyB3aG9zZSBuZXN0aW5nIGxldmVsXG4gICAqIGlzIGdyZWF0ZXIgdGhhbiAxIGFyZSBub3Qgc3VwcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGdWxsIHBhdGggdG8gdGhlIGZpcnN0IG1hdGNoaW5nIC5hcHAgYnVuZGxlLi5cbiAgICogQHRocm93cyBJZiBubyBtYXRjaGluZyAuYXBwIGJ1bmRsZXMgd2VyZSBmb3VuZCBpbiB0aGUgcHJvdmlkZWQgYXJjaGl2ZS5cbiAgICovXG4gIGFzeW5jIHVuemlwQXBwIChhcHBQYXRoLCBkZXB0aCA9IDApIHtcbiAgICBpZiAoZGVwdGggPiBNQVhfQVJDSElWRV9TQ0FOX0RFUFRIKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ05lc3Rpbmcgb2YgcGFja2FnZSBidW5kbGVzIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbiAgICB9XG4gICAgY29uc3QgW3Jvb3REaXIsIG1hdGNoZWRQYXRoc10gPSBhd2FpdCBmaW5kQXBwcyhhcHBQYXRoLCBTVVBQT1JURURfRVhURU5TSU9OUyk7XG4gICAgaWYgKF8uaXNFbXB0eShtYXRjaGVkUGF0aHMpKSB7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgJyR7cGF0aC5iYXNlbmFtZShhcHBQYXRoKX0nIGhhcyBubyBidW5kbGVzYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nLmRlYnVnKFxuICAgICAgICBgRm91bmQgJHt1dGlsLnBsdXJhbGl6ZSgnYnVuZGxlJywgbWF0Y2hlZFBhdGhzLmxlbmd0aCwgdHJ1ZSl9IGluIGAgK1xuICAgICAgICBgJyR7cGF0aC5iYXNlbmFtZShhcHBQYXRoKX0nOiAke21hdGNoZWRQYXRoc31gXG4gICAgICApO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCBtYXRjaGVkUGF0aCBvZiBtYXRjaGVkUGF0aHMpIHtcbiAgICAgICAgY29uc3QgZnVsbFBhdGggPSBwYXRoLmpvaW4ocm9vdERpciwgbWF0Y2hlZFBhdGgpO1xuICAgICAgICBpZiAoYXdhaXQgaXNBcHBCdW5kbGUoZnVsbFBhdGgpKSB7XG4gICAgICAgICAgY29uc3Qgc3VwcG9ydGVkUGxhdGZvcm1zID0gYXdhaXQgZmV0Y2hTdXBwb3J0ZWRBcHBQbGF0Zm9ybXMoZnVsbFBhdGgpO1xuICAgICAgICAgIGlmICh0aGlzLmlzU2ltdWxhdG9yKCkgJiYgIXN1cHBvcnRlZFBsYXRmb3Jtcy5zb21lKChwKSA9PiBfLmluY2x1ZGVzKHAsICdTaW11bGF0b3InKSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmluZm8oYCcke21hdGNoZWRQYXRofScgZG9lcyBub3QgaGF2ZSBTaW11bGF0b3IgZGV2aWNlcyBpbiB0aGUgbGlzdCBvZiBzdXBwb3J0ZWQgcGxhdGZvcm1zIGAgK1xuICAgICAgICAgICAgICBgKCR7c3VwcG9ydGVkUGxhdGZvcm1zLmpvaW4oJywnKX0pLiBTa2lwcGluZyBpdGApOztcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5pc1JlYWxEZXZpY2UoKSAmJiAhc3VwcG9ydGVkUGxhdGZvcm1zLnNvbWUoKHApID0+IF8uaW5jbHVkZXMocCwgJ09TJykpKSB7XG4gICAgICAgICAgICB0aGlzLmxvZy5pbmZvKGAnJHttYXRjaGVkUGF0aH0nIGRvZXMgbm90IGhhdmUgcmVhbCBkZXZpY2VzIGluIHRoZSBsaXN0IG9mIHN1cHBvcnRlZCBwbGF0Zm9ybXMgYCArXG4gICAgICAgICAgICAgIGAoJHtzdXBwb3J0ZWRQbGF0Zm9ybXMuam9pbignLCcpfSkuIFNraXBwaW5nIGl0YCk7O1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMubG9nLmluZm8oYCcke21hdGNoZWRQYXRofScgaXMgdGhlIHJlc3VsdGluZyBhcHBsaWNhdGlvbiBidW5kbGUgc2VsZWN0ZWQgZnJvbSAnJHthcHBQYXRofSdgKTtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgaXNvbGF0ZUFwcEJ1bmRsZShmdWxsUGF0aCk7XG4gICAgICAgIH0gZWxzZSBpZiAoXy5lbmRzV2l0aChfLnRvTG93ZXIoZnVsbFBhdGgpLCBJUEFfRVhUKSAmJiAoYXdhaXQgZnMuc3RhdChmdWxsUGF0aCkpLmlzRmlsZSgpKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnVuemlwQXBwKGZ1bGxQYXRoLCBkZXB0aCArIDEpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLndhcm4oYFNraXBwaW5nIHByb2Nlc3Npbmcgb2YgJyR7bWF0Y2hlZFBhdGh9JzogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IGZzLnJpbXJhZihyb290RGlyKTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMub3B0cy5hcHB9IGRpZCBub3QgaGF2ZSBhbnkgbWF0Y2hpbmcgJHtBUFBfRVhUfSBvciAke0lQQV9FWFR9IGAgK1xuICAgICAgYGJ1bmRsZXMuIFBsZWFzZSBtYWtlIHN1cmUgdGhlIHByb3ZpZGVkIHBhY2thZ2UgaXMgdmFsaWQgYW5kIGNvbnRhaW5zIGF0IGxlYXN0IG9uZSBtYXRjaGluZyBgICtcbiAgICAgIGBhcHBsaWNhdGlvbiBidW5kbGUgd2hpY2ggaXMgbm90IG5lc3RlZC5gXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIG9uUG9zdENvbmZpZ3VyZUFwcCAoe2NhY2hlZEFwcEluZm8sIGlzVXJsLCBhcHBQYXRofSkge1xuICAgIC8vIFBpY2sgdGhlIHByZXZpb3VzbHkgY2FjaGVkIGVudHJ5IGlmIGl0cyBpbnRlZ3JpdHkgaGFzIGJlZW4gcHJlc2VydmVkXG4gICAgaWYgKF8uaXNQbGFpbk9iamVjdChjYWNoZWRBcHBJbmZvKVxuICAgICAgICAmJiAoYXdhaXQgZnMuc3RhdChhcHBQYXRoKSkuaXNGaWxlKClcbiAgICAgICAgJiYgYXdhaXQgZnMuaGFzaChhcHBQYXRoKSA9PT0gY2FjaGVkQXBwSW5mby5wYWNrYWdlSGFzaFxuICAgICAgICAmJiBhd2FpdCBmcy5leGlzdHMoY2FjaGVkQXBwSW5mby5mdWxsUGF0aClcbiAgICAgICAgJiYgKGF3YWl0IGZzLmdsb2IoJyoqLyonLCB7XG4gICAgICAgICAgY3dkOiBjYWNoZWRBcHBJbmZvLmZ1bGxQYXRoLCBzdHJpY3Q6IGZhbHNlLCBub3NvcnQ6IHRydWVcbiAgICAgICAgfSkpLmxlbmd0aCA9PT0gY2FjaGVkQXBwSW5mby5pbnRlZ3JpdHkuZm9sZGVyKSB7XG4gICAgICB0aGlzLmxvZy5pbmZvKGBVc2luZyAnJHtjYWNoZWRBcHBJbmZvLmZ1bGxQYXRofScgd2hpY2ggd2FzIGNhY2hlZCBmcm9tICcke2FwcFBhdGh9J2ApO1xuICAgICAgcmV0dXJuIHthcHBQYXRoOiBjYWNoZWRBcHBJbmZvLmZ1bGxQYXRofTtcbiAgICB9XG5cbiAgICAvLyBPbmx5IGxvY2FsIC5hcHAgYnVuZGxlcyB0aGF0IGFyZSBhdmFpbGFibGUgaW4tcGxhY2Ugc2hvdWxkIG5vdCBiZSBjYWNoZWRcbiAgICBpZiAoYXdhaXQgaXNBcHBCdW5kbGUoYXBwUGF0aCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBFeHRyYWN0IHRoZSBhcHAgYnVuZGxlIGFuZCBjYWNoZSBpdFxuICAgIHRyeSB7XG4gICAgICByZXR1cm4ge2FwcFBhdGg6IGF3YWl0IHRoaXMudW56aXBBcHAoYXBwUGF0aCl9O1xuICAgIH0gZmluYWxseSB7XG4gICAgICAvLyBDbGVhbnVwIHByZXZpb3VzbHkgZG93bmxvYWRlZCBhcmNoaXZlXG4gICAgICBpZiAoaXNVcmwpIHtcbiAgICAgICAgYXdhaXQgZnMucmltcmFmKGFwcFBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRldGVybWluZURldmljZSAoKSB7XG4gICAgLy8gaW4gdGhlIG9uZSBjYXNlIHdoZXJlIHdlIGNyZWF0ZSBhIHNpbSwgd2Ugd2lsbCBzZXQgdGhpcyBzdGF0ZVxuICAgIHRoaXMubGlmZWN5Y2xlRGF0YS5jcmVhdGVTaW0gPSBmYWxzZTtcblxuICAgIC8vIGlmIHdlIGdldCBnZW5lcmljIG5hbWVzLCB0cmFuc2xhdGUgdGhlbVxuICAgIHRoaXMub3B0cy5kZXZpY2VOYW1lID0gdHJhbnNsYXRlRGV2aWNlTmFtZSh0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uLCB0aGlzLm9wdHMuZGV2aWNlTmFtZSk7XG5cbiAgICBjb25zdCBzZXR1cFZlcnNpb25DYXBzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5vcHRzLmlvc1Nka1ZlcnNpb24gPSBhd2FpdCBnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24oKTtcbiAgICAgIHRoaXMubG9nLmluZm8oYGlPUyBTREsgVmVyc2lvbiBzZXQgdG8gJyR7dGhpcy5vcHRzLmlvc1Nka1ZlcnNpb259J2ApO1xuICAgICAgaWYgKCF0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uICYmIHRoaXMub3B0cy5pb3NTZGtWZXJzaW9uKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oYE5vIHBsYXRmb3JtVmVyc2lvbiBzcGVjaWZpZWQuIFVzaW5nIHRoZSBsYXRlc3QgdmVyc2lvbiBYY29kZSBzdXBwb3J0czogJyR7dGhpcy5vcHRzLmlvc1Nka1ZlcnNpb259Jy4gYCArXG4gICAgICAgICAgYFRoaXMgbWF5IGNhdXNlIHByb2JsZW1zIGlmIGEgc2ltdWxhdG9yIGRvZXMgbm90IGV4aXN0IGZvciB0aGlzIHBsYXRmb3JtIHZlcnNpb24uYCk7XG4gICAgICAgIHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gPSBub3JtYWxpemVQbGF0Zm9ybVZlcnNpb24odGhpcy5vcHRzLmlvc1Nka1ZlcnNpb24pO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBpZiAodGhpcy5vcHRzLnVkaWQpIHtcbiAgICAgIGlmICh0aGlzLm9wdHMudWRpZC50b0xvd2VyQ2FzZSgpID09PSAnYXV0bycpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLm9wdHMudWRpZCA9IGF3YWl0IGRldGVjdFVkaWQoKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgLy8gVHJ5aW5nIHRvIGZpbmQgbWF0Y2hpbmcgVURJRCBmb3IgU2ltdWxhdG9yXG4gICAgICAgICAgdGhpcy5sb2cud2FybihgQ2Fubm90IGRldGVjdCBhbnkgY29ubmVjdGVkIHJlYWwgZGV2aWNlcy4gRmFsbGluZyBiYWNrIHRvIFNpbXVsYXRvci4gT3JpZ2luYWwgZXJyb3I6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0RXhpc3RpbmdTaW0odGhpcy5vcHRzKTtcbiAgICAgICAgICBpZiAoIWRldmljZSkge1xuICAgICAgICAgICAgLy8gTm8gbWF0Y2hpbmcgU2ltdWxhdG9yIGlzIGZvdW5kLiBUaHJvdyBhbiBlcnJvclxuICAgICAgICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgQ2Fubm90IGRldGVjdCB1ZGlkIGZvciAke3RoaXMub3B0cy5kZXZpY2VOYW1lfSBTaW11bGF0b3IgcnVubmluZyBpT1MgJHt0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9ufWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIE1hdGNoaW5nIFNpbXVsYXRvciBleGlzdHMgYW5kIGlzIGZvdW5kLiBVc2UgaXRcbiAgICAgICAgICB0aGlzLm9wdHMudWRpZCA9IGRldmljZS51ZGlkO1xuICAgICAgICAgIGNvbnN0IGRldmljZVBsYXRmb3JtID0gbm9ybWFsaXplUGxhdGZvcm1WZXJzaW9uKGF3YWl0IGRldmljZS5nZXRQbGF0Zm9ybVZlcnNpb24oKSk7XG4gICAgICAgICAgaWYgKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gIT09IGRldmljZVBsYXRmb3JtKSB7XG4gICAgICAgICAgICB0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uID0gZGV2aWNlUGxhdGZvcm07XG4gICAgICAgICAgICB0aGlzLmxvZy5pbmZvKGBTZXQgcGxhdGZvcm1WZXJzaW9uIHRvICcke2RldmljZVBsYXRmb3JtfScgdG8gbWF0Y2ggdGhlIGRldmljZSB3aXRoIGdpdmVuIFVESURgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgc2V0dXBWZXJzaW9uQ2FwcygpO1xuICAgICAgICAgIHJldHVybiB7ZGV2aWNlLCByZWFsRGV2aWNlOiBmYWxzZSwgdWRpZDogZGV2aWNlLnVkaWR9O1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBtYWtlIHN1cmUgaXQgaXMgYSBjb25uZWN0ZWQgZGV2aWNlLiBJZiBub3QsIHRoZSB1ZGlkIHBhc3NlZCBpbiBpcyBpbnZhbGlkXG4gICAgICAgIGNvbnN0IGRldmljZXMgPSBhd2FpdCBnZXRDb25uZWN0ZWREZXZpY2VzKCk7XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKGBBdmFpbGFibGUgZGV2aWNlczogJHtkZXZpY2VzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIGlmICghZGV2aWNlcy5pbmNsdWRlcyh0aGlzLm9wdHMudWRpZCkpIHtcbiAgICAgICAgICAvLyBjaGVjayBmb3IgYSBwYXJ0aWN1bGFyIHNpbXVsYXRvclxuICAgICAgICAgIHRoaXMubG9nLmRlYnVnKGBObyByZWFsIGRldmljZSB3aXRoIHVkaWQgJyR7dGhpcy5vcHRzLnVkaWR9Jy4gTG9va2luZyBmb3Igc2ltdWxhdG9yYCk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IGdldFNpbXVsYXRvcih0aGlzLm9wdHMudWRpZCwge1xuICAgICAgICAgICAgICBkZXZpY2VzU2V0UGF0aDogdGhpcy5vcHRzLnNpbXVsYXRvckRldmljZXNTZXRQYXRoLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4ge2RldmljZSwgcmVhbERldmljZTogZmFsc2UsIHVkaWQ6IHRoaXMub3B0cy51ZGlkfTtcbiAgICAgICAgICB9IGNhdGNoIChpZ24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBkZXZpY2Ugb3Igc2ltdWxhdG9yIFVESUQ6ICcke3RoaXMub3B0cy51ZGlkfSdgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0UmVhbERldmljZU9iaih0aGlzLm9wdHMudWRpZCk7XG4gICAgICByZXR1cm4ge2RldmljZSwgcmVhbERldmljZTogdHJ1ZSwgdWRpZDogdGhpcy5vcHRzLnVkaWR9O1xuICAgIH1cblxuICAgIC8vIE5vdyB3ZSBrbm93IGZvciBzdXJlIHRoZSBkZXZpY2Ugd2lsbCBiZSBhIFNpbXVsYXRvclxuICAgIGF3YWl0IHNldHVwVmVyc2lvbkNhcHMoKTtcbiAgICBpZiAodGhpcy5vcHRzLmVuZm9yY2VGcmVzaFNpbXVsYXRvckNyZWF0aW9uKSB7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgTmV3IHNpbXVsYXRvciBpcyByZXF1ZXN0ZWQuIElmIHRoaXMgaXMgbm90IHdhbnRlZCwgc2V0ICdlbmZvcmNlRnJlc2hTaW11bGF0b3JDcmVhdGlvbicgY2FwYWJpbGl0eSB0byBmYWxzZWApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IHNpbXVsYXRvciB0byB1c2UsIGdpdmVuIHRoZSBkZXNpcmVkIGNhcGFiaWxpdGllc1xuICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0RXhpc3RpbmdTaW0odGhpcy5vcHRzKTtcblxuICAgICAgLy8gY2hlY2sgZm9yIGFuIGV4aXN0aW5nIHNpbXVsYXRvclxuICAgICAgaWYgKGRldmljZSkge1xuICAgICAgICByZXR1cm4ge2RldmljZSwgcmVhbERldmljZTogZmFsc2UsIHVkaWQ6IGRldmljZS51ZGlkfTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2cuaW5mbygnU2ltdWxhdG9yIHVkaWQgbm90IHByb3ZpZGVkJyk7XG4gICAgfVxuXG4gICAgLy8gbm8gZGV2aWNlIG9mIHRoaXMgdHlwZSBleGlzdHMsIG9yIHRoZXkgcmVxdWVzdCBuZXcgc2ltLCBzbyBjcmVhdGUgb25lXG4gICAgdGhpcy5sb2cuaW5mbygnVXNpbmcgZGVzaXJlZCBjYXBzIHRvIGNyZWF0ZSBhIG5ldyBzaW11bGF0b3InKTtcbiAgICBjb25zdCBkZXZpY2UgPSBhd2FpdCB0aGlzLmNyZWF0ZVNpbSgpO1xuICAgIHJldHVybiB7ZGV2aWNlLCByZWFsRGV2aWNlOiBmYWxzZSwgdWRpZDogZGV2aWNlLnVkaWR9O1xuICB9XG5cbiAgYXN5bmMgc3RhcnRTaW0gKCkge1xuICAgIGNvbnN0IHJ1bk9wdHMgPSB7XG4gICAgICBzY2FsZUZhY3RvcjogdGhpcy5vcHRzLnNjYWxlRmFjdG9yLFxuICAgICAgY29ubmVjdEhhcmR3YXJlS2V5Ym9hcmQ6ICEhdGhpcy5vcHRzLmNvbm5lY3RIYXJkd2FyZUtleWJvYXJkLFxuICAgICAgcGFzdGVib2FyZEF1dG9tYXRpY1N5bmM6IHRoaXMub3B0cy5zaW11bGF0b3JQYXN0ZWJvYXJkQXV0b21hdGljU3luYyA/PyAnb2ZmJyxcbiAgICAgIGlzSGVhZGxlc3M6ICEhdGhpcy5vcHRzLmlzSGVhZGxlc3MsXG4gICAgICB0cmFjZVBvaW50ZXI6IHRoaXMub3B0cy5zaW11bGF0b3JUcmFjZVBvaW50ZXIsXG4gICAgICBkZXZpY2VQcmVmZXJlbmNlczoge30sXG4gICAgfTtcblxuICAgIC8vIGFkZCB0aGUgd2luZG93IGNlbnRlciwgaWYgaXQgaXMgc3BlY2lmaWVkXG4gICAgaWYgKHRoaXMub3B0cy5TaW11bGF0b3JXaW5kb3dDZW50ZXIpIHtcbiAgICAgIHJ1bk9wdHMuZGV2aWNlUHJlZmVyZW5jZXMuU2ltdWxhdG9yV2luZG93Q2VudGVyID0gdGhpcy5vcHRzLlNpbXVsYXRvcldpbmRvd0NlbnRlcjtcbiAgICB9XG5cbiAgICBpZiAoXy5pc0ludGVnZXIodGhpcy5vcHRzLnNpbXVsYXRvclN0YXJ0dXBUaW1lb3V0KSkge1xuICAgICAgcnVuT3B0cy5zdGFydHVwVGltZW91dCA9IHRoaXMub3B0cy5zaW11bGF0b3JTdGFydHVwVGltZW91dDtcbiAgICB9XG5cbiAgICAvLyBUaGlzIGlzIHRvIHdvcmthcm91bmQgWENUZXN0IGJ1ZyBhYm91dCBjaGFuZ2luZyBTaW11bGF0b3JcbiAgICAvLyBvcmllbnRhdGlvbiBpcyBub3Qgc3luY2hyb25pemVkIHRvIHRoZSBhY3R1YWwgd2luZG93IG9yaWVudGF0aW9uXG4gICAgY29uc3Qgb3JpZW50YXRpb24gPSBfLmlzU3RyaW5nKHRoaXMub3B0cy5vcmllbnRhdGlvbikgJiYgdGhpcy5vcHRzLm9yaWVudGF0aW9uLnRvVXBwZXJDYXNlKCk7XG4gICAgc3dpdGNoIChvcmllbnRhdGlvbikge1xuICAgICAgY2FzZSAnTEFORFNDQVBFJzpcbiAgICAgICAgcnVuT3B0cy5kZXZpY2VQcmVmZXJlbmNlcy5TaW11bGF0b3JXaW5kb3dPcmllbnRhdGlvbiA9ICdMYW5kc2NhcGVMZWZ0JztcbiAgICAgICAgcnVuT3B0cy5kZXZpY2VQcmVmZXJlbmNlcy5TaW11bGF0b3JXaW5kb3dSb3RhdGlvbkFuZ2xlID0gOTA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnUE9SVFJBSVQnOlxuICAgICAgICBydW5PcHRzLmRldmljZVByZWZlcmVuY2VzLlNpbXVsYXRvcldpbmRvd09yaWVudGF0aW9uID0gJ1BvcnRyYWl0JztcbiAgICAgICAgcnVuT3B0cy5kZXZpY2VQcmVmZXJlbmNlcy5TaW11bGF0b3JXaW5kb3dSb3RhdGlvbkFuZ2xlID0gMDtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5vcHRzLmRldmljZS5ydW4ocnVuT3B0cyk7XG4gIH1cblxuICBhc3luYyBjcmVhdGVTaW0gKCkge1xuICAgIHRoaXMubGlmZWN5Y2xlRGF0YS5jcmVhdGVTaW0gPSB0cnVlO1xuXG4gICAgLy8gR2V0IHBsYXRmb3JtIG5hbWUgZnJvbSBjb25zdCBzaW5jZSBpdCBtdXN0IGJlIGNhc2Ugc2Vuc2l0aXZlIHRvIGNyZWF0ZSBhIG5ldyBzaW11bGF0b3JcbiAgICBjb25zdCBwbGF0Zm9ybU5hbWUgPSB0aGlzLmlzVHZPUygpID8gUExBVEZPUk1fTkFNRV9UVk9TIDogUExBVEZPUk1fTkFNRV9JT1M7XG5cbiAgICAvLyBjcmVhdGUgc2ltIGZvciBjYXBzXG4gICAgY29uc3Qgc2ltID0gYXdhaXQgY3JlYXRlU2ltKHRoaXMub3B0cywgcGxhdGZvcm1OYW1lKTtcbiAgICB0aGlzLmxvZy5pbmZvKGBDcmVhdGVkIHNpbXVsYXRvciB3aXRoIHVkaWQgJyR7c2ltLnVkaWR9Jy5gKTtcblxuICAgIHJldHVybiBzaW07XG4gIH1cblxuICBhc3luYyBsYXVuY2hBcHAgKCkge1xuICAgIGNvbnN0IEFQUF9MQVVOQ0hfVElNRU9VVCA9IDIwICogMTAwMDtcblxuICAgIHRoaXMubG9nRXZlbnQoJ2FwcExhdW5jaEF0dGVtcHRlZCcpO1xuICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2Uuc2ltY3RsLmxhdW5jaEFwcCh0aGlzLm9wdHMuYnVuZGxlSWQpO1xuXG4gICAgbGV0IGNoZWNrU3RhdHVzID0gYXN5bmMgKCkgPT4ge1xuICAgICAgbGV0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9zdGF0dXMnLCAnR0VUJyk7XG4gICAgICBsZXQgY3VycmVudEFwcCA9IHJlc3BvbnNlLmN1cnJlbnRBcHAuYnVuZGxlSUQ7XG4gICAgICBpZiAoY3VycmVudEFwcCAhPT0gdGhpcy5vcHRzLmJ1bmRsZUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm9wdHMuYnVuZGxlSWR9IG5vdCBpbiBmb3JlZ3JvdW5kLiAke2N1cnJlbnRBcHB9IGlzIGluIGZvcmVncm91bmRgKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgdGhpcy5sb2cuaW5mbyhgV2FpdGluZyBmb3IgJyR7dGhpcy5vcHRzLmJ1bmRsZUlkfScgdG8gYmUgaW4gZm9yZWdyb3VuZGApO1xuICAgIGxldCByZXRyaWVzID0gcGFyc2VJbnQoQVBQX0xBVU5DSF9USU1FT1VUIC8gMjAwLCAxMCk7XG4gICAgYXdhaXQgcmV0cnlJbnRlcnZhbChyZXRyaWVzLCAyMDAsIGNoZWNrU3RhdHVzKTtcbiAgICB0aGlzLmxvZy5pbmZvKGAke3RoaXMub3B0cy5idW5kbGVJZH0gaXMgaW4gZm9yZWdyb3VuZGApO1xuICAgIHRoaXMubG9nRXZlbnQoJ2FwcExhdW5jaGVkJyk7XG4gIH1cblxuICBhc3luYyBzdGFydFdkYVNlc3Npb24gKGJ1bmRsZUlkLCBwcm9jZXNzQXJndW1lbnRzKSB7XG4gICAgY29uc3QgYXJncyA9IHByb2Nlc3NBcmd1bWVudHMgPyAocHJvY2Vzc0FyZ3VtZW50cy5hcmdzIHx8IFtdKSA6IFtdO1xuICAgIGlmICghXy5pc0FycmF5KGFyZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHByb2Nlc3NBcmd1bWVudHMuYXJncyBjYXBhYmlsaXR5IGlzIGV4cGVjdGVkIHRvIGJlIGFuIGFycmF5LiBgICtcbiAgICAgICAgYCR7SlNPTi5zdHJpbmdpZnkoYXJncyl9IGlzIGdpdmVuIGluc3RlYWRgKTtcbiAgICB9XG4gICAgY29uc3QgZW52ID0gcHJvY2Vzc0FyZ3VtZW50cyA/IChwcm9jZXNzQXJndW1lbnRzLmVudiB8fCB7fSkgOiB7fTtcbiAgICBpZiAoIV8uaXNQbGFpbk9iamVjdChlbnYpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHByb2Nlc3NBcmd1bWVudHMuZW52IGNhcGFiaWxpdHkgaXMgZXhwZWN0ZWQgdG8gYmUgYSBkaWN0aW9uYXJ5LiBgICtcbiAgICAgICAgYCR7SlNPTi5zdHJpbmdpZnkoZW52KX0gaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgIH1cblxuICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5sYW5ndWFnZSkpIHtcbiAgICAgIGFyZ3MucHVzaCgnLUFwcGxlTGFuZ3VhZ2VzJywgYCgke3RoaXMub3B0cy5sYW5ndWFnZX0pYCk7XG4gICAgICBhcmdzLnB1c2goJy1OU0xhbmd1YWdlcycsIGAoJHt0aGlzLm9wdHMubGFuZ3VhZ2V9KWApO1xuICAgIH1cbiAgICBpZiAodXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMubG9jYWxlKSkge1xuICAgICAgYXJncy5wdXNoKCctQXBwbGVMb2NhbGUnLCB0aGlzLm9wdHMubG9jYWxlKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRzLm5vUmVzZXQpIHtcbiAgICAgIGlmIChfLmlzTmlsKHRoaXMub3B0cy5zaG91bGRUZXJtaW5hdGVBcHApKSB7XG4gICAgICAgIHRoaXMub3B0cy5zaG91bGRUZXJtaW5hdGVBcHAgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzTmlsKHRoaXMub3B0cy5mb3JjZUFwcExhdW5jaCkpIHtcbiAgICAgICAgdGhpcy5vcHRzLmZvcmNlQXBwTGF1bmNoID0gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgd2RhQ2FwcyA9IHtcbiAgICAgIGJ1bmRsZUlkOiB0aGlzLm9wdHMuYXV0b0xhdW5jaCA9PT0gZmFsc2UgPyB1bmRlZmluZWQgOiBidW5kbGVJZCxcbiAgICAgIGFyZ3VtZW50czogYXJncyxcbiAgICAgIGVudmlyb25tZW50OiBlbnYsXG4gICAgICBldmVudGxvb3BJZGxlRGVsYXlTZWM6IHRoaXMub3B0cy53ZGFFdmVudGxvb3BJZGxlRGVsYXkgPz8gMCxcbiAgICAgIHNob3VsZFdhaXRGb3JRdWllc2NlbmNlOiB0aGlzLm9wdHMud2FpdEZvclF1aWVzY2VuY2UgPz8gdHJ1ZSxcbiAgICAgIHNob3VsZFVzZVRlc3RNYW5hZ2VyRm9yVmlzaWJpbGl0eURldGVjdGlvbjogdGhpcy5vcHRzLnNpbXBsZUlzVmlzaWJsZUNoZWNrID8/IGZhbHNlLFxuICAgICAgbWF4VHlwaW5nRnJlcXVlbmN5OiB0aGlzLm9wdHMubWF4VHlwaW5nRnJlcXVlbmN5ID8/IDYwLFxuICAgICAgc2hvdWxkVXNlU2luZ2xldG9uVGVzdE1hbmFnZXI6IHRoaXMub3B0cy5zaG91bGRVc2VTaW5nbGV0b25UZXN0TWFuYWdlciA/PyB0cnVlLFxuICAgICAgd2FpdEZvcklkbGVUaW1lb3V0OiB0aGlzLm9wdHMud2FpdEZvcklkbGVUaW1lb3V0LFxuICAgICAgc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlczogdGhpcy5vcHRzLnNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXMsXG4gICAgICBlbGVtZW50UmVzcG9uc2VGaWVsZHM6IHRoaXMub3B0cy5lbGVtZW50UmVzcG9uc2VGaWVsZHMsXG4gICAgICBkaXNhYmxlQXV0b21hdGljU2NyZWVuc2hvdHM6IHRoaXMub3B0cy5kaXNhYmxlQXV0b21hdGljU2NyZWVuc2hvdHMsXG4gICAgICBzaG91bGRUZXJtaW5hdGVBcHA6IHRoaXMub3B0cy5zaG91bGRUZXJtaW5hdGVBcHAgPz8gdHJ1ZSxcbiAgICAgIGZvcmNlQXBwTGF1bmNoOiB0aGlzLm9wdHMuZm9yY2VBcHBMYXVuY2ggPz8gdHJ1ZSxcbiAgICAgIHVzZU5hdGl2ZUNhY2hpbmdTdHJhdGVneTogdGhpcy5vcHRzLnVzZU5hdGl2ZUNhY2hpbmdTdHJhdGVneSA/PyB0cnVlLFxuICAgICAgZm9yY2VTaW11bGF0b3JTb2Z0d2FyZUtleWJvYXJkUHJlc2VuY2U6IHRoaXMub3B0cy5mb3JjZVNpbXVsYXRvclNvZnR3YXJlS2V5Ym9hcmRQcmVzZW5jZVxuICAgICAgICA/PyAodGhpcy5vcHRzLmNvbm5lY3RIYXJkd2FyZUtleWJvYXJkID09PSB0cnVlID8gZmFsc2UgOiB0cnVlKSxcbiAgICB9O1xuICAgIGlmICh0aGlzLm9wdHMuYXV0b0FjY2VwdEFsZXJ0cykge1xuICAgICAgd2RhQ2Fwcy5kZWZhdWx0QWxlcnRBY3Rpb24gPSAnYWNjZXB0JztcbiAgICB9IGVsc2UgaWYgKHRoaXMub3B0cy5hdXRvRGlzbWlzc0FsZXJ0cykge1xuICAgICAgd2RhQ2Fwcy5kZWZhdWx0QWxlcnRBY3Rpb24gPSAnZGlzbWlzcyc7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9zZXNzaW9uJywgJ1BPU1QnLCB7XG4gICAgICBjYXBhYmlsaXRpZXM6IHtcbiAgICAgICAgZmlyc3RNYXRjaDogW3dkYUNhcHNdLFxuICAgICAgICBhbHdheXNNYXRjaDoge30sXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBPdmVycmlkZSBQcm94eSBtZXRob2RzIGZyb20gQmFzZURyaXZlclxuICBwcm94eUFjdGl2ZSAoKSB7XG4gICAgcmV0dXJuIHRoaXMuandwUHJveHlBY3RpdmU7XG4gIH1cblxuICBnZXRQcm94eUF2b2lkTGlzdCAoKSB7XG4gICAgaWYgKHRoaXMuaXNXZWJ2aWV3KCkpIHtcbiAgICAgIHJldHVybiBOT19QUk9YWV9XRUJfTElTVDtcbiAgICB9XG4gICAgcmV0dXJuIE5PX1BST1hZX05BVElWRV9MSVNUO1xuICB9XG5cbiAgY2FuUHJveHkgKCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaXNTYWZhcmkgKCkge1xuICAgIHJldHVybiAhIXRoaXMuc2FmYXJpO1xuICB9XG5cbiAgaXNSZWFsRGV2aWNlICgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRzLnJlYWxEZXZpY2U7XG4gIH1cblxuICBpc1NpbXVsYXRvciAoKSB7XG4gICAgcmV0dXJuICF0aGlzLm9wdHMucmVhbERldmljZTtcbiAgfVxuXG4gIGlzVHZPUyAoKSB7XG4gICAgcmV0dXJuIF8udG9Mb3dlcih0aGlzLm9wdHMucGxhdGZvcm1OYW1lKSA9PT0gXy50b0xvd2VyKFBMQVRGT1JNX05BTUVfVFZPUyk7XG4gIH1cblxuICBpc1dlYnZpZXcgKCkge1xuICAgIHJldHVybiB0aGlzLmlzU2FmYXJpKCkgfHwgdGhpcy5pc1dlYkNvbnRleHQoKTtcbiAgfVxuXG4gIHZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5IChzdHJhdGVneSkge1xuICAgIHN1cGVyLnZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5KHN0cmF0ZWd5LCB0aGlzLmlzV2ViQ29udGV4dCgpKTtcbiAgfVxuXG4gIHZhbGlkYXRlRGVzaXJlZENhcHMgKGNhcHMpIHtcbiAgICBpZiAoIXN1cGVyLnZhbGlkYXRlRGVzaXJlZENhcHMoY2FwcykpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhhdCB0aGUgY2FwYWJpbGl0aWVzIGhhdmUgb25lIG9mIGBhcHBgIG9yIGBidW5kbGVJZGBcbiAgICBpZiAoXy50b0xvd2VyKGNhcHMuYnJvd3Nlck5hbWUpICE9PSAnc2FmYXJpJyAmJiAhY2Fwcy5hcHAgJiYgIWNhcHMuYnVuZGxlSWQpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ1RoZSBkZXNpcmVkIGNhcGFiaWxpdGllcyBpbmNsdWRlIG5laXRoZXIgYW4gYXBwIG5vciBhIGJ1bmRsZUlkLiAnICtcbiAgICAgICAgJ1dlYkRyaXZlckFnZW50IHdpbGwgYmUgc3RhcnRlZCB3aXRob3V0IHRoZSBkZWZhdWx0IGFwcCcpO1xuICAgIH1cblxuICAgIGlmICghdXRpbC5jb2VyY2VWZXJzaW9uKGNhcHMucGxhdGZvcm1WZXJzaW9uLCBmYWxzZSkpIHtcbiAgICAgIHRoaXMubG9nLndhcm4oYCdwbGF0Zm9ybVZlcnNpb24nIGNhcGFiaWxpdHkgKCcke2NhcHMucGxhdGZvcm1WZXJzaW9ufScpIGlzIG5vdCBhIHZhbGlkIHZlcnNpb24gbnVtYmVyLiBgICtcbiAgICAgICAgYENvbnNpZGVyIGZpeGluZyBpdCBvciBiZSByZWFkeSB0byBleHBlcmllbmNlIGFuIGluY29uc2lzdGVudCBkcml2ZXIgYmVoYXZpb3IuYCk7XG4gICAgfVxuXG4gICAgbGV0IHZlcmlmeVByb2Nlc3NBcmd1bWVudCA9IChwcm9jZXNzQXJndW1lbnRzKSA9PiB7XG4gICAgICBjb25zdCB7YXJncywgZW52fSA9IHByb2Nlc3NBcmd1bWVudHM7XG4gICAgICBpZiAoIV8uaXNOaWwoYXJncykgJiYgIV8uaXNBcnJheShhcmdzKSkge1xuICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KCdwcm9jZXNzQXJndW1lbnRzLmFyZ3MgbXVzdCBiZSBhbiBhcnJheSBvZiBzdHJpbmdzJyk7XG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNOaWwoZW52KSAmJiAhXy5pc1BsYWluT2JqZWN0KGVudikpIHtcbiAgICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdygncHJvY2Vzc0FyZ3VtZW50cy5lbnYgbXVzdCBiZSBhbiBvYmplY3QgPGtleSx2YWx1ZT4gcGFpciB7YTpiLCBjOmR9Jyk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIC8vIGBwcm9jZXNzQXJndW1lbnRzYCBzaG91bGQgYmUgSlNPTiBzdHJpbmcgb3IgYW4gb2JqZWN0IHdpdGggYXJndW1lbnRzIGFuZC8gZW52aXJvbm1lbnQgZGV0YWlsc1xuICAgIGlmIChjYXBzLnByb2Nlc3NBcmd1bWVudHMpIHtcbiAgICAgIGlmIChfLmlzU3RyaW5nKGNhcHMucHJvY2Vzc0FyZ3VtZW50cykpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyB0cnkgdG8gcGFyc2UgdGhlIHN0cmluZyBhcyBKU09OXG4gICAgICAgICAgY2Fwcy5wcm9jZXNzQXJndW1lbnRzID0gSlNPTi5wYXJzZShjYXBzLnByb2Nlc3NBcmd1bWVudHMpO1xuICAgICAgICAgIHZlcmlmeVByb2Nlc3NBcmd1bWVudChjYXBzLnByb2Nlc3NBcmd1bWVudHMpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGBwcm9jZXNzQXJndW1lbnRzIG11c3QgYmUgYSBKU09OIGZvcm1hdCBvciBhbiBvYmplY3Qgd2l0aCBmb3JtYXQge2FyZ3MgOiBbXSwgZW52IDoge2E6YiwgYzpkfX0uIGAgK1xuICAgICAgICAgICAgYEJvdGggZW52aXJvbm1lbnQgYW5kIGFyZ3VtZW50IGNhbiBiZSBudWxsLiBFcnJvcjogJHtlcnJ9YCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoXy5pc1BsYWluT2JqZWN0KGNhcHMucHJvY2Vzc0FyZ3VtZW50cykpIHtcbiAgICAgICAgdmVyaWZ5UHJvY2Vzc0FyZ3VtZW50KGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGAncHJvY2Vzc0FyZ3VtZW50cyBtdXN0IGJlIGFuIG9iamVjdCwgb3IgYSBzdHJpbmcgSlNPTiBvYmplY3Qgd2l0aCBmb3JtYXQge2FyZ3MgOiBbXSwgZW52IDoge2E6YiwgYzpkfX0uIGAgK1xuICAgICAgICAgIGBCb3RoIGVudmlyb25tZW50IGFuZCBhcmd1bWVudCBjYW4gYmUgbnVsbC5gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0aGVyZSBpcyBubyBwb2ludCBpbiBoYXZpbmcgYGtleWNoYWluUGF0aGAgd2l0aG91dCBga2V5Y2hhaW5QYXNzd29yZGBcbiAgICBpZiAoKGNhcHMua2V5Y2hhaW5QYXRoICYmICFjYXBzLmtleWNoYWluUGFzc3dvcmQpIHx8ICghY2Fwcy5rZXljaGFpblBhdGggJiYgY2Fwcy5rZXljaGFpblBhc3N3b3JkKSkge1xuICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgSWYgJ2tleWNoYWluUGF0aCcgaXMgc2V0LCAna2V5Y2hhaW5QYXNzd29yZCcgbXVzdCBhbHNvIGJlIHNldCAoYW5kIHZpY2UgdmVyc2EpLmApO1xuICAgIH1cblxuICAgIC8vIGByZXNldE9uU2Vzc2lvblN0YXJ0T25seWAgc2hvdWxkIGJlIHNldCB0byB0cnVlIGJ5IGRlZmF1bHRcbiAgICB0aGlzLm9wdHMucmVzZXRPblNlc3Npb25TdGFydE9ubHkgPSAhdXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMucmVzZXRPblNlc3Npb25TdGFydE9ubHkpIHx8IHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seTtcbiAgICB0aGlzLm9wdHMudXNlTmV3V0RBID0gdXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMudXNlTmV3V0RBKSA/IHRoaXMub3B0cy51c2VOZXdXREEgOiBmYWxzZTtcblxuICAgIGlmIChjYXBzLmNvbW1hbmRUaW1lb3V0cykge1xuICAgICAgY2Fwcy5jb21tYW5kVGltZW91dHMgPSBub3JtYWxpemVDb21tYW5kVGltZW91dHMoY2Fwcy5jb21tYW5kVGltZW91dHMpO1xuICAgIH1cblxuICAgIGlmIChfLmlzU3RyaW5nKGNhcHMud2ViRHJpdmVyQWdlbnRVcmwpKSB7XG4gICAgICBjb25zdCB7cHJvdG9jb2wsIGhvc3R9ID0gdXJsLnBhcnNlKGNhcHMud2ViRHJpdmVyQWdlbnRVcmwpO1xuICAgICAgaWYgKF8uaXNFbXB0eShwcm90b2NvbCkgfHwgXy5pc0VtcHR5KGhvc3QpKSB7XG4gICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYCd3ZWJEcml2ZXJBZ2VudFVybCcgY2FwYWJpbGl0eSBpcyBleHBlY3RlZCB0byBjb250YWluIGEgdmFsaWQgV2ViRHJpdmVyQWdlbnQgc2VydmVyIFVSTC4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGAnJHtjYXBzLndlYkRyaXZlckFnZW50VXJsfScgaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjYXBzLmJyb3dzZXJOYW1lKSB7XG4gICAgICBpZiAoY2Fwcy5idW5kbGVJZCkge1xuICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGAnYnJvd3Nlck5hbWUnIGNhbm5vdCBiZSBzZXQgdG9nZXRoZXIgd2l0aCAnYnVuZGxlSWQnIGNhcGFiaWxpdHlgKTtcbiAgICAgIH1cbiAgICAgIC8vIHdhcm4gaWYgdGhlIGNhcGFiaWxpdGllcyBoYXZlIGJvdGggYGFwcGAgYW5kIGBicm93c2VyLCBhbHRob3VnaCB0aGlzXG4gICAgICAvLyBpcyBjb21tb24gd2l0aCBzZWxlbml1bSBncmlkXG4gICAgICBpZiAoY2Fwcy5hcHApIHtcbiAgICAgICAgdGhpcy5sb2cud2FybihgVGhlIGNhcGFiaWxpdGllcyBzaG91bGQgZ2VuZXJhbGx5IG5vdCBpbmNsdWRlIGJvdGggYW4gJ2FwcCcgYW5kIGEgJ2Jyb3dzZXJOYW1lJ2ApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjYXBzLnBlcm1pc3Npb25zKSB7XG4gICAgICB0cnkge1xuICAgICAgICBmb3IgKGNvbnN0IFtidW5kbGVJZCwgcGVybXNdIG9mIF8udG9QYWlycyhKU09OLnBhcnNlKGNhcHMucGVybWlzc2lvbnMpKSkge1xuICAgICAgICAgIGlmICghXy5pc1N0cmluZyhidW5kbGVJZCkpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7SlNPTi5zdHJpbmdpZnkoYnVuZGxlSWQpfScgbXVzdCBiZSBhIHN0cmluZ2ApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIV8uaXNQbGFpbk9iamVjdChwZXJtcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7SlNPTi5zdHJpbmdpZnkocGVybXMpfScgbXVzdCBiZSBhIEpTT04gb2JqZWN0YCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYCcke2NhcHMucGVybWlzc2lvbnN9JyBpcyBleHBlY3RlZCB0byBiZSBhIHZhbGlkIG9iamVjdCB3aXRoIGZvcm1hdCBgICtcbiAgICAgICAgICBge1wiPGJ1bmRsZUlkMT5cIjoge1wiPHNlcnZpY2VOYW1lMT5cIjogXCI8c2VydmljZVN0YXR1czE+XCIsIC4uLn0sIC4uLn0uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2Fwcy5wbGF0Zm9ybVZlcnNpb24gJiYgIXV0aWwuY29lcmNlVmVyc2lvbihjYXBzLnBsYXRmb3JtVmVyc2lvbiwgZmFsc2UpKSB7XG4gICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGAncGxhdGZvcm1WZXJzaW9uJyBtdXN0IGJlIGEgdmFsaWQgdmVyc2lvbiBudW1iZXIuIGAgK1xuICAgICAgICBgJyR7Y2Fwcy5wbGF0Zm9ybVZlcnNpb259JyBpcyBnaXZlbiBpbnN0ZWFkLmApO1xuICAgIH1cblxuICAgIC8vIGFkZGl0aW9uYWxXZWJ2aWV3QnVuZGxlSWRzIGlzIGFuIGFycmF5LCBKU09OIGFycmF5LCBvciBzdHJpbmdcbiAgICBpZiAoY2Fwcy5hZGRpdGlvbmFsV2Vidmlld0J1bmRsZUlkcykge1xuICAgICAgY2Fwcy5hZGRpdGlvbmFsV2Vidmlld0J1bmRsZUlkcyA9IHRoaXMuaGVscGVycy5wYXJzZUNhcHNBcnJheShjYXBzLmFkZGl0aW9uYWxXZWJ2aWV3QnVuZGxlSWRzKTtcbiAgICB9XG5cbiAgICAvLyBmaW5hbGx5LCByZXR1cm4gdHJ1ZSBzaW5jZSB0aGUgc3VwZXJjbGFzcyBjaGVjayBwYXNzZWQsIGFzIGRpZCB0aGlzXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBpbnN0YWxsQVVUICgpIHtcbiAgICBpZiAodGhpcy5pc1NhZmFyaSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdmVyaWZ5QXBwbGljYXRpb25QbGF0Zm9ybSh0aGlzLm9wdHMuYXBwLCB7XG4gICAgICBpc1NpbXVsYXRvcjogdGhpcy5pc1NpbXVsYXRvcigpLFxuICAgICAgaXNUdk9TOiB0aGlzLmlzVHZPUygpLFxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgIGF3YWl0IGluc3RhbGxUb1JlYWxEZXZpY2UodGhpcy5vcHRzLmRldmljZSwgdGhpcy5vcHRzLmFwcCwgdGhpcy5vcHRzLmJ1bmRsZUlkLCB7XG4gICAgICAgIG5vUmVzZXQ6IHRoaXMub3B0cy5ub1Jlc2V0LFxuICAgICAgICB0aW1lb3V0OiB0aGlzLm9wdHMuYXBwUHVzaFRpbWVvdXQsXG4gICAgICAgIHN0cmF0ZWd5OiB0aGlzLm9wdHMuYXBwSW5zdGFsbFN0cmF0ZWd5LFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGluc3RhbGxUb1NpbXVsYXRvcih0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMuYXBwLCB0aGlzLm9wdHMuYnVuZGxlSWQsIHtcbiAgICAgICAgbm9SZXNldDogdGhpcy5vcHRzLm5vUmVzZXQsXG4gICAgICAgIG5ld1NpbXVsYXRvcjogdGhpcy5saWZlY3ljbGVEYXRhLmNyZWF0ZVNpbSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodGhpcy5vcHRzLm90aGVyQXBwcykge1xuICAgICAgYXdhaXQgdGhpcy5pbnN0YWxsT3RoZXJBcHBzKHRoaXMub3B0cy5vdGhlckFwcHMpO1xuICAgIH1cblxuICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5pb3NJbnN0YWxsUGF1c2UpKSB7XG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvNjg4OVxuICAgICAgbGV0IHBhdXNlID0gcGFyc2VJbnQodGhpcy5vcHRzLmlvc0luc3RhbGxQYXVzZSwgMTApO1xuICAgICAgdGhpcy5sb2cuZGVidWcoYGlvc0luc3RhbGxQYXVzZSBzZXQuIFBhdXNpbmcgJHtwYXVzZX0gbXMgYmVmb3JlIGNvbnRpbnVpbmdgKTtcbiAgICAgIGF3YWl0IEIuZGVsYXkocGF1c2UpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGluc3RhbGxPdGhlckFwcHMgKG90aGVyQXBwcykge1xuICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICB0aGlzLmxvZy53YXJuKCdDYXBhYmlsaXR5IG90aGVyQXBwcyBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgU2ltdWxhdG9ycycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBsZXQgYXBwc0xpc3Q7XG4gICAgdHJ5IHtcbiAgICAgIGFwcHNMaXN0ID0gdGhpcy5oZWxwZXJzLnBhcnNlQ2Fwc0FycmF5KG90aGVyQXBwcyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgQ291bGQgbm90IHBhcnNlIFwib3RoZXJBcHBzXCIgY2FwYWJpbGl0eTogJHtlLm1lc3NhZ2V9YCk7XG4gICAgfVxuICAgIGlmIChfLmlzRW1wdHkoYXBwc0xpc3QpKSB7XG4gICAgICB0aGlzLmxvZy5pbmZvKGBHb3QgemVybyBhcHBzIGZyb20gJ290aGVyQXBwcycgY2FwYWJpbGl0eSB2YWx1ZS4gRG9pbmcgbm90aGluZ2ApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFwcFBhdGhzID0gYXdhaXQgQi5hbGwoYXBwc0xpc3QubWFwKFxuICAgICAgKGFwcCkgPT4gdGhpcy5oZWxwZXJzLmNvbmZpZ3VyZUFwcChhcHAsICcuYXBwJylcbiAgICApKTtcbiAgICBmb3IgKGNvbnN0IG90aGVyQXBwIG9mIGFwcFBhdGhzKSB7XG4gICAgICBhd2FpdCBpbnN0YWxsVG9TaW11bGF0b3IodGhpcy5vcHRzLmRldmljZSwgb3RoZXJBcHAsIHVuZGVmaW5lZCwge1xuICAgICAgICBub1Jlc2V0OiB0aGlzLm9wdHMubm9SZXNldCxcbiAgICAgICAgbmV3U2ltdWxhdG9yOiB0aGlzLmxpZmVjeWNsZURhdGEuY3JlYXRlU2ltLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldCByZWR1Y2VNb3Rpb24gYXMgJ2lzRW5hYmxlZCcgb25seSB3aGVuIHRoZSBjYXBhYmlsaXRpZXMgaGFzICdyZWR1Y2VNb3Rpb24nXG4gICAqIFRoZSBjYWxsIGlzIGlnbm9yZWQgZm9yIHJlYWwgZGV2aWNlcy5cbiAgICogQHBhcmFtIHs/Ym9vbGVhbn0gaXNFbmFibGVkIFdldGhlciBlbmFibGUgcmVkdWNlTW90aW9uXG4gICAqL1xuICBhc3luYyBzZXRSZWR1Y2VNb3Rpb24gKGlzRW5hYmxlZCkge1xuICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpIHx8ICFfLmlzQm9vbGVhbihpc0VuYWJsZWQpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5sb2cuaW5mbyhgU2V0dGluZyByZWR1Y2VNb3Rpb24gdG8gJHtpc0VuYWJsZWR9YCk7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh7cmVkdWNlTW90aW9uOiBpc0VuYWJsZWR9KTtcbiAgfVxuXG4gIGFzeW5jIHNldEluaXRpYWxPcmllbnRhdGlvbiAob3JpZW50YXRpb24pIHtcbiAgICBpZiAoIV8uaXNTdHJpbmcob3JpZW50YXRpb24pKSB7XG4gICAgICB0aGlzLmxvZy5pbmZvKCdTa2lwcGluZyBzZXR0aW5nIG9mIHRoZSBpbml0aWFsIGRpc3BsYXkgb3JpZW50YXRpb24uICcgK1xuICAgICAgICAnU2V0IHRoZSBcIm9yaWVudGF0aW9uXCIgY2FwYWJpbGl0eSB0byBlaXRoZXIgXCJMQU5EU0NBUEVcIiBvciBcIlBPUlRSQUlUXCIsIGlmIHRoaXMgaXMgYW4gdW5kZXNpcmVkIGJlaGF2aW9yLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBvcmllbnRhdGlvbiA9IG9yaWVudGF0aW9uLnRvVXBwZXJDYXNlKCk7XG4gICAgaWYgKCFfLmluY2x1ZGVzKFsnTEFORFNDQVBFJywgJ1BPUlRSQUlUJ10sIG9yaWVudGF0aW9uKSkge1xuICAgICAgdGhpcy5sb2cuZGVidWcoYFVuYWJsZSB0byBzZXQgaW5pdGlhbCBvcmllbnRhdGlvbiB0byAnJHtvcmllbnRhdGlvbn0nYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMubG9nLmRlYnVnKGBTZXR0aW5nIGluaXRpYWwgb3JpZW50YXRpb24gdG8gJyR7b3JpZW50YXRpb259J2ApO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL29yaWVudGF0aW9uJywgJ1BPU1QnLCB7b3JpZW50YXRpb259KTtcbiAgICAgIHRoaXMub3B0cy5jdXJPcmllbnRhdGlvbiA9IG9yaWVudGF0aW9uO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5sb2cud2FybihgU2V0dGluZyBpbml0aWFsIG9yaWVudGF0aW9uIGZhaWxlZCB3aXRoOiAke2Vyci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuXG4gIF9nZXRDb21tYW5kVGltZW91dCAoY21kTmFtZSkge1xuICAgIGlmICh0aGlzLm9wdHMuY29tbWFuZFRpbWVvdXRzKSB7XG4gICAgICBpZiAoY21kTmFtZSAmJiBfLmhhcyh0aGlzLm9wdHMuY29tbWFuZFRpbWVvdXRzLCBjbWROYW1lKSkge1xuICAgICAgICByZXR1cm4gdGhpcy5vcHRzLmNvbW1hbmRUaW1lb3V0c1tjbWROYW1lXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLm9wdHMuY29tbWFuZFRpbWVvdXRzW0RFRkFVTFRfVElNRU9VVF9LRVldO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgc2Vzc2lvbiBjYXBhYmlsaXRpZXMgbWVyZ2VkIHdpdGggd2hhdCBXREEgcmVwb3J0c1xuICAgKiBUaGlzIGlzIGEgbGlicmFyeSBjb21tYW5kIGJ1dCBuZWVkcyB0byBjYWxsICdzdXBlcicgc28gY2FuJ3QgYmUgb25cbiAgICogYSBoZWxwZXIgb2JqZWN0XG4gICAqL1xuICBhc3luYyBnZXRTZXNzaW9uICgpIHtcbiAgICAvLyBjYWxsIHN1cGVyIHRvIGdldCBldmVudCB0aW1pbmdzLCBldGMuLi5cbiAgICBjb25zdCBkcml2ZXJTZXNzaW9uID0gYXdhaXQgc3VwZXIuZ2V0U2Vzc2lvbigpO1xuICAgIGlmICghdGhpcy53ZGFDYXBzKSB7XG4gICAgICB0aGlzLndkYUNhcHMgPSBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnLycsICdHRVQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBzaG91bGRHZXREZXZpY2VDYXBzID0gXy5pc0Jvb2xlYW4odGhpcy5vcHRzLmluY2x1ZGVEZXZpY2VDYXBzVG9TZXNzaW9uSW5mbylcbiAgICAgID8gdGhpcy5vcHRzLmluY2x1ZGVEZXZpY2VDYXBzVG9TZXNzaW9uSW5mb1xuICAgICAgOiB0cnVlOyAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgaWYgKHNob3VsZEdldERldmljZUNhcHMgJiYgIXRoaXMuZGV2aWNlQ2Fwcykge1xuICAgICAgY29uc3Qge3N0YXR1c0JhclNpemUsIHNjYWxlfSA9IGF3YWl0IHRoaXMuZ2V0U2NyZWVuSW5mbygpO1xuICAgICAgdGhpcy5kZXZpY2VDYXBzID0ge1xuICAgICAgICBwaXhlbFJhdGlvOiBzY2FsZSxcbiAgICAgICAgc3RhdEJhckhlaWdodDogc3RhdHVzQmFyU2l6ZS5oZWlnaHQsXG4gICAgICAgIHZpZXdwb3J0UmVjdDogYXdhaXQgdGhpcy5nZXRWaWV3cG9ydFJlY3QoKSxcbiAgICAgIH07XG4gICAgfVxuICAgIHRoaXMubG9nLmluZm8oJ01lcmdpbmcgV0RBIGNhcHMgb3ZlciBBcHBpdW0gY2FwcyBmb3Igc2Vzc2lvbiBkZXRhaWwgcmVzcG9uc2UnKTtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7dWRpZDogdGhpcy5vcHRzLnVkaWR9LCBkcml2ZXJTZXNzaW9uLFxuICAgICAgdGhpcy53ZGFDYXBzLmNhcGFiaWxpdGllcywgdGhpcy5kZXZpY2VDYXBzIHx8IHt9KTtcbiAgfVxuXG4gIGFzeW5jIHJlc2V0ICgpIHtcbiAgICBpZiAodGhpcy5vcHRzLm5vUmVzZXQpIHtcbiAgICAgIC8vIFRoaXMgaXMgdG8gbWFrZSBzdXJlIHJlc2V0IGhhcHBlbnMgZXZlbiBpZiBub1Jlc2V0IGlzIHNldCB0byB0cnVlXG4gICAgICBsZXQgb3B0cyA9IF8uY2xvbmVEZWVwKHRoaXMub3B0cyk7XG4gICAgICBvcHRzLm5vUmVzZXQgPSBmYWxzZTtcbiAgICAgIG9wdHMuZnVsbFJlc2V0ID0gZmFsc2U7XG4gICAgICBjb25zdCBzaHV0ZG93bkhhbmRsZXIgPSB0aGlzLnJlc2V0T25VbmV4cGVjdGVkU2h1dGRvd247XG4gICAgICB0aGlzLnJlc2V0T25VbmV4cGVjdGVkU2h1dGRvd24gPSAoKSA9PiB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUmVzZXQob3B0cyk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLnJlc2V0T25VbmV4cGVjdGVkU2h1dGRvd24gPSBzaHV0ZG93bkhhbmRsZXI7XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHN1cGVyLnJlc2V0KCk7XG4gIH1cbn1cblxuT2JqZWN0LmFzc2lnbihYQ1VJVGVzdERyaXZlci5wcm90b3R5cGUsIGNvbW1hbmRzKTtcblxuZXhwb3J0IGRlZmF1bHQgWENVSVRlc3REcml2ZXI7XG5leHBvcnQgeyBYQ1VJVGVzdERyaXZlciB9O1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUlBOztBQUNBOztBQUlBOztBQUNBOztBQUtBOztBQUdBOztBQUNBOztBQVFBOztBQUlBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUdBLE1BQU1BLHdCQUF3QixHQUFHLHFCQUFqQztBQUNBLE1BQU1DLDRCQUE0QixHQUFHLDhCQUFyQztBQUVBLE1BQU1DLG9CQUFvQixHQUFHLENBQUNDLGlCQUFELEVBQVVDLGlCQUFWLENBQTdCO0FBQ0EsTUFBTUMsc0JBQXNCLEdBQUcsQ0FBL0I7QUFDQSxNQUFNQyxpQkFBaUIsR0FBRztFQUN4QkMsaUJBQWlCLEVBQUUsS0FESztFQUV4QkMsc0JBQXNCLEVBQUUsS0FGQTtFQUd4QkMsV0FBVyxFQUFFLEVBSFc7RUFJeEJD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