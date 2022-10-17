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

    for (const [key, value] of Object.entries((_this$cliArgs = this.cliArgs) !== null && _this$cliArgs !== void 0 ? _this$cliArgs : {})) {
      var _this$cliArgs;

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
    var _this$opts$simulatorP;

    const runOpts = {
      scaleFactor: this.opts.scaleFactor,
      connectHardwareKeyboard: !!this.opts.connectHardwareKeyboard,
      pasteboardAutomaticSync: (_this$opts$simulatorP = this.opts.simulatorPasteboardAutomaticSync) !== null && _this$opts$simulatorP !== void 0 ? _this$opts$simulatorP : 'off',
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
    var _this$opts$wdaEventlo, _this$opts$waitForQui, _this$opts$simpleIsVi, _this$opts$maxTypingF, _this$opts$shouldUseS, _this$opts$shouldTerm, _this$opts$forceAppLa, _this$opts$useNativeC, _this$opts$forceSimul;

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
      eventloopIdleDelaySec: (_this$opts$wdaEventlo = this.opts.wdaEventloopIdleDelay) !== null && _this$opts$wdaEventlo !== void 0 ? _this$opts$wdaEventlo : 0,
      shouldWaitForQuiescence: (_this$opts$waitForQui = this.opts.waitForQuiescence) !== null && _this$opts$waitForQui !== void 0 ? _this$opts$waitForQui : true,
      shouldUseTestManagerForVisibilityDetection: (_this$opts$simpleIsVi = this.opts.simpleIsVisibleCheck) !== null && _this$opts$simpleIsVi !== void 0 ? _this$opts$simpleIsVi : false,
      maxTypingFrequency: (_this$opts$maxTypingF = this.opts.maxTypingFrequency) !== null && _this$opts$maxTypingF !== void 0 ? _this$opts$maxTypingF : 60,
      shouldUseSingletonTestManager: (_this$opts$shouldUseS = this.opts.shouldUseSingletonTestManager) !== null && _this$opts$shouldUseS !== void 0 ? _this$opts$shouldUseS : true,
      waitForIdleTimeout: this.opts.waitForIdleTimeout,
      shouldUseCompactResponses: this.opts.shouldUseCompactResponses,
      elementResponseFields: this.opts.elementResponseFields,
      disableAutomaticScreenshots: this.opts.disableAutomaticScreenshots,
      shouldTerminateApp: (_this$opts$shouldTerm = this.opts.shouldTerminateApp) !== null && _this$opts$shouldTerm !== void 0 ? _this$opts$shouldTerm : true,
      forceAppLaunch: (_this$opts$forceAppLa = this.opts.forceAppLaunch) !== null && _this$opts$forceAppLa !== void 0 ? _this$opts$forceAppLa : true,
      useNativeCachingStrategy: (_this$opts$useNativeC = this.opts.useNativeCachingStrategy) !== null && _this$opts$useNativeC !== void 0 ? _this$opts$useNativeC : true,
      forceSimulatorSoftwareKeyboardPresence: (_this$opts$forceSimul = this.opts.forceSimulatorSoftwareKeyboardPresence) !== null && _this$opts$forceSimul !== void 0 ? _this$opts$forceSimul : this.opts.connectHardwareKeyboard === true ? false : true
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
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGliL2RyaXZlci5qcyIsIm5hbWVzIjpbIlNIVVRET1dOX09USEVSX0ZFQVRfTkFNRSIsIkNVU1RPTUlaRV9SRVNVTFRfQlVORFBFX1BBVEgiLCJTVVBQT1JURURfRVhURU5TSU9OUyIsIklQQV9FWFQiLCJBUFBfRVhUIiwiTUFYX0FSQ0hJVkVfU0NBTl9ERVBUSCIsImRlZmF1bHRTZXJ2ZXJDYXBzIiwid2ViU3RvcmFnZUVuYWJsZWQiLCJsb2NhdGlvbkNvbnRleHRFbmFibGVkIiwiYnJvd3Nlck5hbWUiLCJwbGF0Zm9ybSIsImphdmFzY3JpcHRFbmFibGVkIiwiZGF0YWJhc2VFbmFibGVkIiwidGFrZXNTY3JlZW5zaG90IiwibmV0d29ya0Nvbm5lY3Rpb25FbmFibGVkIiwiV0RBX1NJTV9TVEFSVFVQX1JFVFJJRVMiLCJXREFfUkVBTF9ERVZfU1RBUlRVUF9SRVRSSUVTIiwiV0RBX1JFQUxfREVWX1RVVE9SSUFMX1VSTCIsIldEQV9TVEFSVFVQX1JFVFJZX0lOVEVSVkFMIiwiREVGQVVMVF9TRVRUSU5HUyIsIm5hdGl2ZVdlYlRhcCIsIm5hdGl2ZVdlYlRhcFN0cmljdCIsInVzZUpTT05Tb3VyY2UiLCJzaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzIiwiZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlcyIsIm1qcGVnU2VydmVyU2NyZWVuc2hvdFF1YWxpdHkiLCJtanBlZ1NlcnZlckZyYW1lcmF0ZSIsInNjcmVlbnNob3RRdWFsaXR5IiwibWpwZWdTY2FsaW5nRmFjdG9yIiwicmVkdWNlTW90aW9uIiwiU0hBUkVEX1JFU09VUkNFU19HVUFSRCIsIkFzeW5jTG9jayIsIldFQl9FTEVNRU5UU19DQUNIRV9TSVpFIiwiTk9fUFJPWFlfTkFUSVZFX0xJU1QiLCJOT19QUk9YWV9XRUJfTElTVCIsImNvbmNhdCIsIk1FTU9JWkVEX0ZVTkNUSU9OUyIsIlhDVUlUZXN0RHJpdmVyIiwiQmFzZURyaXZlciIsImNvbnN0cnVjdG9yIiwib3B0cyIsInNob3VsZFZhbGlkYXRlQ2FwcyIsImRlc2lyZWRDYXBDb25zdHJhaW50cyIsImxvY2F0b3JTdHJhdGVnaWVzIiwid2ViTG9jYXRvclN0cmF0ZWdpZXMiLCJyZXNldElvcyIsInNldHRpbmdzIiwiRGV2aWNlU2V0dGluZ3MiLCJvblNldHRpbmdzVXBkYXRlIiwiYmluZCIsImxvZ3MiLCJmbiIsIl8iLCJtZW1vaXplIiwia2V5IiwidmFsdWUiLCJwcm94eUNvbW1hbmQiLCJ3ZGEiLCJkZXZpY2UiLCJqd3BQcm94eUFjdGl2ZSIsInByb3h5UmVxUmVzIiwiandwUHJveHlBdm9pZCIsInNhZmFyaSIsImNhY2hlZFdkYVN0YXR1cyIsImN1cldlYkZyYW1lcyIsIl9jdXJyZW50VXJsIiwiY3VyQ29udGV4dCIsInhjb2RlVmVyc2lvbiIsImNvbnRleHRzIiwiaW1wbGljaXRXYWl0TXMiLCJhc3luY2xpYldhaXRNcyIsInBhZ2VMb2FkTXMiLCJsYW5kc2NhcGVXZWJDb29yZHNPZmZzZXQiLCJyZW1vdGUiLCJfY29uZGl0aW9uSW5kdWNlclNlcnZpY2UiLCJ3ZWJFbGVtZW50c0NhY2hlIiwiTFJVIiwibWF4IiwiZHJpdmVyRGF0YSIsImdldFN0YXR1cyIsImRyaXZlckluZm8iLCJnZXREcml2ZXJJbmZvIiwic3RhdHVzIiwiYnVpbGQiLCJ2ZXJzaW9uIiwibWVyZ2VDbGlBcmdzVG9PcHRzIiwiZGlkTWVyZ2UiLCJPYmplY3QiLCJlbnRyaWVzIiwiY2xpQXJncyIsImhhcyIsImxvZyIsImluZm8iLCJjcmVhdGVTZXNzaW9uIiwiYXJncyIsImxpZmVjeWNsZURhdGEiLCJzZXNzaW9uSWQiLCJjYXBzIiwidmFsaWRhdGVEZXNpcmVkQ2FwcyIsInN0YXJ0IiwiYXNzaWduIiwidWRpZCIsInVwZGF0ZVNldHRpbmdzIiwid2RhU2V0dGluZ3MiLCJtanBlZ1NjcmVlbnNob3RVcmwiLCJtanBlZ1N0cmVhbSIsIm1qcGVnIiwiTUpwZWdTdHJlYW0iLCJlIiwiZXJyb3IiLCJKU09OIiwic3RyaW5naWZ5IiwiZGVsZXRlU2Vzc2lvbiIsImdldERlZmF1bHRVcmwiLCJpc1JlYWxEZXZpY2UiLCJ3ZGFMb2NhbFBvcnQiLCJhZGRyZXNzIiwiaW5jbHVkZXMiLCJwb3J0Iiwibm9SZXNldCIsImZ1bGxSZXNldCIsInByaW50VXNlciIsImlvc1Nka1ZlcnNpb24iLCJyZWFsRGV2aWNlIiwiZGV0ZXJtaW5lRGV2aWNlIiwic2ltdWxhdG9yRGV2aWNlc1NldFBhdGgiLCJkZXZpY2VzU2V0UGF0aCIsInBsYXRmb3JtVmVyc2lvbiIsImdldFBsYXRmb3JtVmVyc2lvbiIsIm5vcm1hbGl6ZWRWZXJzaW9uIiwibm9ybWFsaXplUGxhdGZvcm1WZXJzaW9uIiwidXRpbCIsImNvbXBhcmVWZXJzaW9ucyIsIkVycm9yIiwiaXNFbXB0eSIsIndlYkRyaXZlckFnZW50VXJsIiwiZ2V0QW5kQ2hlY2tYY29kZVZlcnNpb24iLCJsb2dFdmVudCIsInRvTG93ZXIiLCJhcHAiLCJ1bmRlZmluZWQiLCJwcm9jZXNzQXJndW1lbnRzIiwiYnVuZGxlSWQiLCJTQUZBUklfQlVORExFX0lEIiwic2FmYXJpSW5pdGlhbFVybCIsImNvbmZpZ3VyZUFwcCIsImNoZWNrQXBwUHJlc2VudCIsImV4dHJhY3RCdW5kbGVJZCIsInJ1blJlc2V0IiwiV2ViRHJpdmVyQWdlbnQiLCJyZXRyaWV2ZURlcml2ZWREYXRhUGF0aCIsImNhdGNoIiwiZGVidWciLCJtZW1vaXplZExvZ0luZm8iLCJzdGFydExvZ0NhcHR1cmUiLCJza2lwTG9nQ2FwdHVyZSIsInJlc3VsdCIsImlzTG9nQ2FwdHVyZVN0YXJ0ZWQiLCJpc1NpbXVsYXRvciIsInNodXRkb3duT3RoZXJTaW11bGF0b3JzIiwiZW5zdXJlRmVhdHVyZUVuYWJsZWQiLCJpc1NhZmFyaSIsInNhZmFyaUdsb2JhbFByZWZlcmVuY2VzIiwidXBkYXRlU2FmYXJpR2xvYmFsU2V0dGluZ3MiLCJsb2NhbENvbmZpZyIsInNldExvY2FsZUFuZFByZWZlcmVuY2VzIiwic2ltIiwic2h1dGRvd25TaW11bGF0b3IiLCJjdXN0b21TU0xDZXJ0IiwiZG9lc1N1cHBvcnRLZXljaGFpbkFwaSIsImNlcnRIZWFkIiwidHJ1bmNhdGUiLCJsZW5ndGgiLCJoYXNDZXJ0aWZpY2F0ZUxlZ2FjeSIsImluc3RhbGxDZXJ0aWZpY2F0ZUxlZ2FjeSIsInN0YXJ0U2ltIiwiaW5zdGFsbENlcnRpZmljYXRlIiwibGF1bmNoV2l0aElEQiIsImlkYiIsIklEQiIsImNvbm5lY3QiLCJtZXNzYWdlIiwiUHlpZGV2aWNlIiwiaW5zdGFsbFByb2ZpbGUiLCJwYXlsb2FkIiwiaW5zdGFsbEFVVCIsImlzQXBwSW5zdGFsbGVkIiwiZXJyb3JBbmRUaHJvdyIsInBlcm1pc3Npb25zIiwicGVybWlzc2lvbnNNYXBwaW5nIiwidG9QYWlycyIsInBhcnNlIiwic2V0UGVybWlzc2lvbnMiLCJ3YXJuIiwiY2FsZW5kYXJBY2Nlc3NBdXRob3JpemVkIiwiZW5hYmxlQ2FsZW5kYXJBY2Nlc3MiLCJkaXNhYmxlQ2FsZW5kYXJBY2Nlc3MiLCJzdGFydFdkYSIsInNldFJlZHVjZU1vdGlvbiIsInNldEluaXRpYWxPcmllbnRhdGlvbiIsIm9yaWVudGF0aW9uIiwiYXV0b1dlYnZpZXciLCJhY3RpdmF0ZVJlY2VudFdlYnZpZXciLCJpc05pbCIsImdldEN1cnJlbnRVcmwiLCJzZXRVcmwiLCJzZXRDdXJyZW50VXJsIiwiZ2V0VXJsIiwiaGFzVmFsdWUiLCJjbGVhbnVwT2Jzb2xldGVQcm9jZXNzZXMiLCJ1c2VQb3J0Rm9yd2FyZGluZyIsImlzTG9jYWxIb3N0Iiwid2RhQmFzZVVybCIsIkRFVklDRV9DT05ORUNUSU9OU19GQUNUT1JZIiwicmVxdWVzdENvbm5lY3Rpb24iLCJ1cmwiLCJkZXZpY2VQb3J0Iiwid2RhUmVtb3RlUG9ydCIsInN5bmNocm9uaXphdGlvbktleSIsIm5hbWUiLCJ1c2VYY3Rlc3RydW5GaWxlIiwiaXNTb3VyY2VGcmVzaCIsImRlcml2ZWREYXRhUGF0aCIsInBhdGgiLCJub3JtYWxpemUiLCJpc0J1c3kiLCJib290c3RyYXBQYXRoIiwiYWNxdWlyZSIsInVzZU5ld1dEQSIsInF1aXRBbmRVbmluc3RhbGwiLCJzZXR1cENhY2hpbmciLCJtc2ciLCJyZXN1bHRCdW5kbGVQYXRoIiwic3RhcnR1cFJldHJpZXMiLCJ3ZGFTdGFydHVwUmV0cmllcyIsInN0YXJ0dXBSZXRyeUludGVydmFsIiwid2RhU3RhcnR1cFJldHJ5SW50ZXJ2YWwiLCJyZXRyeUNvdW50IiwicmV0cnlJbnRlcnZhbCIsInJldHJpZXMiLCJtYWpvciIsInJldHJ5IiwibGF1bmNoIiwiZXJyIiwiZXJyb3JNc2ciLCJvcmlnaW5hbFN0YWNrdHJhY2UiLCJzdGFydFdkYVNlc3Npb24iLCJzdGFjayIsImNsZWFyU3lzdGVtRmlsZXMiLCJtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwIiwiZnVsbHlTdGFydGVkIiwicnVuUmVhbERldmljZVJlc2V0IiwicnVuU2ltdWxhdG9yUmVzZXQiLCJyZW1vdmVBbGxTZXNzaW9uV2ViU29ja2V0SGFuZGxlcnMiLCJzZXJ2ZXIiLCJyZWNvcmRlciIsImNvbXBhY3QiLCJfcmVjZW50U2NyZWVuUmVjb3JkZXIiLCJfYXVkaW9SZWNvcmRlciIsIl90cmFmZmljQ2FwdHVyZSIsImludGVycnVwdCIsImNsZWFudXAiLCJfcGVyZlJlY29yZGVycyIsIkIiLCJhbGwiLCJtYXAiLCJ4Iiwic3RvcCIsIm1vYmlsZURpc2FibGVDb25kaXRpb25JbmR1Y2VyIiwic3RvcFJlbW90ZSIsInJlc2V0T25TZXNzaW9uU3RhcnRPbmx5IiwiZW5mb3JjZVNpbXVsYXRvclNodXRkb3duIiwiY3JlYXRlU2ltIiwiZGVsZXRlIiwic2hvdWxkUmVzZXRMb2NhdGlvblNlcnZpdmNlIiwicmVzZXRMb2NhdGlvblNlcnZpY2UiLCJtb2JpbGVSZXNldExvY2F0aW9uU2VydmljZSIsImlnbm9yZSIsInN5c2xvZyIsInN0b3BDYXB0dXJlIiwiandwcm94eSIsInF1aXQiLCJyZWxlYXNlQ29ubmVjdGlvbiIsImV4ZWN1dGVDb21tYW5kIiwiY21kIiwicmVjZWl2ZUFzeW5jUmVzcG9uc2UiLCJhcHBJc1BhY2thZ2VPckJ1bmRsZSIsInRlc3QiLCJoZWxwZXJzIiwib25Qb3N0UHJvY2VzcyIsIm9uUG9zdENvbmZpZ3VyZUFwcCIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJ1bnppcEFwcCIsImFwcFBhdGgiLCJkZXB0aCIsInJvb3REaXIiLCJtYXRjaGVkUGF0aHMiLCJmaW5kQXBwcyIsImJhc2VuYW1lIiwicGx1cmFsaXplIiwibWF0Y2hlZFBhdGgiLCJmdWxsUGF0aCIsImpvaW4iLCJpc0FwcEJ1bmRsZSIsInN1cHBvcnRlZFBsYXRmb3JtcyIsImZldGNoU3VwcG9ydGVkQXBwUGxhdGZvcm1zIiwic29tZSIsInAiLCJpc29sYXRlQXBwQnVuZGxlIiwiZW5kc1dpdGgiLCJmcyIsInN0YXQiLCJpc0ZpbGUiLCJyaW1yYWYiLCJjYWNoZWRBcHBJbmZvIiwiaXNVcmwiLCJpc1BsYWluT2JqZWN0IiwiaGFzaCIsInBhY2thZ2VIYXNoIiwiZXhpc3RzIiwiZ2xvYiIsImN3ZCIsInN0cmljdCIsIm5vc29ydCIsImludGVncml0eSIsImZvbGRlciIsImRldmljZU5hbWUiLCJ0cmFuc2xhdGVEZXZpY2VOYW1lIiwic2V0dXBWZXJzaW9uQ2FwcyIsImdldEFuZENoZWNrSW9zU2RrVmVyc2lvbiIsInRvTG93ZXJDYXNlIiwiZGV0ZWN0VWRpZCIsImdldEV4aXN0aW5nU2ltIiwiZGV2aWNlUGxhdGZvcm0iLCJkZXZpY2VzIiwiZ2V0Q29ubmVjdGVkRGV2aWNlcyIsImdldFNpbXVsYXRvciIsImlnbiIsImdldFJlYWxEZXZpY2VPYmoiLCJlbmZvcmNlRnJlc2hTaW11bGF0b3JDcmVhdGlvbiIsInJ1bk9wdHMiLCJzY2FsZUZhY3RvciIsImNvbm5lY3RIYXJkd2FyZUtleWJvYXJkIiwicGFzdGVib2FyZEF1dG9tYXRpY1N5bmMiLCJzaW11bGF0b3JQYXN0ZWJvYXJkQXV0b21hdGljU3luYyIsImlzSGVhZGxlc3MiLCJ0cmFjZVBvaW50ZXIiLCJzaW11bGF0b3JUcmFjZVBvaW50ZXIiLCJkZXZpY2VQcmVmZXJlbmNlcyIsIlNpbXVsYXRvcldpbmRvd0NlbnRlciIsImlzSW50ZWdlciIsInNpbXVsYXRvclN0YXJ0dXBUaW1lb3V0Iiwic3RhcnR1cFRpbWVvdXQiLCJpc1N0cmluZyIsInRvVXBwZXJDYXNlIiwiU2ltdWxhdG9yV2luZG93T3JpZW50YXRpb24iLCJTaW11bGF0b3JXaW5kb3dSb3RhdGlvbkFuZ2xlIiwicnVuIiwicGxhdGZvcm1OYW1lIiwiaXNUdk9TIiwiUExBVEZPUk1fTkFNRV9UVk9TIiwiUExBVEZPUk1fTkFNRV9JT1MiLCJsYXVuY2hBcHAiLCJBUFBfTEFVTkNIX1RJTUVPVVQiLCJzaW1jdGwiLCJjaGVja1N0YXR1cyIsInJlc3BvbnNlIiwiY3VycmVudEFwcCIsImJ1bmRsZUlEIiwicGFyc2VJbnQiLCJpc0FycmF5IiwiZW52IiwibGFuZ3VhZ2UiLCJwdXNoIiwibG9jYWxlIiwic2hvdWxkVGVybWluYXRlQXBwIiwiZm9yY2VBcHBMYXVuY2giLCJ3ZGFDYXBzIiwiYXV0b0xhdW5jaCIsImFyZ3VtZW50cyIsImVudmlyb25tZW50IiwiZXZlbnRsb29wSWRsZURlbGF5U2VjIiwid2RhRXZlbnRsb29wSWRsZURlbGF5Iiwic2hvdWxkV2FpdEZvclF1aWVzY2VuY2UiLCJ3YWl0Rm9yUXVpZXNjZW5jZSIsInNob3VsZFVzZVRlc3RNYW5hZ2VyRm9yVmlzaWJpbGl0eURldGVjdGlvbiIsInNpbXBsZUlzVmlzaWJsZUNoZWNrIiwibWF4VHlwaW5nRnJlcXVlbmN5Iiwic2hvdWxkVXNlU2luZ2xldG9uVGVzdE1hbmFnZXIiLCJ3YWl0Rm9ySWRsZVRpbWVvdXQiLCJlbGVtZW50UmVzcG9uc2VGaWVsZHMiLCJkaXNhYmxlQXV0b21hdGljU2NyZWVuc2hvdHMiLCJ1c2VOYXRpdmVDYWNoaW5nU3RyYXRlZ3kiLCJmb3JjZVNpbXVsYXRvclNvZnR3YXJlS2V5Ym9hcmRQcmVzZW5jZSIsImF1dG9BY2NlcHRBbGVydHMiLCJkZWZhdWx0QWxlcnRBY3Rpb24iLCJhdXRvRGlzbWlzc0FsZXJ0cyIsImNhcGFiaWxpdGllcyIsImZpcnN0TWF0Y2giLCJhbHdheXNNYXRjaCIsInByb3h5QWN0aXZlIiwiZ2V0UHJveHlBdm9pZExpc3QiLCJpc1dlYnZpZXciLCJjYW5Qcm94eSIsImlzV2ViQ29udGV4dCIsInZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5Iiwic3RyYXRlZ3kiLCJjb2VyY2VWZXJzaW9uIiwidmVyaWZ5UHJvY2Vzc0FyZ3VtZW50Iiwia2V5Y2hhaW5QYXRoIiwia2V5Y2hhaW5QYXNzd29yZCIsImNvbW1hbmRUaW1lb3V0cyIsIm5vcm1hbGl6ZUNvbW1hbmRUaW1lb3V0cyIsInByb3RvY29sIiwiaG9zdCIsInBlcm1zIiwiYWRkaXRpb25hbFdlYnZpZXdCdW5kbGVJZHMiLCJwYXJzZUNhcHNBcnJheSIsInZlcmlmeUFwcGxpY2F0aW9uUGxhdGZvcm0iLCJpbnN0YWxsVG9SZWFsRGV2aWNlIiwidGltZW91dCIsImFwcFB1c2hUaW1lb3V0IiwiYXBwSW5zdGFsbFN0cmF0ZWd5IiwiaW5zdGFsbFRvU2ltdWxhdG9yIiwibmV3U2ltdWxhdG9yIiwib3RoZXJBcHBzIiwiaW5zdGFsbE90aGVyQXBwcyIsImlvc0luc3RhbGxQYXVzZSIsInBhdXNlIiwiZGVsYXkiLCJhcHBzTGlzdCIsImFwcFBhdGhzIiwib3RoZXJBcHAiLCJpc0VuYWJsZWQiLCJpc0Jvb2xlYW4iLCJjdXJPcmllbnRhdGlvbiIsIl9nZXRDb21tYW5kVGltZW91dCIsImNtZE5hbWUiLCJERUZBVUxUX1RJTUVPVVRfS0VZIiwiZ2V0U2Vzc2lvbiIsImRyaXZlclNlc3Npb24iLCJzaG91bGRHZXREZXZpY2VDYXBzIiwiaW5jbHVkZURldmljZUNhcHNUb1Nlc3Npb25JbmZvIiwiZGV2aWNlQ2FwcyIsInN0YXR1c0JhclNpemUiLCJzY2FsZSIsImdldFNjcmVlbkluZm8iLCJwaXhlbFJhdGlvIiwic3RhdEJhckhlaWdodCIsImhlaWdodCIsInZpZXdwb3J0UmVjdCIsImdldFZpZXdwb3J0UmVjdCIsInJlc2V0IiwiY2xvbmVEZWVwIiwic2h1dGRvd25IYW5kbGVyIiwicmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93biIsInByb3RvdHlwZSIsImNvbW1hbmRzIl0sInNvdXJjZVJvb3QiOiIuLi8uLiIsInNvdXJjZXMiOlsibGliL2RyaXZlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBCYXNlRHJpdmVyLCBEZXZpY2VTZXR0aW5ncyB9IGZyb20gJ2FwcGl1bS9kcml2ZXInO1xuaW1wb3J0IHsgdXRpbCwgbWpwZWcsIGZzIH0gZnJvbSAnYXBwaXVtL3N1cHBvcnQnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB1cmwgZnJvbSAndXJsJztcbmltcG9ydCB7IFdlYkRyaXZlckFnZW50IH0gZnJvbSAnYXBwaXVtLXdlYmRyaXZlcmFnZW50JztcbmltcG9ydCBMUlUgZnJvbSAnbHJ1LWNhY2hlJztcbmltcG9ydCB7XG4gIGNyZWF0ZVNpbSwgZ2V0RXhpc3RpbmdTaW0sIHJ1blNpbXVsYXRvclJlc2V0LCBpbnN0YWxsVG9TaW11bGF0b3IsXG4gIHNodXRkb3duT3RoZXJTaW11bGF0b3JzLCBzaHV0ZG93blNpbXVsYXRvciwgc2V0TG9jYWxlQW5kUHJlZmVyZW5jZXNcbn0gZnJvbSAnLi9zaW11bGF0b3ItbWFuYWdlbWVudCc7XG5pbXBvcnQgeyBnZXRTaW11bGF0b3IgfSBmcm9tICdhcHBpdW0taW9zLXNpbXVsYXRvcic7XG5pbXBvcnQge1xuICBkb2VzU3VwcG9ydEtleWNoYWluQXBpLCBpbnN0YWxsQ2VydGlmaWNhdGUsIGluc3RhbGxDZXJ0aWZpY2F0ZUxlZ2FjeSxcbiAgaGFzQ2VydGlmaWNhdGVMZWdhY3ksXG59IGZyb20gJy4vY2VydC11dGlscyc7XG5pbXBvcnQgeyByZXRyeUludGVydmFsLCByZXRyeSB9IGZyb20gJ2FzeW5jYm94JztcbmltcG9ydCB7XG4gIHZlcmlmeUFwcGxpY2F0aW9uUGxhdGZvcm0sIGV4dHJhY3RCdW5kbGVJZCwgU0FGQVJJX0JVTkRMRV9JRCxcbiAgZmV0Y2hTdXBwb3J0ZWRBcHBQbGF0Zm9ybXMsIEFQUF9FWFQsIElQQV9FWFQsXG4gIGlzQXBwQnVuZGxlLCBmaW5kQXBwcywgaXNvbGF0ZUFwcEJ1bmRsZSxcbn0gZnJvbSAnLi9hcHAtdXRpbHMnO1xuaW1wb3J0IHtcbiAgZGVzaXJlZENhcENvbnN0cmFpbnRzLCBQTEFURk9STV9OQU1FX0lPUywgUExBVEZPUk1fTkFNRV9UVk9TXG59IGZyb20gJy4vZGVzaXJlZC1jYXBzJztcbmltcG9ydCBjb21tYW5kcyBmcm9tICcuL2NvbW1hbmRzL2luZGV4JztcbmltcG9ydCB7XG4gIGRldGVjdFVkaWQsIGdldEFuZENoZWNrWGNvZGVWZXJzaW9uLCBnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24sXG4gIGNoZWNrQXBwUHJlc2VudCwgZ2V0RHJpdmVySW5mbyxcbiAgY2xlYXJTeXN0ZW1GaWxlcywgdHJhbnNsYXRlRGV2aWNlTmFtZSwgbm9ybWFsaXplQ29tbWFuZFRpbWVvdXRzLFxuICBERUZBVUxUX1RJTUVPVVRfS0VZLCBtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwLFxuICBwcmludFVzZXIsIHJlbW92ZUFsbFNlc3Npb25XZWJTb2NrZXRIYW5kbGVycyxcbiAgbm9ybWFsaXplUGxhdGZvcm1WZXJzaW9uLCBpc0xvY2FsSG9zdFxufSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCB7XG4gIGdldENvbm5lY3RlZERldmljZXMsIHJ1blJlYWxEZXZpY2VSZXNldCwgaW5zdGFsbFRvUmVhbERldmljZSxcbiAgZ2V0UmVhbERldmljZU9ialxufSBmcm9tICcuL3JlYWwtZGV2aWNlLW1hbmFnZW1lbnQnO1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IElEQiBmcm9tICdhcHBpdW0taWRiJztcbmltcG9ydCBERVZJQ0VfQ09OTkVDVElPTlNfRkFDVE9SWSBmcm9tICcuL2RldmljZS1jb25uZWN0aW9ucy1mYWN0b3J5JztcbmltcG9ydCBQeWlkZXZpY2UgZnJvbSAnLi9weS1pb3MtZGV2aWNlLWNsaWVudCc7XG5cblxuY29uc3QgU0hVVERPV05fT1RIRVJfRkVBVF9OQU1FID0gJ3NodXRkb3duX290aGVyX3NpbXMnO1xuY29uc3QgQ1VTVE9NSVpFX1JFU1VMVF9CVU5EUEVfUEFUSCA9ICdjdXN0b21pemVfcmVzdWx0X2J1bmRsZV9wYXRoJztcblxuY29uc3QgU1VQUE9SVEVEX0VYVEVOU0lPTlMgPSBbSVBBX0VYVCwgQVBQX0VYVF07XG5jb25zdCBNQVhfQVJDSElWRV9TQ0FOX0RFUFRIID0gMTtcbmNvbnN0IGRlZmF1bHRTZXJ2ZXJDYXBzID0ge1xuICB3ZWJTdG9yYWdlRW5hYmxlZDogZmFsc2UsXG4gIGxvY2F0aW9uQ29udGV4dEVuYWJsZWQ6IGZhbHNlLFxuICBicm93c2VyTmFtZTogJycsXG4gIHBsYXRmb3JtOiAnTUFDJyxcbiAgamF2YXNjcmlwdEVuYWJsZWQ6IHRydWUsXG4gIGRhdGFiYXNlRW5hYmxlZDogZmFsc2UsXG4gIHRha2VzU2NyZWVuc2hvdDogdHJ1ZSxcbiAgbmV0d29ya0Nvbm5lY3Rpb25FbmFibGVkOiBmYWxzZSxcbn07XG5jb25zdCBXREFfU0lNX1NUQVJUVVBfUkVUUklFUyA9IDI7XG5jb25zdCBXREFfUkVBTF9ERVZfU1RBUlRVUF9SRVRSSUVTID0gMTtcbmNvbnN0IFdEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0teGN1aXRlc3QtZHJpdmVyL2Jsb2IvbWFzdGVyL2RvY3MvcmVhbC1kZXZpY2UtY29uZmlnLm1kJztcbmNvbnN0IFdEQV9TVEFSVFVQX1JFVFJZX0lOVEVSVkFMID0gMTAwMDA7XG5jb25zdCBERUZBVUxUX1NFVFRJTkdTID0ge1xuICBuYXRpdmVXZWJUYXA6IGZhbHNlLFxuICBuYXRpdmVXZWJUYXBTdHJpY3Q6IGZhbHNlLFxuICB1c2VKU09OU291cmNlOiBmYWxzZSxcbiAgc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlczogdHJ1ZSxcbiAgZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlczogJ3R5cGUsbGFiZWwnLFxuICAvLyBSZWFkIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vV2ViRHJpdmVyQWdlbnQvYmxvYi9tYXN0ZXIvV2ViRHJpdmVyQWdlbnRMaWIvVXRpbGl0aWVzL0ZCQ29uZmlndXJhdGlvbi5tIGZvciBmb2xsb3dpbmcgc2V0dGluZ3MnIHZhbHVlc1xuICBtanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5OiAyNSxcbiAgbWpwZWdTZXJ2ZXJGcmFtZXJhdGU6IDEwLFxuICBzY3JlZW5zaG90UXVhbGl0eTogMSxcbiAgbWpwZWdTY2FsaW5nRmFjdG9yOiAxMDAsXG4gIC8vIHNldCBgcmVkdWNlTW90aW9uYCB0byBgbnVsbGAgc28gdGhhdCBpdCB3aWxsIGJlIHZlcmlmaWVkIGJ1dCBzdGlsbCBzZXQgZWl0aGVyIHRydWUvZmFsc2VcbiAgcmVkdWNlTW90aW9uOiBudWxsLFxufTtcbi8vIFRoaXMgbG9jayBhc3N1cmVzLCB0aGF0IGVhY2ggZHJpdmVyIHNlc3Npb24gZG9lcyBub3Rcbi8vIGFmZmVjdCBzaGFyZWQgcmVzb3VyY2VzIG9mIHRoZSBvdGhlciBwYXJhbGxlbCBzZXNzaW9uc1xuY29uc3QgU0hBUkVEX1JFU09VUkNFU19HVUFSRCA9IG5ldyBBc3luY0xvY2soKTtcbmNvbnN0IFdFQl9FTEVNRU5UU19DQUNIRV9TSVpFID0gNTAwO1xuXG4vKiBlc2xpbnQtZGlzYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuY29uc3QgTk9fUFJPWFlfTkFUSVZFX0xJU1QgPSBbXG4gIFsnREVMRVRFJywgL3dpbmRvdy9dLFxuICBbJ0dFVCcsIC9eXFwvc2Vzc2lvblxcL1teXFwvXSskL10sXG4gIFsnR0VUJywgL2FsZXJ0X3RleHQvXSxcbiAgWydHRVQnLCAvYWxlcnRcXC9bXlxcL10rL10sXG4gIFsnR0VUJywgL2FwcGl1bS9dLFxuICBbJ0dFVCcsIC9hdHRyaWJ1dGUvXSxcbiAgWydHRVQnLCAvY29udGV4dC9dLFxuICBbJ0dFVCcsIC9sb2NhdGlvbi9dLFxuICBbJ0dFVCcsIC9sb2cvXSxcbiAgWydHRVQnLCAvc2NyZWVuc2hvdC9dLFxuICBbJ0dFVCcsIC9zaXplL10sXG4gIFsnR0VUJywgL3NvdXJjZS9dLFxuICBbJ0dFVCcsIC90aW1lb3V0cyQvXSxcbiAgWydHRVQnLCAvdXJsL10sXG4gIFsnR0VUJywgL3dpbmRvdy9dLFxuICBbJ1BPU1QnLCAvYWNjZXB0X2FsZXJ0L10sXG4gIFsnUE9TVCcsIC9hY3Rpb25zJC9dLFxuICBbJ1BPU1QnLCAvYWxlcnRfdGV4dC9dLFxuICBbJ1BPU1QnLCAvYWxlcnRcXC9bXlxcL10rL10sXG4gIFsnUE9TVCcsIC9hcHBpdW0vXSxcbiAgWydQT1NUJywgL2FwcGl1bVxcL2RldmljZVxcL2lzX2xvY2tlZC9dLFxuICBbJ1BPU1QnLCAvYXBwaXVtXFwvZGV2aWNlXFwvbG9jay9dLFxuICBbJ1BPU1QnLCAvYXBwaXVtXFwvZGV2aWNlXFwvdW5sb2NrL10sXG4gIFsnUE9TVCcsIC9iYWNrL10sXG4gIFsnUE9TVCcsIC9jbGVhci9dLFxuICBbJ1BPU1QnLCAvY29udGV4dC9dLFxuICBbJ1BPU1QnLCAvZGlzbWlzc19hbGVydC9dLFxuICBbJ1BPU1QnLCAvZWxlbWVudFxcL2FjdGl2ZS9dLCAvLyBNSlNPTldQIGdldCBhY3RpdmUgZWxlbWVudCBzaG91bGQgcHJveHlcbiAgWydQT1NUJywgL2VsZW1lbnQkL10sXG4gIFsnUE9TVCcsIC9lbGVtZW50cyQvXSxcbiAgWydQT1NUJywgL2V4ZWN1dGUvXSxcbiAgWydQT1NUJywgL2tleXMvXSxcbiAgWydQT1NUJywgL2xvZy9dLFxuICBbJ1BPU1QnLCAvbW92ZXRvL10sXG4gIFsnUE9TVCcsIC9yZWNlaXZlX2FzeW5jX3Jlc3BvbnNlL10sIC8vIGFsd2F5cywgaW4gY2FzZSBjb250ZXh0IHN3aXRjaGVzIHdoaWxlIHdhaXRpbmdcbiAgWydQT1NUJywgL3Nlc3Npb25cXC9bXlxcL10rXFwvbG9jYXRpb24vXSwgLy8gZ2VvIGxvY2F0aW9uLCBidXQgbm90IGVsZW1lbnQgbG9jYXRpb25cbiAgWydQT1NUJywgL3NoYWtlL10sXG4gIFsnUE9TVCcsIC90aW1lb3V0cy9dLFxuICBbJ1BPU1QnLCAvdG91Y2gvXSxcbiAgWydQT1NUJywgL3VybC9dLFxuICBbJ1BPU1QnLCAvdmFsdWUvXSxcbiAgWydQT1NUJywgL3dpbmRvdy9dLFxuICBbJ0RFTEVURScsIC9jb29raWUvXSxcbiAgWydHRVQnLCAvY29va2llL10sXG4gIFsnUE9TVCcsIC9jb29raWUvXSxcbl07XG5jb25zdCBOT19QUk9YWV9XRUJfTElTVCA9IFtcbiAgWydHRVQnLCAvYXR0cmlidXRlL10sXG4gIFsnR0VUJywgL2VsZW1lbnQvXSxcbiAgWydHRVQnLCAvdGV4dC9dLFxuICBbJ0dFVCcsIC90aXRsZS9dLFxuICBbJ1BPU1QnLCAvY2xlYXIvXSxcbiAgWydQT1NUJywgL2NsaWNrL10sXG4gIFsnUE9TVCcsIC9lbGVtZW50L10sXG4gIFsnUE9TVCcsIC9mb3J3YXJkL10sXG4gIFsnUE9TVCcsIC9mcmFtZS9dLFxuICBbJ1BPU1QnLCAva2V5cy9dLFxuICBbJ1BPU1QnLCAvcmVmcmVzaC9dLFxuXS5jb25jYXQoTk9fUFJPWFlfTkFUSVZFX0xJU1QpO1xuLyogZXNsaW50LWVuYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuXG5jb25zdCBNRU1PSVpFRF9GVU5DVElPTlMgPSBbXG4gICdnZXRTdGF0dXNCYXJIZWlnaHQnLFxuICAnZ2V0RGV2aWNlUGl4ZWxSYXRpbycsXG4gICdnZXRTY3JlZW5JbmZvJyxcbl07XG5cblxuY2xhc3MgWENVSVRlc3REcml2ZXIgZXh0ZW5kcyBCYXNlRHJpdmVyIHtcbiAgY29uc3RydWN0b3IgKG9wdHMgPSB7fSwgc2hvdWxkVmFsaWRhdGVDYXBzID0gdHJ1ZSkge1xuICAgIHN1cGVyKG9wdHMsIHNob3VsZFZhbGlkYXRlQ2Fwcyk7XG5cbiAgICB0aGlzLmRlc2lyZWRDYXBDb25zdHJhaW50cyA9IGRlc2lyZWRDYXBDb25zdHJhaW50cztcblxuICAgIHRoaXMubG9jYXRvclN0cmF0ZWdpZXMgPSBbXG4gICAgICAneHBhdGgnLFxuICAgICAgJ2lkJyxcbiAgICAgICduYW1lJyxcbiAgICAgICdjbGFzcyBuYW1lJyxcbiAgICAgICctaW9zIHByZWRpY2F0ZSBzdHJpbmcnLFxuICAgICAgJy1pb3MgY2xhc3MgY2hhaW4nLFxuICAgICAgJ2FjY2Vzc2liaWxpdHkgaWQnLFxuICAgICAgJ2NzcyBzZWxlY3RvcicsXG4gICAgXTtcbiAgICB0aGlzLndlYkxvY2F0b3JTdHJhdGVnaWVzID0gW1xuICAgICAgJ2xpbmsgdGV4dCcsXG4gICAgICAnY3NzIHNlbGVjdG9yJyxcbiAgICAgICd0YWcgbmFtZScsXG4gICAgICAnbGluayB0ZXh0JyxcbiAgICAgICdwYXJ0aWFsIGxpbmsgdGV4dCcsXG4gICAgXTtcbiAgICB0aGlzLnJlc2V0SW9zKCk7XG4gICAgdGhpcy5zZXR0aW5ncyA9IG5ldyBEZXZpY2VTZXR0aW5ncyhERUZBVUxUX1NFVFRJTkdTLCB0aGlzLm9uU2V0dGluZ3NVcGRhdGUuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5sb2dzID0ge307XG5cbiAgICAvLyBtZW1vaXplIGZ1bmN0aW9ucyBoZXJlLCBzbyB0aGF0IHRoZXkgYXJlIGRvbmUgb24gYSBwZXItaW5zdGFuY2UgYmFzaXNcbiAgICBmb3IgKGNvbnN0IGZuIG9mIE1FTU9JWkVEX0ZVTkNUSU9OUykge1xuICAgICAgdGhpc1tmbl0gPSBfLm1lbW9pemUodGhpc1tmbl0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIG9uU2V0dGluZ3NVcGRhdGUgKGtleSwgdmFsdWUpIHtcbiAgICBpZiAoa2V5ICE9PSAnbmF0aXZlV2ViVGFwJyAmJiBrZXkgIT09ICduYXRpdmVXZWJUYXBTdHJpY3QnKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9hcHBpdW0vc2V0dGluZ3MnLCAnUE9TVCcsIHtcbiAgICAgICAgc2V0dGluZ3M6IHtba2V5XTogdmFsdWV9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy5vcHRzW2tleV0gPSAhIXZhbHVlO1xuICB9XG5cbiAgcmVzZXRJb3MgKCkge1xuICAgIHRoaXMub3B0cyA9IHRoaXMub3B0cyB8fCB7fTtcbiAgICB0aGlzLndkYSA9IG51bGw7XG4gICAgdGhpcy5vcHRzLmRldmljZSA9IG51bGw7XG4gICAgdGhpcy5qd3BQcm94eUFjdGl2ZSA9IGZhbHNlO1xuICAgIHRoaXMucHJveHlSZXFSZXMgPSBudWxsO1xuICAgIHRoaXMuandwUHJveHlBdm9pZCA9IFtdO1xuICAgIHRoaXMuc2FmYXJpID0gZmFsc2U7XG4gICAgdGhpcy5jYWNoZWRXZGFTdGF0dXMgPSBudWxsO1xuXG4gICAgdGhpcy5jdXJXZWJGcmFtZXMgPSBbXTtcbiAgICB0aGlzLl9jdXJyZW50VXJsID0gbnVsbDtcbiAgICB0aGlzLmN1ckNvbnRleHQgPSBudWxsO1xuICAgIHRoaXMueGNvZGVWZXJzaW9uID0ge307XG4gICAgdGhpcy5jb250ZXh0cyA9IFtdO1xuICAgIHRoaXMuaW1wbGljaXRXYWl0TXMgPSAwO1xuICAgIHRoaXMuYXN5bmNsaWJXYWl0TXMgPSAwO1xuICAgIHRoaXMucGFnZUxvYWRNcyA9IDYwMDA7XG4gICAgdGhpcy5sYW5kc2NhcGVXZWJDb29yZHNPZmZzZXQgPSAwO1xuICAgIHRoaXMucmVtb3RlID0gbnVsbDtcbiAgICB0aGlzLl9jb25kaXRpb25JbmR1Y2VyU2VydmljZSA9IG51bGw7XG5cbiAgICB0aGlzLndlYkVsZW1lbnRzQ2FjaGUgPSBuZXcgTFJVKHtcbiAgICAgIG1heDogV0VCX0VMRU1FTlRTX0NBQ0hFX1NJWkUsXG4gICAgfSk7XG4gIH1cblxuICBnZXQgZHJpdmVyRGF0YSAoKSB7XG4gICAgLy8gVE9ETyBmaWxsIG91dCByZXNvdXJjZSBpbmZvIGhlcmVcbiAgICByZXR1cm4ge307XG4gIH1cblxuICBhc3luYyBnZXRTdGF0dXMgKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5kcml2ZXJJbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy5kcml2ZXJJbmZvID0gYXdhaXQgZ2V0RHJpdmVySW5mbygpO1xuICAgIH1cbiAgICBsZXQgc3RhdHVzID0ge2J1aWxkOiB7dmVyc2lvbjogdGhpcy5kcml2ZXJJbmZvLnZlcnNpb259fTtcbiAgICBpZiAodGhpcy5jYWNoZWRXZGFTdGF0dXMpIHtcbiAgICAgIHN0YXR1cy53ZGEgPSB0aGlzLmNhY2hlZFdkYVN0YXR1cztcbiAgICB9XG4gICAgcmV0dXJuIHN0YXR1cztcbiAgfVxuXG4gIG1lcmdlQ2xpQXJnc1RvT3B0cyAoKSB7XG4gICAgbGV0IGRpZE1lcmdlID0gZmFsc2U7XG4gICAgLy8gdGhpcy5jbGlBcmdzIHNob3VsZCBuZXZlciBpbmNsdWRlIGFueXRoaW5nIHdlIGRvIG5vdCBleHBlY3QuXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5jbGlBcmdzID8/IHt9KSkge1xuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywga2V5KSkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBDTEkgYXJnICcke2tleX0nIHdpdGggdmFsdWUgJyR7dmFsdWV9JyBvdmVyd3JpdGVzIHZhbHVlICcke3RoaXMub3B0c1trZXldfScgc2VudCBpbiB2aWEgY2FwcylgKTtcbiAgICAgICAgZGlkTWVyZ2UgPSB0cnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5vcHRzW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGRpZE1lcmdlO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlU2Vzc2lvbiAoLi4uYXJncykge1xuICAgIHRoaXMubGlmZWN5Y2xlRGF0YSA9IHt9OyAvLyB0aGlzIGlzIHVzZWQgZm9yIGtlZXBpbmcgdHJhY2sgb2YgdGhlIHN0YXRlIHdlIHN0YXJ0IHNvIHdoZW4gd2UgZGVsZXRlIHRoZSBzZXNzaW9uIHdlIGNhbiBwdXQgdGhpbmdzIGJhY2tcbiAgICB0cnkge1xuICAgICAgbGV0IFtzZXNzaW9uSWQsIGNhcHNdID0gYXdhaXQgc3VwZXIuY3JlYXRlU2Vzc2lvbiguLi5hcmdzKTtcbiAgICAgIHRoaXMub3B0cy5zZXNzaW9uSWQgPSBzZXNzaW9uSWQ7XG5cbiAgICAgIC8vIG1lcmdlIGNsaSBhcmdzIHRvIG9wdHMsIGFuZCBpZiB3ZSBkaWQgbWVyZ2UgYW55LCByZXZhbGlkYXRlIG9wdHMgdG8gZW5zdXJlIHRoZSBmaW5hbCBzZXRcbiAgICAgIC8vIGlzIGFsc28gY29uc2lzdGVudFxuICAgICAgaWYgKHRoaXMubWVyZ2VDbGlBcmdzVG9PcHRzKCkpIHtcbiAgICAgICAgdGhpcy52YWxpZGF0ZURlc2lyZWRDYXBzKHsuLi5jYXBzLCAuLi50aGlzLmNsaUFyZ3N9KTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5zdGFydCgpO1xuXG4gICAgICAvLyBtZXJnZSBzZXJ2ZXIgY2FwYWJpbGl0aWVzICsgZGVzaXJlZCBjYXBhYmlsaXRpZXNcbiAgICAgIGNhcHMgPSBPYmplY3QuYXNzaWduKHt9LCBkZWZhdWx0U2VydmVyQ2FwcywgY2Fwcyk7XG4gICAgICAvLyB1cGRhdGUgdGhlIHVkaWQgd2l0aCB3aGF0IGlzIGFjdHVhbGx5IHVzZWRcbiAgICAgIGNhcHMudWRpZCA9IHRoaXMub3B0cy51ZGlkO1xuICAgICAgLy8gZW5zdXJlIHdlIHRyYWNrIG5hdGl2ZVdlYlRhcCBjYXBhYmlsaXR5IGFzIGEgc2V0dGluZyBhcyB3ZWxsXG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnbmF0aXZlV2ViVGFwJykpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh7bmF0aXZlV2ViVGFwOiB0aGlzLm9wdHMubmF0aXZlV2ViVGFwfSk7XG4gICAgICB9XG4gICAgICAvLyBlbnN1cmUgd2UgdHJhY2sgbmF0aXZlV2ViVGFwU3RyaWN0IGNhcGFiaWxpdHkgYXMgYSBzZXR0aW5nIGFzIHdlbGxcbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICduYXRpdmVXZWJUYXBTdHJpY3QnKSkge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZVNldHRpbmdzKHtuYXRpdmVXZWJUYXBTdHJpY3Q6IHRoaXMub3B0cy5uYXRpdmVXZWJUYXBTdHJpY3R9KTtcbiAgICAgIH1cbiAgICAgIC8vIGVuc3VyZSB3ZSB0cmFjayB1c2VKU09OU291cmNlIGNhcGFiaWxpdHkgYXMgYSBzZXR0aW5nIGFzIHdlbGxcbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICd1c2VKU09OU291cmNlJykpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh7dXNlSlNPTlNvdXJjZTogdGhpcy5vcHRzLnVzZUpTT05Tb3VyY2V9KTtcbiAgICAgIH1cblxuICAgICAgbGV0IHdkYVNldHRpbmdzID0ge1xuICAgICAgICBlbGVtZW50UmVzcG9uc2VBdHRyaWJ1dGVzOiBERUZBVUxUX1NFVFRJTkdTLmVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXMsXG4gICAgICAgIHNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXM6IERFRkFVTFRfU0VUVElOR1Muc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcyxcbiAgICAgIH07XG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlcycpKSB7XG4gICAgICAgIHdkYVNldHRpbmdzLmVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXMgPSB0aGlzLm9wdHMuZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlcztcbiAgICAgIH1cbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICdzaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzJykpIHtcbiAgICAgICAgd2RhU2V0dGluZ3Muc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcyA9IHRoaXMub3B0cy5zaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzO1xuICAgICAgfVxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ21qcGVnU2VydmVyU2NyZWVuc2hvdFF1YWxpdHknKSkge1xuICAgICAgICB3ZGFTZXR0aW5ncy5tanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5ID0gdGhpcy5vcHRzLm1qcGVnU2VydmVyU2NyZWVuc2hvdFF1YWxpdHk7XG4gICAgICB9XG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnbWpwZWdTZXJ2ZXJGcmFtZXJhdGUnKSkge1xuICAgICAgICB3ZGFTZXR0aW5ncy5tanBlZ1NlcnZlckZyYW1lcmF0ZSA9IHRoaXMub3B0cy5tanBlZ1NlcnZlckZyYW1lcmF0ZTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICdzY3JlZW5zaG90UXVhbGl0eScpKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oYFNldHRpbmcgdGhlIHF1YWxpdHkgb2YgcGhvbmUgc2NyZWVuc2hvdDogJyR7dGhpcy5vcHRzLnNjcmVlbnNob3RRdWFsaXR5fSdgKTtcbiAgICAgICAgd2RhU2V0dGluZ3Muc2NyZWVuc2hvdFF1YWxpdHkgPSB0aGlzLm9wdHMuc2NyZWVuc2hvdFF1YWxpdHk7XG4gICAgICB9XG4gICAgICAvLyBlbnN1cmUgV0RBIGdldHMgb3VyIGRlZmF1bHRzIGluc3RlYWQgb2Ygd2hhdGV2ZXIgaXRzIG93biBtaWdodCBiZVxuICAgICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh3ZGFTZXR0aW5ncyk7XG5cbiAgICAgIC8vIHR1cm4gb24gbWpwZWcgc3RyZWFtIHJlYWRpbmcgaWYgcmVxdWVzdGVkXG4gICAgICBpZiAodGhpcy5vcHRzLm1qcGVnU2NyZWVuc2hvdFVybCkge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBTdGFydGluZyBNSlBFRyBzdHJlYW0gcmVhZGluZyBVUkw6ICcke3RoaXMub3B0cy5tanBlZ1NjcmVlbnNob3RVcmx9J2ApO1xuICAgICAgICB0aGlzLm1qcGVnU3RyZWFtID0gbmV3IG1qcGVnLk1KcGVnU3RyZWFtKHRoaXMub3B0cy5tanBlZ1NjcmVlbnNob3RVcmwpO1xuICAgICAgICBhd2FpdCB0aGlzLm1qcGVnU3RyZWFtLnN0YXJ0KCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gW3Nlc3Npb25JZCwgY2Fwc107XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5sb2cuZXJyb3IoSlNPTi5zdHJpbmdpZnkoZSkpO1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVTZXNzaW9uKCk7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkZWZhdWx0IFVSTCBmb3IgU2FmYXJpIGJyb3dzZXJcbiAgICogQHJldHVybnMge3N0cmluZ30gVGhlIGRlZmF1bHQgVVJMXG4gICAqL1xuICBnZXREZWZhdWx0VXJsICgpIHtcbiAgICAvLyBTZXR0aW5nIHRoaXMgdG8gc29tZSBleHRlcm5hbCBVUkwgc2xvd3MgZG93biBBcHBpdW0gc3RhcnR1cFxuICAgIHJldHVybiB0aGlzLmlzUmVhbERldmljZSgpXG4gICAgICA/IGBodHRwOi8vMTI3LjAuMC4xOiR7dGhpcy5vcHRzLndkYUxvY2FsUG9ydCB8fCA4MTAwfS9oZWFsdGhgXG4gICAgICA6IGBodHRwOi8vJHtcbiAgICAgICAgdGhpcy5vcHRzLmFkZHJlc3MuaW5jbHVkZXMoJzonKSA/IGBbJHt0aGlzLm9wdHMuYWRkcmVzc31dYCA6IHRoaXMub3B0cy5hZGRyZXNzXG4gICAgICB9OiR7dGhpcy5vcHRzLnBvcnR9L3dlbGNvbWVgO1xuICB9XG5cbiAgYXN5bmMgc3RhcnQgKCkge1xuICAgIHRoaXMub3B0cy5ub1Jlc2V0ID0gISF0aGlzLm9wdHMubm9SZXNldDtcbiAgICB0aGlzLm9wdHMuZnVsbFJlc2V0ID0gISF0aGlzLm9wdHMuZnVsbFJlc2V0O1xuXG4gICAgYXdhaXQgcHJpbnRVc2VyKCk7XG5cbiAgICB0aGlzLm9wdHMuaW9zU2RrVmVyc2lvbiA9IG51bGw7IC8vIEZvciBXREEgYW5kIHhjb2RlYnVpbGRcbiAgICBjb25zdCB7ZGV2aWNlLCB1ZGlkLCByZWFsRGV2aWNlfSA9IGF3YWl0IHRoaXMuZGV0ZXJtaW5lRGV2aWNlKCk7XG4gICAgdGhpcy5sb2cuaW5mbyhgRGV0ZXJtaW5pbmcgZGV2aWNlIHRvIHJ1biB0ZXN0cyBvbjogdWRpZDogJyR7dWRpZH0nLCByZWFsIGRldmljZTogJHtyZWFsRGV2aWNlfWApO1xuICAgIHRoaXMub3B0cy5kZXZpY2UgPSBkZXZpY2U7XG4gICAgdGhpcy5vcHRzLnVkaWQgPSB1ZGlkO1xuICAgIHRoaXMub3B0cy5yZWFsRGV2aWNlID0gcmVhbERldmljZTtcblxuICAgIGlmICh0aGlzLm9wdHMuc2ltdWxhdG9yRGV2aWNlc1NldFBhdGgpIHtcbiAgICAgIGlmIChyZWFsRGV2aWNlKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oYFRoZSAnc2ltdWxhdG9yRGV2aWNlc1NldFBhdGgnIGNhcGFiaWxpdHkgaXMgb25seSBzdXBwb3J0ZWQgZm9yIFNpbXVsYXRvciBkZXZpY2VzYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZy5pbmZvKGBTZXR0aW5nIHNpbXVsYXRvciBkZXZpY2VzIHNldCBwYXRoIHRvICcke3RoaXMub3B0cy5zaW11bGF0b3JEZXZpY2VzU2V0UGF0aH0nYCk7XG4gICAgICAgIHRoaXMub3B0cy5kZXZpY2UuZGV2aWNlc1NldFBhdGggPSB0aGlzLm9wdHMuc2ltdWxhdG9yRGV2aWNlc1NldFBhdGg7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gYXQgdGhpcyBwb2ludCBpZiB0aGVyZSBpcyBubyBwbGF0Zm9ybVZlcnNpb24sIGdldCBpdCBmcm9tIHRoZSBkZXZpY2VcbiAgICBpZiAoIXRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gJiYgdGhpcy5vcHRzLmRldmljZSkge1xuICAgICAgdGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiA9IGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZ2V0UGxhdGZvcm1WZXJzaW9uKCk7XG4gICAgICB0aGlzLmxvZy5pbmZvKGBObyBwbGF0Zm9ybVZlcnNpb24gc3BlY2lmaWVkLiBVc2luZyBkZXZpY2UgdmVyc2lvbjogJyR7dGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbn0nYCk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFZlcnNpb24gPSBub3JtYWxpemVQbGF0Zm9ybVZlcnNpb24odGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbik7XG4gICAgaWYgKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gIT09IG5vcm1hbGl6ZWRWZXJzaW9uKSB7XG4gICAgICB0aGlzLmxvZy5pbmZvKGBOb3JtYWxpemVkIHBsYXRmb3JtVmVyc2lvbiBjYXBhYmlsaXR5IHZhbHVlICcke3RoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb259JyB0byAnJHtub3JtYWxpemVkVmVyc2lvbn0nYCk7XG4gICAgICB0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uID0gbm9ybWFsaXplZFZlcnNpb247XG4gICAgfVxuICAgIGlmICh1dGlsLmNvbXBhcmVWZXJzaW9ucyh0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uLCAnPCcsICc5LjMnKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQbGF0Zm9ybSB2ZXJzaW9uIG11c3QgYmUgOS4zIG9yIGFib3ZlLiAnJHt0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9ufScgaXMgbm90IHN1cHBvcnRlZC5gKTtcbiAgICB9XG5cbiAgICBpZiAoXy5pc0VtcHR5KHRoaXMueGNvZGVWZXJzaW9uKSAmJiAoIXRoaXMub3B0cy53ZWJEcml2ZXJBZ2VudFVybCB8fCAhdGhpcy5vcHRzLnJlYWxEZXZpY2UpKSB7XG4gICAgICAvLyBubyBgd2ViRHJpdmVyQWdlbnRVcmxgLCBvciBvbiBhIHNpbXVsYXRvciwgc28gd2UgbmVlZCBhbiBYY29kZSB2ZXJzaW9uXG4gICAgICB0aGlzLnhjb2RlVmVyc2lvbiA9IGF3YWl0IGdldEFuZENoZWNrWGNvZGVWZXJzaW9uKCk7XG4gICAgfVxuICAgIHRoaXMubG9nRXZlbnQoJ3hjb2RlRGV0YWlsc1JldHJpZXZlZCcpO1xuXG4gICAgaWYgKF8udG9Mb3dlcih0aGlzLm9wdHMuYnJvd3Nlck5hbWUpID09PSAnc2FmYXJpJykge1xuICAgICAgdGhpcy5sb2cuaW5mbygnU2FmYXJpIHRlc3QgcmVxdWVzdGVkJyk7XG4gICAgICB0aGlzLnNhZmFyaSA9IHRydWU7XG4gICAgICB0aGlzLm9wdHMuYXBwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMgPSB0aGlzLm9wdHMucHJvY2Vzc0FyZ3VtZW50cyB8fCB7fTtcbiAgICAgIHRoaXMub3B0cy5idW5kbGVJZCA9IFNBRkFSSV9CVU5ETEVfSUQ7XG4gICAgICB0aGlzLl9jdXJyZW50VXJsID0gdGhpcy5vcHRzLnNhZmFyaUluaXRpYWxVcmwgfHwgdGhpcy5nZXREZWZhdWx0VXJsKCk7XG4gICAgfSBlbHNlIGlmICh0aGlzLm9wdHMuYXBwIHx8IHRoaXMub3B0cy5idW5kbGVJZCkge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmVBcHAoKTtcbiAgICB9XG4gICAgdGhpcy5sb2dFdmVudCgnYXBwQ29uZmlndXJlZCcpO1xuXG4gICAgLy8gZmFpbCB2ZXJ5IGVhcmx5IGlmIHRoZSBhcHAgZG9lc24ndCBhY3R1YWxseSBleGlzdFxuICAgIC8vIG9yIGlmIGJ1bmRsZSBpZCBkb2Vzbid0IHBvaW50IHRvIGFuIGluc3RhbGxlZCBhcHBcbiAgICBpZiAodGhpcy5vcHRzLmFwcCkge1xuICAgICAgYXdhaXQgY2hlY2tBcHBQcmVzZW50KHRoaXMub3B0cy5hcHApO1xuXG4gICAgICBpZiAoIXRoaXMub3B0cy5idW5kbGVJZCkge1xuICAgICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSBhd2FpdCBleHRyYWN0QnVuZGxlSWQodGhpcy5vcHRzLmFwcCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW5SZXNldCgpO1xuXG4gICAgdGhpcy53ZGEgPSBuZXcgV2ViRHJpdmVyQWdlbnQodGhpcy54Y29kZVZlcnNpb24sIHRoaXMub3B0cywgdGhpcy5sb2cpO1xuICAgIC8vIERlcml2ZWQgZGF0YSBwYXRoIHJldHJpZXZhbCBpcyBhbiBleHBlbnNpdmUgb3BlcmF0aW9uXG4gICAgLy8gV2UgY291bGQgc3RhcnQgdGhhdCBub3cgaW4gYmFja2dyb3VuZCBhbmQgZ2V0IHRoZSBjYWNoZWQgcmVzdWx0XG4gICAgLy8gd2hlbmV2ZXIgaXQgaXMgbmVlZGVkXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHByb21pc2UvcHJlZmVyLWF3YWl0LXRvLXRoZW5cbiAgICB0aGlzLndkYS5yZXRyaWV2ZURlcml2ZWREYXRhUGF0aCgpLmNhdGNoKChlKSA9PiB0aGlzLmxvZy5kZWJ1ZyhlKSk7XG5cbiAgICBjb25zdCBtZW1vaXplZExvZ0luZm8gPSBfLm1lbW9pemUoKCkgPT4ge1xuICAgICAgdGhpcy5sb2cuaW5mbyhcIidza2lwTG9nQ2FwdHVyZScgaXMgc2V0LiBTa2lwcGluZyBzdGFydGluZyBsb2dzIHN1Y2ggYXMgY3Jhc2gsIHN5c3RlbSwgc2FmYXJpIGNvbnNvbGUgYW5kIHNhZmFyaSBuZXR3b3JrLlwiKTtcbiAgICB9KTtcbiAgICBjb25zdCBzdGFydExvZ0NhcHR1cmUgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5vcHRzLnNraXBMb2dDYXB0dXJlKSB7XG4gICAgICAgIG1lbW9pemVkTG9nSW5mbygpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuc3RhcnRMb2dDYXB0dXJlKCk7XG4gICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ2xvZ0NhcHR1cmVTdGFydGVkJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gICAgY29uc3QgaXNMb2dDYXB0dXJlU3RhcnRlZCA9IGF3YWl0IHN0YXJ0TG9nQ2FwdHVyZSgpO1xuXG4gICAgdGhpcy5sb2cuaW5mbyhgU2V0dGluZyB1cCAke3RoaXMuaXNSZWFsRGV2aWNlKCkgPyAncmVhbCBkZXZpY2UnIDogJ3NpbXVsYXRvcid9YCk7XG5cbiAgICBpZiAodGhpcy5pc1NpbXVsYXRvcigpKSB7XG4gICAgICBpZiAodGhpcy5vcHRzLnNodXRkb3duT3RoZXJTaW11bGF0b3JzKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRmVhdHVyZUVuYWJsZWQoU0hVVERPV05fT1RIRVJfRkVBVF9OQU1FKTtcbiAgICAgICAgYXdhaXQgc2h1dGRvd25PdGhlclNpbXVsYXRvcnModGhpcy5vcHRzLmRldmljZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIHRoaXMgc2hvdWxkIGJlIGRvbmUgYmVmb3JlIHRoZSBzaW11bGF0b3IgaXMgc3RhcnRlZFxuICAgICAgLy8gaWYgaXQgaXMgYWxyZWFkeSBydW5uaW5nLCB0aGlzIGNhcCB3b24ndCB3b3JrLCB3aGljaCBpcyBkb2N1bWVudGVkXG4gICAgICBpZiAodGhpcy5pc1NhZmFyaSgpICYmIHRoaXMub3B0cy5zYWZhcmlHbG9iYWxQcmVmZXJlbmNlcykge1xuICAgICAgICBpZiAoYXdhaXQgdGhpcy5vcHRzLmRldmljZS51cGRhdGVTYWZhcmlHbG9iYWxTZXR0aW5ncyh0aGlzLm9wdHMuc2FmYXJpR2xvYmFsUHJlZmVyZW5jZXMpKSB7XG4gICAgICAgICAgdGhpcy5sb2cuZGVidWcoYFNhZmFyaSBnbG9iYWwgcHJlZmVyZW5jZXMgdXBkYXRlZGApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9jYWxDb25maWcgPSBhd2FpdCBzZXRMb2NhbGVBbmRQcmVmZXJlbmNlcyh0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMsIHRoaXMuaXNTYWZhcmkoKSwgYXN5bmMgKHNpbSkgPT4ge1xuICAgICAgICBhd2FpdCBzaHV0ZG93blNpbXVsYXRvcihzaW0pO1xuXG4gICAgICAgIC8vIHdlIGRvbid0IGtub3cgaWYgdGhlcmUgbmVlZHMgdG8gYmUgY2hhbmdlcyBhIHByaW9yaSwgc28gY2hhbmdlIGZpcnN0LlxuICAgICAgICAvLyBzb21ldGltZXMgdGhlIHNodXRkb3duIHByb2Nlc3MgY2hhbmdlcyB0aGUgc2V0dGluZ3MsIHNvIHJlc2V0IHRoZW0sXG4gICAgICAgIC8vIGtub3dpbmcgdGhhdCB0aGUgc2ltIGlzIGFscmVhZHkgc2h1dFxuICAgICAgICBhd2FpdCBzZXRMb2NhbGVBbmRQcmVmZXJlbmNlcyhzaW0sIHRoaXMub3B0cywgdGhpcy5pc1NhZmFyaSgpKTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodGhpcy5vcHRzLmN1c3RvbVNTTENlcnQgJiYgIShhd2FpdCBkb2VzU3VwcG9ydEtleWNoYWluQXBpKHRoaXMub3B0cy5kZXZpY2UpKSkge1xuICAgICAgICBjb25zdCBjZXJ0SGVhZCA9IF8udHJ1bmNhdGUodGhpcy5vcHRzLmN1c3RvbVNTTENlcnQsIHtsZW5ndGg6IDIwfSk7XG4gICAgICAgIHRoaXMubG9nLmluZm8oYEluc3RhbGxpbmcgdGhlIGN1c3RvbSBTU0wgY2VydGlmaWNhdGUgJyR7Y2VydEhlYWR9J2ApO1xuICAgICAgICBpZiAoYXdhaXQgaGFzQ2VydGlmaWNhdGVMZWdhY3kodGhpcy5vcHRzLmRldmljZSwgdGhpcy5vcHRzLmN1c3RvbVNTTENlcnQpKSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbyhgU1NMIGNlcnRpZmljYXRlICcke2NlcnRIZWFkfScgYWxyZWFkeSBpbnN0YWxsZWRgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmxvZy5pbmZvKGBNYWtpbmcgc3VyZSBTaW11bGF0b3IgaXMgc2h1dCBkb3duLCAnICtcbiAgICAgICAgICAgICdzbyB0aGF0IFNTTCBjZXJ0aWZpY2F0ZSBpbnN0YWxsYXRpb24gdGFrZXMgZWZmZWN0YCk7XG4gICAgICAgICAgYXdhaXQgc2h1dGRvd25TaW11bGF0b3IodGhpcy5vcHRzLmRldmljZSk7XG4gICAgICAgICAgYXdhaXQgaW5zdGFsbENlcnRpZmljYXRlTGVnYWN5KHRoaXMub3B0cy5kZXZpY2UsIHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ0V2ZW50KCdjdXN0b21DZXJ0SW5zdGFsbGVkJyk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTaW0oKTtcblxuICAgICAgaWYgKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0ICYmIGF3YWl0IGRvZXNTdXBwb3J0S2V5Y2hhaW5BcGkodGhpcy5vcHRzLmRldmljZSkpIHtcbiAgICAgICAgLy8gU2ltdWxhdG9yIG11c3QgYmUgYm9vdGVkIGluIG9yZGVyIHRvIGNhbGwgdGhpcyBoZWxwZXJcbiAgICAgICAgYXdhaXQgaW5zdGFsbENlcnRpZmljYXRlKHRoaXMub3B0cy5kZXZpY2UsIHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0KTtcbiAgICAgICAgdGhpcy5sb2dFdmVudCgnY3VzdG9tQ2VydEluc3RhbGxlZCcpO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5vcHRzLmxhdW5jaFdpdGhJREIgJiYgdGhpcy5pc1NpbXVsYXRvcigpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgaWRiID0gbmV3IElEQih7dWRpZH0pO1xuICAgICAgICAgIGF3YWl0IGlkYi5jb25uZWN0KCk7XG4gICAgICAgICAgdGhpcy5vcHRzLmRldmljZS5pZGIgPSBpZGI7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICB0aGlzLmxvZy5pbmZvKGBpZGIgd2lsbCBub3QgYmUgdXNlZCBmb3IgU2ltdWxhdG9yIGludGVyYWN0aW9uLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dFdmVudCgnc2ltU3RhcnRlZCcpO1xuICAgICAgaWYgKCFpc0xvZ0NhcHR1cmVTdGFydGVkKSB7XG4gICAgICAgIC8vIFJldHJ5IGxvZyBjYXB0dXJlIGlmIFNpbXVsYXRvciB3YXMgbm90IHJ1bm5pbmcgYmVmb3JlXG4gICAgICAgIGF3YWl0IHN0YXJ0TG9nQ2FwdHVyZSgpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5vcHRzLmN1c3RvbVNTTENlcnQpIHtcbiAgICAgIGF3YWl0IG5ldyBQeWlkZXZpY2UodWRpZCkuaW5zdGFsbFByb2ZpbGUoe3BheWxvYWQ6IHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0fSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0cy5hcHApIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5zdGFsbEFVVCgpO1xuICAgICAgdGhpcy5sb2dFdmVudCgnYXBwSW5zdGFsbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gaWYgd2Ugb25seSBoYXZlIGJ1bmRsZSBpZGVudGlmaWVyIGFuZCBubyBhcHAsIGZhaWwgaWYgaXQgaXMgbm90IGFscmVhZHkgaW5zdGFsbGVkXG4gICAgaWYgKCF0aGlzLm9wdHMuYXBwICYmIHRoaXMub3B0cy5idW5kbGVJZCAmJiAhdGhpcy5pc1NhZmFyaSgpKSB7XG4gICAgICBpZiAoIWF3YWl0IHRoaXMub3B0cy5kZXZpY2UuaXNBcHBJbnN0YWxsZWQodGhpcy5vcHRzLmJ1bmRsZUlkKSkge1xuICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGBBcHAgd2l0aCBidW5kbGUgaWRlbnRpZmllciAnJHt0aGlzLm9wdHMuYnVuZGxlSWR9JyB1bmtub3duYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0cy5wZXJtaXNzaW9ucykge1xuICAgICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnU2V0dGluZyB0aGUgcmVxdWVzdGVkIHBlcm1pc3Npb25zIGJlZm9yZSBXREEgaXMgc3RhcnRlZCcpO1xuICAgICAgICBmb3IgKGNvbnN0IFtidW5kbGVJZCwgcGVybWlzc2lvbnNNYXBwaW5nXSBvZiBfLnRvUGFpcnMoSlNPTi5wYXJzZSh0aGlzLm9wdHMucGVybWlzc2lvbnMpKSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2Uuc2V0UGVybWlzc2lvbnMoYnVuZGxlSWQsIHBlcm1pc3Npb25zTWFwcGluZyk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ1NldHRpbmcgcGVybWlzc2lvbnMgaXMgb25seSBzdXBwb3J0ZWQgb24gU2ltdWxhdG9yLiAnICtcbiAgICAgICAgICAnVGhlIFwicGVybWlzc2lvbnNcIiBjYXBhYmlsaXR5IHdpbGwgYmUgaWdub3JlZC4nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1NpbXVsYXRvcigpKSB7XG4gICAgICBpZiAodGhpcy5vcHRzLmNhbGVuZGFyQWNjZXNzQXV0aG9yaXplZCkge1xuICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmVuYWJsZUNhbGVuZGFyQWNjZXNzKHRoaXMub3B0cy5idW5kbGVJZCk7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMub3B0cy5jYWxlbmRhckFjY2Vzc0F1dGhvcml6ZWQgPT09IGZhbHNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZGlzYWJsZUNhbGVuZGFyQWNjZXNzKHRoaXMub3B0cy5idW5kbGVJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zdGFydFdkYSh0aGlzLm9wdHMuc2Vzc2lvbklkLCByZWFsRGV2aWNlKTtcblxuICAgIGF3YWl0IHRoaXMuc2V0UmVkdWNlTW90aW9uKHRoaXMub3B0cy5yZWR1Y2VNb3Rpb24pO1xuXG4gICAgYXdhaXQgdGhpcy5zZXRJbml0aWFsT3JpZW50YXRpb24odGhpcy5vcHRzLm9yaWVudGF0aW9uKTtcbiAgICB0aGlzLmxvZ0V2ZW50KCdvcmllbnRhdGlvblNldCcpO1xuXG4gICAgaWYgKHRoaXMuaXNTYWZhcmkoKSB8fCB0aGlzLm9wdHMuYXV0b1dlYnZpZXcpIHtcbiAgICAgIGF3YWl0IHRoaXMuYWN0aXZhdGVSZWNlbnRXZWJ2aWV3KCk7XG4gICAgfVxuICAgIGlmICh0aGlzLmlzU2FmYXJpKCkpIHtcbiAgICAgIGlmICghKHRoaXMub3B0cy5zYWZhcmlJbml0aWFsVXJsID09PSAnJ1xuICAgICAgICAgIHx8ICh0aGlzLm9wdHMubm9SZXNldCAmJiBfLmlzTmlsKHRoaXMub3B0cy5zYWZhcmlJbml0aWFsVXJsKSkpKSB7XG4gICAgICAgIHRoaXMubG9nLmluZm8oYEFib3V0IHRvIHNldCB0aGUgaW5pdGlhbCBTYWZhcmkgVVJMIHRvICcke3RoaXMuZ2V0Q3VycmVudFVybCgpfScuYCArXG4gICAgICAgICAgYFVzZSAnc2FmYXJpSW5pdGlhbFVybCcgY2FwYWJpbGl0eSBpbiBvcmRlciB0byBjdXN0b21pemUgaXRgKTtcbiAgICAgICAgYXdhaXQgdGhpcy5zZXRVcmwodGhpcy5nZXRDdXJyZW50VXJsKCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zZXRDdXJyZW50VXJsKGF3YWl0IHRoaXMuZ2V0VXJsKCkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydCBXZWJEcml2ZXJBZ2VudFJ1bm5lclxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gVGhlIGlkIG9mIHRoZSB0YXJnZXQgc2Vzc2lvbiB0byBsYXVuY2ggV0RBIHdpdGguXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gcmVhbERldmljZSAtIEVxdWFscyB0byB0cnVlIGlmIHRoZSB0ZXN0IHRhcmdldCBkZXZpY2UgaXMgYSByZWFsIGRldmljZS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0V2RhIChzZXNzaW9uSWQsIHJlYWxEZXZpY2UpIHtcbiAgICAvLyBEb24ndCBjbGVhbnVwIHRoZSBwcm9jZXNzZXMgaWYgd2ViRHJpdmVyQWdlbnRVcmwgaXMgc2V0XG4gICAgaWYgKCF1dGlsLmhhc1ZhbHVlKHRoaXMud2RhLndlYkRyaXZlckFnZW50VXJsKSkge1xuICAgICAgYXdhaXQgdGhpcy53ZGEuY2xlYW51cE9ic29sZXRlUHJvY2Vzc2VzKCk7XG4gICAgfVxuXG4gICAgY29uc3QgdXNlUG9ydEZvcndhcmRpbmcgPSB0aGlzLmlzUmVhbERldmljZSgpXG4gICAgICAmJiAhdGhpcy53ZGEud2ViRHJpdmVyQWdlbnRVcmxcbiAgICAgICYmIGlzTG9jYWxIb3N0KHRoaXMud2RhLndkYUJhc2VVcmwpO1xuICAgIGF3YWl0IERFVklDRV9DT05ORUNUSU9OU19GQUNUT1JZLnJlcXVlc3RDb25uZWN0aW9uKHRoaXMub3B0cy51ZGlkLCB0aGlzLndkYS51cmwucG9ydCwge1xuICAgICAgZGV2aWNlUG9ydDogdXNlUG9ydEZvcndhcmRpbmcgPyB0aGlzLndkYS53ZGFSZW1vdGVQb3J0IDogbnVsbCxcbiAgICAgIHVzZVBvcnRGb3J3YXJkaW5nLFxuICAgIH0pO1xuXG4gICAgLy8gTGV0IG11bHRpcGxlIFdEQSBiaW5hcmllcyB3aXRoIGRpZmZlcmVudCBkZXJpdmVkIGRhdGEgZm9sZGVycyBiZSBidWlsdCBpbiBwYXJhbGxlbFxuICAgIC8vIENvbmN1cnJlbnQgV0RBIGJ1aWxkcyBmcm9tIHRoZSBzYW1lIHNvdXJjZSB3aWxsIGNhdXNlIHhjb2RlYnVpbGQgc3luY2hyb25pemF0aW9uIGVycm9yc1xuICAgIGxldCBzeW5jaHJvbml6YXRpb25LZXkgPSBYQ1VJVGVzdERyaXZlci5uYW1lO1xuICAgIGlmICh0aGlzLm9wdHMudXNlWGN0ZXN0cnVuRmlsZSB8fCAhKGF3YWl0IHRoaXMud2RhLmlzU291cmNlRnJlc2goKSkpIHtcbiAgICAgIC8vIEZpcnN0LXRpbWUgY29tcGlsYXRpb24gaXMgYW4gZXhwZW5zaXZlIG9wZXJhdGlvbiwgd2hpY2ggaXMgZG9uZSBmYXN0ZXIgaWYgZXhlY3V0ZWRcbiAgICAgIC8vIHNlcXVlbnRpYWxseS4gWGNvZGVidWlsZCBzcHJlYWRzIHRoZSBsb2FkIGNhdXNlZCBieSB0aGUgY2xhbmcgY29tcGlsZXIgdG8gYWxsIGF2YWlsYWJsZSBDUFUgY29yZXNcbiAgICAgIGNvbnN0IGRlcml2ZWREYXRhUGF0aCA9IGF3YWl0IHRoaXMud2RhLnJldHJpZXZlRGVyaXZlZERhdGFQYXRoKCk7XG4gICAgICBpZiAoZGVyaXZlZERhdGFQYXRoKSB7XG4gICAgICAgIHN5bmNocm9uaXphdGlvbktleSA9IHBhdGgubm9ybWFsaXplKGRlcml2ZWREYXRhUGF0aCk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMubG9nLmRlYnVnKGBTdGFydGluZyBXZWJEcml2ZXJBZ2VudCBpbml0aWFsaXphdGlvbiB3aXRoIHRoZSBzeW5jaHJvbml6YXRpb24ga2V5ICcke3N5bmNocm9uaXphdGlvbktleX0nYCk7XG4gICAgaWYgKFNIQVJFRF9SRVNPVVJDRVNfR1VBUkQuaXNCdXN5KCkgJiYgIXRoaXMub3B0cy5kZXJpdmVkRGF0YVBhdGggJiYgIXRoaXMub3B0cy5ib290c3RyYXBQYXRoKSB7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgQ29uc2lkZXIgc2V0dGluZyBhIHVuaXF1ZSAnZGVyaXZlZERhdGFQYXRoJyBjYXBhYmlsaXR5IHZhbHVlIGZvciBlYWNoIHBhcmFsbGVsIGRyaXZlciBpbnN0YW5jZSBgICtcbiAgICAgICAgYHRvIGF2b2lkIGNvbmZsaWN0cyBhbmQgc3BlZWQgdXAgdGhlIGJ1aWxkaW5nIHByb2Nlc3NgKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IFNIQVJFRF9SRVNPVVJDRVNfR1VBUkQuYWNxdWlyZShzeW5jaHJvbml6YXRpb25LZXksIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLm9wdHMudXNlTmV3V0RBKSB7XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKGBDYXBhYmlsaXR5ICd1c2VOZXdXREEnIHNldCB0byB0cnVlLCBzbyB1bmluc3RhbGxpbmcgV0RBIGJlZm9yZSBwcm9jZWVkaW5nYCk7XG4gICAgICAgIGF3YWl0IHRoaXMud2RhLnF1aXRBbmRVbmluc3RhbGwoKTtcbiAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhVW5pbnN0YWxsZWQnKTtcbiAgICAgIH0gZWxzZSBpZiAoIXV0aWwuaGFzVmFsdWUodGhpcy53ZGEud2ViRHJpdmVyQWdlbnRVcmwpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud2RhLnNldHVwQ2FjaGluZygpO1xuICAgICAgfVxuXG4gICAgICAvLyBsb2NhbCBoZWxwZXIgZm9yIHRoZSB0d28gcGxhY2VzIHdlIG5lZWQgdG8gdW5pbnN0YWxsIHdkYSBhbmQgcmUtc3RhcnQgaXRcbiAgICAgIGNvbnN0IHF1aXRBbmRVbmluc3RhbGwgPSBhc3luYyAobXNnKSA9PiB7XG4gICAgICAgIHRoaXMubG9nLmRlYnVnKG1zZyk7XG4gICAgICAgIGlmICh0aGlzLm9wdHMud2ViRHJpdmVyQWdlbnRVcmwpIHtcbiAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZygnTm90IHF1aXR0aW5nL3VuaW5zdGFsbGluZyBXZWJEcml2ZXJBZ2VudCBzaW5jZSB3ZWJEcml2ZXJBZ2VudFVybCBjYXBhYmlsaXR5IGlzIHByb3ZpZGVkJyk7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2cud2FybignUXVpdHRpbmcgYW5kIHVuaW5zdGFsbGluZyBXZWJEcml2ZXJBZ2VudCcpO1xuICAgICAgICBhd2FpdCB0aGlzLndkYS5xdWl0QW5kVW5pbnN0YWxsKCk7XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9O1xuXG4gICAgICAvLyBVc2VkIGluIHRoZSBmb2xsb3dpbmcgV0RBIGJ1aWxkXG4gICAgICBpZiAodGhpcy5vcHRzLnJlc3VsdEJ1bmRsZVBhdGgpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVGZWF0dXJlRW5hYmxlZChDVVNUT01JWkVfUkVTVUxUX0JVTkRQRV9QQVRIKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3RhcnR1cFJldHJpZXMgPSB0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJpZXMgfHwgKHRoaXMuaXNSZWFsRGV2aWNlKCkgPyBXREFfUkVBTF9ERVZfU1RBUlRVUF9SRVRSSUVTIDogV0RBX1NJTV9TVEFSVFVQX1JFVFJJRVMpO1xuICAgICAgY29uc3Qgc3RhcnR1cFJldHJ5SW50ZXJ2YWwgPSB0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJ5SW50ZXJ2YWwgfHwgV0RBX1NUQVJUVVBfUkVUUllfSU5URVJWQUw7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgVHJ5aW5nIHRvIHN0YXJ0IFdlYkRyaXZlckFnZW50ICR7c3RhcnR1cFJldHJpZXN9IHRpbWVzIHdpdGggJHtzdGFydHVwUmV0cnlJbnRlcnZhbH1tcyBpbnRlcnZhbGApO1xuICAgICAgaWYgKCF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy53ZGFTdGFydHVwUmV0cmllcykgJiYgIXV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLndkYVN0YXJ0dXBSZXRyeUludGVydmFsKSkge1xuICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgVGhlc2UgdmFsdWVzIGNhbiBiZSBjdXN0b21pemVkIGJ5IGNoYW5naW5nIHdkYVN0YXJ0dXBSZXRyaWVzL3dkYVN0YXJ0dXBSZXRyeUludGVydmFsIGNhcGFiaWxpdGllc2ApO1xuICAgICAgfVxuICAgICAgbGV0IHJldHJ5Q291bnQgPSAwO1xuICAgICAgYXdhaXQgcmV0cnlJbnRlcnZhbChzdGFydHVwUmV0cmllcywgc3RhcnR1cFJldHJ5SW50ZXJ2YWwsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhU3RhcnRBdHRlbXB0ZWQnKTtcbiAgICAgICAgaWYgKHJldHJ5Q291bnQgPiAwKSB7XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbyhgUmV0cnlpbmcgV0RBIHN0YXJ0dXAgKCR7cmV0cnlDb3VudCArIDF9IG9mICR7c3RhcnR1cFJldHJpZXN9KWApO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gb24geGNvZGUgMTAgaW5zdGFsbGQgd2lsbCBvZnRlbiB0cnkgdG8gYWNjZXNzIHRoZSBhcHAgZnJvbSBpdHMgc3RhZ2luZ1xuICAgICAgICAgIC8vIGRpcmVjdG9yeSBiZWZvcmUgZnVsbHkgbW92aW5nIGl0IHRoZXJlLCBhbmQgZmFpbC4gUmV0cnlpbmcgb25jZVxuICAgICAgICAgIC8vIGltbWVkaWF0ZWx5IGhlbHBzXG4gICAgICAgICAgY29uc3QgcmV0cmllcyA9IHRoaXMueGNvZGVWZXJzaW9uLm1ham9yID49IDEwID8gMiA6IDE7XG4gICAgICAgICAgdGhpcy5jYWNoZWRXZGFTdGF0dXMgPSBhd2FpdCByZXRyeShyZXRyaWVzLCB0aGlzLndkYS5sYXVuY2guYmluZCh0aGlzLndkYSksIHNlc3Npb25JZCwgcmVhbERldmljZSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVN0YXJ0RmFpbGVkJyk7XG4gICAgICAgICAgcmV0cnlDb3VudCsrO1xuICAgICAgICAgIGxldCBlcnJvck1zZyA9IGBVbmFibGUgdG8gbGF1bmNoIFdlYkRyaXZlckFnZW50IGJlY2F1c2Ugb2YgeGNvZGVidWlsZCBmYWlsdXJlOiAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgICAgICAgIGVycm9yTXNnICs9IGAuIE1ha2Ugc3VyZSB5b3UgZm9sbG93IHRoZSB0dXRvcmlhbCBhdCAke1dEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkx9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBUcnkgdG8gcmVtb3ZlIHRoZSBXZWJEcml2ZXJBZ2VudFJ1bm5lciBhcHBsaWNhdGlvbiBmcm9tIHRoZSBkZXZpY2UgaWYgaXQgaXMgaW5zdGFsbGVkIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYGFuZCByZWJvb3QgdGhlIGRldmljZS5gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBxdWl0QW5kVW5pbnN0YWxsKGVycm9yTXNnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucHJveHlSZXFSZXMgPSB0aGlzLndkYS5wcm94eVJlcVJlcy5iaW5kKHRoaXMud2RhKTtcbiAgICAgICAgdGhpcy5qd3BQcm94eUFjdGl2ZSA9IHRydWU7XG5cbiAgICAgICAgbGV0IG9yaWdpbmFsU3RhY2t0cmFjZSA9IG51bGw7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgcmV0cnlJbnRlcnZhbCgxNSwgMTAwMCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhU2Vzc2lvbkF0dGVtcHRlZCcpO1xuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcoJ1NlbmRpbmcgY3JlYXRlU2Vzc2lvbiBjb21tYW5kIHRvIFdEQScpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgdGhpcy5jYWNoZWRXZGFTdGF0dXMgPSB0aGlzLmNhY2hlZFdkYVN0YXR1cyB8fCBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3N0YXR1cycsICdHRVQnKTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zdGFydFdkYVNlc3Npb24odGhpcy5vcHRzLmJ1bmRsZUlkLCB0aGlzLm9wdHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgb3JpZ2luYWxTdGFja3RyYWNlID0gZXJyLnN0YWNrO1xuICAgICAgICAgICAgICB0aGlzLmxvZy5kZWJ1ZyhgRmFpbGVkIHRvIGNyZWF0ZSBXREEgc2Vzc2lvbiAoJHtlcnIubWVzc2FnZX0pLiBSZXRyeWluZy4uLmApO1xuICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhU2Vzc2lvblN0YXJ0ZWQnKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgaWYgKG9yaWdpbmFsU3RhY2t0cmFjZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuZGVidWcob3JpZ2luYWxTdGFja3RyYWNlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV0IGVycm9yTXNnID0gYFVuYWJsZSB0byBzdGFydCBXZWJEcml2ZXJBZ2VudCBzZXNzaW9uIGJlY2F1c2Ugb2YgeGNvZGVidWlsZCBmYWlsdXJlOiAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgICAgICAgIGVycm9yTXNnICs9IGAgTWFrZSBzdXJlIHlvdSBmb2xsb3cgdGhlIHR1dG9yaWFsIGF0ICR7V0RBX1JFQUxfREVWX1RVVE9SSUFMX1VSTH0uIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYFRyeSB0byByZW1vdmUgdGhlIFdlYkRyaXZlckFnZW50UnVubmVyIGFwcGxpY2F0aW9uIGZyb20gdGhlIGRldmljZSBpZiBpdCBpcyBpbnN0YWxsZWQgYCArXG4gICAgICAgICAgICAgICAgICAgICAgICBgYW5kIHJlYm9vdCB0aGUgZGV2aWNlLmA7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHF1aXRBbmRVbmluc3RhbGwoZXJyb3JNc2cpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMub3B0cy5jbGVhclN5c3RlbUZpbGVzICYmICF0aGlzLm9wdHMud2ViRHJpdmVyQWdlbnRVcmwpIHtcbiAgICAgICAgICBhd2FpdCBtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwKHRoaXMud2RhKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHdlIGV4cGVjdCBjZXJ0YWluIHNvY2tldCBlcnJvcnMgdW50aWwgdGhpcyBwb2ludCwgYnV0IG5vd1xuICAgICAgICAvLyBtYXJrIHRoaW5ncyBhcyBmdWxseSB3b3JraW5nXG4gICAgICAgIHRoaXMud2RhLmZ1bGx5U3RhcnRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVN0YXJ0ZWQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcnVuUmVzZXQgKG9wdHMgPSBudWxsKSB7XG4gICAgdGhpcy5sb2dFdmVudCgncmVzZXRTdGFydGVkJyk7XG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgIGF3YWl0IHJ1blJlYWxEZXZpY2VSZXNldCh0aGlzLm9wdHMuZGV2aWNlLCBvcHRzIHx8IHRoaXMub3B0cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHJ1blNpbXVsYXRvclJlc2V0KHRoaXMub3B0cy5kZXZpY2UsIG9wdHMgfHwgdGhpcy5vcHRzKTtcbiAgICB9XG4gICAgdGhpcy5sb2dFdmVudCgncmVzZXRDb21wbGV0ZScpO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlU2Vzc2lvbiAoKSB7XG4gICAgYXdhaXQgcmVtb3ZlQWxsU2Vzc2lvbldlYlNvY2tldEhhbmRsZXJzKHRoaXMuc2VydmVyLCB0aGlzLnNlc3Npb25JZCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZGVyIG9mIF8uY29tcGFjdChbXG4gICAgICB0aGlzLl9yZWNlbnRTY3JlZW5SZWNvcmRlciwgdGhpcy5fYXVkaW9SZWNvcmRlciwgdGhpcy5fdHJhZmZpY0NhcHR1cmVcbiAgICBdKSkge1xuICAgICAgYXdhaXQgcmVjb3JkZXIuaW50ZXJydXB0KHRydWUpO1xuICAgICAgYXdhaXQgcmVjb3JkZXIuY2xlYW51cCgpO1xuICAgIH1cblxuICAgIGlmICghXy5pc0VtcHR5KHRoaXMuX3BlcmZSZWNvcmRlcnMpKSB7XG4gICAgICBhd2FpdCBCLmFsbCh0aGlzLl9wZXJmUmVjb3JkZXJzLm1hcCgoeCkgPT4geC5zdG9wKHRydWUpKSk7XG4gICAgICB0aGlzLl9wZXJmUmVjb3JkZXJzID0gW107XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2NvbmRpdGlvbkluZHVjZXJTZXJ2aWNlKSB7XG4gICAgICB0aGlzLm1vYmlsZURpc2FibGVDb25kaXRpb25JbmR1Y2VyKCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zdG9wKCk7XG5cbiAgICBpZiAodGhpcy53ZGEgJiYgIXRoaXMub3B0cy53ZWJEcml2ZXJBZ2VudFVybCkge1xuICAgICAgaWYgKHRoaXMub3B0cy5jbGVhclN5c3RlbUZpbGVzKSB7XG4gICAgICAgIGxldCBzeW5jaHJvbml6YXRpb25LZXkgPSBYQ1VJVGVzdERyaXZlci5uYW1lO1xuICAgICAgICBjb25zdCBkZXJpdmVkRGF0YVBhdGggPSBhd2FpdCB0aGlzLndkYS5yZXRyaWV2ZURlcml2ZWREYXRhUGF0aCgpO1xuICAgICAgICBpZiAoZGVyaXZlZERhdGFQYXRoKSB7XG4gICAgICAgICAgc3luY2hyb25pemF0aW9uS2V5ID0gcGF0aC5ub3JtYWxpemUoZGVyaXZlZERhdGFQYXRoKTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBTSEFSRURfUkVTT1VSQ0VTX0dVQVJELmFjcXVpcmUoc3luY2hyb25pemF0aW9uS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgY2xlYXJTeXN0ZW1GaWxlcyh0aGlzLndkYSk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoJ05vdCBjbGVhcmluZyBsb2cgZmlsZXMuIFVzZSBgY2xlYXJTeXN0ZW1GaWxlc2AgY2FwYWJpbGl0eSB0byB0dXJuIG9uLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLnJlbW90ZSkge1xuICAgICAgdGhpcy5sb2cuZGVidWcoJ0ZvdW5kIGEgcmVtb3RlIGRlYnVnZ2VyIHNlc3Npb24uIFJlbW92aW5nLi4uJyk7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BSZW1vdGUoKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRzLnJlc2V0T25TZXNzaW9uU3RhcnRPbmx5ID09PSBmYWxzZSkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5SZXNldChPYmplY3QuYXNzaWduKHt9LCB0aGlzLm9wdHMsIHtcbiAgICAgICAgZW5mb3JjZVNpbXVsYXRvclNodXRkb3duOiB0cnVlLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmlzU2ltdWxhdG9yKCkgJiYgIXRoaXMub3B0cy5ub1Jlc2V0ICYmICEhdGhpcy5vcHRzLmRldmljZSkge1xuICAgICAgaWYgKHRoaXMubGlmZWN5Y2xlRGF0YS5jcmVhdGVTaW0pIHtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoYERlbGV0aW5nIHNpbXVsYXRvciBjcmVhdGVkIGZvciB0aGlzIHJ1biAodWRpZDogJyR7dGhpcy5vcHRzLnVkaWR9JylgKTtcbiAgICAgICAgYXdhaXQgc2h1dGRvd25TaW11bGF0b3IodGhpcy5vcHRzLmRldmljZSk7XG4gICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZGVsZXRlKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2hvdWxkUmVzZXRMb2NhdGlvblNlcnZpdmNlID0gdGhpcy5pc1JlYWxEZXZpY2UoKSAmJiAhIXRoaXMub3B0cy5yZXNldExvY2F0aW9uU2VydmljZTtcbiAgICBpZiAoc2hvdWxkUmVzZXRMb2NhdGlvblNlcnZpdmNlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLm1vYmlsZVJlc2V0TG9jYXRpb25TZXJ2aWNlKCk7XG4gICAgICB9IGNhdGNoIChpZ25vcmUpIHsgLyogSWdub3JlIHRoaXMgZXJyb3Igc2luY2UgbW9iaWxlUmVzZXRMb2NhdGlvblNlcnZpY2UgYWxyZWFkeSBsb2dnZWQgdGhlIGVycm9yICovIH1cbiAgICB9XG5cbiAgICBpZiAoIV8uaXNFbXB0eSh0aGlzLmxvZ3MpKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ3Muc3lzbG9nLnN0b3BDYXB0dXJlKCk7XG4gICAgICB0aGlzLmxvZ3MgPSB7fTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5tanBlZ1N0cmVhbSkge1xuICAgICAgdGhpcy5sb2cuaW5mbygnQ2xvc2luZyBNSlBFRyBzdHJlYW0nKTtcbiAgICAgIHRoaXMubWpwZWdTdHJlYW0uc3RvcCgpO1xuICAgIH1cblxuICAgIHRoaXMucmVzZXRJb3MoKTtcblxuICAgIGF3YWl0IHN1cGVyLmRlbGV0ZVNlc3Npb24oKTtcbiAgfVxuXG4gIGFzeW5jIHN0b3AgKCkge1xuICAgIHRoaXMuandwUHJveHlBY3RpdmUgPSBmYWxzZTtcbiAgICB0aGlzLnByb3h5UmVxUmVzID0gbnVsbDtcblxuXG4gICAgaWYgKHRoaXMud2RhICYmIHRoaXMud2RhLmZ1bGx5U3RhcnRlZCkge1xuICAgICAgaWYgKHRoaXMud2RhLmp3cHJveHkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZChgL3Nlc3Npb24vJHt0aGlzLnNlc3Npb25JZH1gLCAnREVMRVRFJyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIC8vIGFuIGVycm9yIGhlcmUgc2hvdWxkIG5vdCBzaG9ydC1jaXJjdWl0IHRoZSByZXN0IG9mIGNsZWFuIHVwXG4gICAgICAgICAgdGhpcy5sb2cuZGVidWcoYFVuYWJsZSB0byBERUxFVEUgc2Vzc2lvbiBvbiBXREE6ICcke2Vyci5tZXNzYWdlfScuIENvbnRpbnVpbmcgc2h1dGRvd24uYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghdGhpcy53ZGEud2ViRHJpdmVyQWdlbnRVcmwgJiYgdGhpcy5vcHRzLnVzZU5ld1dEQSkge1xuICAgICAgICBhd2FpdCB0aGlzLndkYS5xdWl0KCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgREVWSUNFX0NPTk5FQ1RJT05TX0ZBQ1RPUlkucmVsZWFzZUNvbm5lY3Rpb24odGhpcy5vcHRzLnVkaWQpO1xuICB9XG5cbiAgYXN5bmMgZXhlY3V0ZUNvbW1hbmQgKGNtZCwgLi4uYXJncykge1xuICAgIHRoaXMubG9nLmRlYnVnKGBFeGVjdXRpbmcgY29tbWFuZCAnJHtjbWR9J2ApO1xuXG4gICAgaWYgKGNtZCA9PT0gJ3JlY2VpdmVBc3luY1Jlc3BvbnNlJykge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVjZWl2ZUFzeW5jUmVzcG9uc2UoLi4uYXJncyk7XG4gICAgfVxuICAgIC8vIFRPRE86IG9uY2UgdGhpcyBmaXggZ2V0cyBpbnRvIGJhc2UgZHJpdmVyIHJlbW92ZSBmcm9tIGhlcmVcbiAgICBpZiAoY21kID09PSAnZ2V0U3RhdHVzJykge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0U3RhdHVzKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBzdXBlci5leGVjdXRlQ29tbWFuZChjbWQsIC4uLmFyZ3MpO1xuICB9XG5cbiAgYXN5bmMgY29uZmlndXJlQXBwICgpIHtcbiAgICBmdW5jdGlvbiBhcHBJc1BhY2thZ2VPckJ1bmRsZSAoYXBwKSB7XG4gICAgICByZXR1cm4gKC9eKFthLXpBLVowLTlcXC1fXStcXC5bYS16QS1aMC05XFwtX10rKSskLykudGVzdChhcHApO1xuICAgIH1cblxuICAgIC8vIHRoZSBhcHAgbmFtZSBpcyBhIGJ1bmRsZUlkIGFzc2lnbiBpdCB0byB0aGUgYnVuZGxlSWQgcHJvcGVydHlcbiAgICBpZiAoIXRoaXMub3B0cy5idW5kbGVJZCAmJiBhcHBJc1BhY2thZ2VPckJ1bmRsZSh0aGlzLm9wdHMuYXBwKSkge1xuICAgICAgdGhpcy5vcHRzLmJ1bmRsZUlkID0gdGhpcy5vcHRzLmFwcDtcbiAgICAgIHRoaXMub3B0cy5hcHAgPSAnJztcbiAgICB9XG4gICAgLy8gd2UgaGF2ZSBhIGJ1bmRsZSBJRCwgYnV0IG5vIGFwcCwgb3IgYXBwIGlzIGFsc28gYSBidW5kbGVcbiAgICBpZiAoKHRoaXMub3B0cy5idW5kbGVJZCAmJiBhcHBJc1BhY2thZ2VPckJ1bmRsZSh0aGlzLm9wdHMuYnVuZGxlSWQpKSAmJlxuICAgICAgICAodGhpcy5vcHRzLmFwcCA9PT0gJycgfHwgYXBwSXNQYWNrYWdlT3JCdW5kbGUodGhpcy5vcHRzLmFwcCkpKSB7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZygnQXBwIGlzIGFuIGlPUyBidW5kbGUsIHdpbGwgYXR0ZW1wdCB0byBydW4gYXMgcHJlLWV4aXN0aW5nJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gY2hlY2sgZm9yIHN1cHBvcnRlZCBidWlsZC1pbiBhcHBzXG4gICAgc3dpdGNoIChfLnRvTG93ZXIodGhpcy5vcHRzLmFwcCkpIHtcbiAgICAgIGNhc2UgJ3NldHRpbmdzJzpcbiAgICAgICAgdGhpcy5vcHRzLmJ1bmRsZUlkID0gJ2NvbS5hcHBsZS5QcmVmZXJlbmNlcyc7XG4gICAgICAgIHRoaXMub3B0cy5hcHAgPSBudWxsO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdjYWxlbmRhcic6XG4gICAgICAgIHRoaXMub3B0cy5idW5kbGVJZCA9ICdjb20uYXBwbGUubW9iaWxlY2FsJztcbiAgICAgICAgdGhpcy5vcHRzLmFwcCA9IG51bGw7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLm9wdHMuYXBwID0gYXdhaXQgdGhpcy5oZWxwZXJzLmNvbmZpZ3VyZUFwcCh0aGlzLm9wdHMuYXBwLCB7XG4gICAgICBvblBvc3RQcm9jZXNzOiB0aGlzLm9uUG9zdENvbmZpZ3VyZUFwcC5iaW5kKHRoaXMpLFxuICAgICAgc3VwcG9ydGVkRXh0ZW5zaW9uczogU1VQUE9SVEVEX0VYVEVOU0lPTlNcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVbnppcCB0aGUgZ2l2ZW4gYXJjaGl2ZSBhbmQgZmluZCBhIG1hdGNoaW5nIC5hcHAgYnVuZGxlIGluIGl0XG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcHBQYXRoIFRoZSBwYXRoIHRvIHRoZSBhcmNoaXZlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gZGVwdGggWzBdIHRoZSBjdXJyZW50IG5lc3RpbmcgZGVwdGguIEFwcCBidW5kbGVzIHdob3NlIG5lc3RpbmcgbGV2ZWxcbiAgICogaXMgZ3JlYXRlciB0aGFuIDEgYXJlIG5vdCBzdXBwb3J0ZWQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgZmlyc3QgbWF0Y2hpbmcgLmFwcCBidW5kbGUuLlxuICAgKiBAdGhyb3dzIElmIG5vIG1hdGNoaW5nIC5hcHAgYnVuZGxlcyB3ZXJlIGZvdW5kIGluIHRoZSBwcm92aWRlZCBhcmNoaXZlLlxuICAgKi9cbiAgYXN5bmMgdW56aXBBcHAgKGFwcFBhdGgsIGRlcHRoID0gMCkge1xuICAgIGlmIChkZXB0aCA+IE1BWF9BUkNISVZFX1NDQU5fREVQVEgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTmVzdGluZyBvZiBwYWNrYWdlIGJ1bmRsZXMgaXMgbm90IHN1cHBvcnRlZCcpO1xuICAgIH1cbiAgICBjb25zdCBbcm9vdERpciwgbWF0Y2hlZFBhdGhzXSA9IGF3YWl0IGZpbmRBcHBzKGFwcFBhdGgsIFNVUFBPUlRFRF9FWFRFTlNJT05TKTtcbiAgICBpZiAoXy5pc0VtcHR5KG1hdGNoZWRQYXRocykpIHtcbiAgICAgIHRoaXMubG9nLmRlYnVnKGAnJHtwYXRoLmJhc2VuYW1lKGFwcFBhdGgpfScgaGFzIG5vIGJ1bmRsZXNgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cuZGVidWcoXG4gICAgICAgIGBGb3VuZCAke3V0aWwucGx1cmFsaXplKCdidW5kbGUnLCBtYXRjaGVkUGF0aHMubGVuZ3RoLCB0cnVlKX0gaW4gYCArXG4gICAgICAgIGAnJHtwYXRoLmJhc2VuYW1lKGFwcFBhdGgpfSc6ICR7bWF0Y2hlZFBhdGhzfWBcbiAgICAgICk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZWRQYXRoIG9mIG1hdGNoZWRQYXRocykge1xuICAgICAgICBjb25zdCBmdWxsUGF0aCA9IHBhdGguam9pbihyb290RGlyLCBtYXRjaGVkUGF0aCk7XG4gICAgICAgIGlmIChhd2FpdCBpc0FwcEJ1bmRsZShmdWxsUGF0aCkpIHtcbiAgICAgICAgICBjb25zdCBzdXBwb3J0ZWRQbGF0Zm9ybXMgPSBhd2FpdCBmZXRjaFN1cHBvcnRlZEFwcFBsYXRmb3JtcyhmdWxsUGF0aCk7XG4gICAgICAgICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSAmJiAhc3VwcG9ydGVkUGxhdGZvcm1zLnNvbWUoKHApID0+IF8uaW5jbHVkZXMocCwgJ1NpbXVsYXRvcicpKSkge1xuICAgICAgICAgICAgdGhpcy5sb2cuaW5mbyhgJyR7bWF0Y2hlZFBhdGh9JyBkb2VzIG5vdCBoYXZlIFNpbXVsYXRvciBkZXZpY2VzIGluIHRoZSBsaXN0IG9mIHN1cHBvcnRlZCBwbGF0Zm9ybXMgYCArXG4gICAgICAgICAgICAgIGAoJHtzdXBwb3J0ZWRQbGF0Zm9ybXMuam9pbignLCcpfSkuIFNraXBwaW5nIGl0YCk7O1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLmlzUmVhbERldmljZSgpICYmICFzdXBwb3J0ZWRQbGF0Zm9ybXMuc29tZSgocCkgPT4gXy5pbmNsdWRlcyhwLCAnT1MnKSkpIHtcbiAgICAgICAgICAgIHRoaXMubG9nLmluZm8oYCcke21hdGNoZWRQYXRofScgZG9lcyBub3QgaGF2ZSByZWFsIGRldmljZXMgaW4gdGhlIGxpc3Qgb2Ygc3VwcG9ydGVkIHBsYXRmb3JtcyBgICtcbiAgICAgICAgICAgICAgYCgke3N1cHBvcnRlZFBsYXRmb3Jtcy5qb2luKCcsJyl9KS4gU2tpcHBpbmcgaXRgKTs7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5sb2cuaW5mbyhgJyR7bWF0Y2hlZFBhdGh9JyBpcyB0aGUgcmVzdWx0aW5nIGFwcGxpY2F0aW9uIGJ1bmRsZSBzZWxlY3RlZCBmcm9tICcke2FwcFBhdGh9J2ApO1xuICAgICAgICAgIHJldHVybiBhd2FpdCBpc29sYXRlQXBwQnVuZGxlKGZ1bGxQYXRoKTtcbiAgICAgICAgfSBlbHNlIGlmIChfLmVuZHNXaXRoKF8udG9Mb3dlcihmdWxsUGF0aCksIElQQV9FWFQpICYmIChhd2FpdCBmcy5zdGF0KGZ1bGxQYXRoKSkuaXNGaWxlKCkpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudW56aXBBcHAoZnVsbFBhdGgsIGRlcHRoICsgMSk7XG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5sb2cud2FybihgU2tpcHBpbmcgcHJvY2Vzc2luZyBvZiAnJHttYXRjaGVkUGF0aH0nOiAke2UubWVzc2FnZX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgZnMucmltcmFmKHJvb3REaXIpO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5vcHRzLmFwcH0gZGlkIG5vdCBoYXZlIGFueSBtYXRjaGluZyAke0FQUF9FWFR9IG9yICR7SVBBX0VYVH0gYCArXG4gICAgICBgYnVuZGxlcy4gUGxlYXNlIG1ha2Ugc3VyZSB0aGUgcHJvdmlkZWQgcGFja2FnZSBpcyB2YWxpZCBhbmQgY29udGFpbnMgYXQgbGVhc3Qgb25lIG1hdGNoaW5nIGAgK1xuICAgICAgYGFwcGxpY2F0aW9uIGJ1bmRsZSB3aGljaCBpcyBub3QgbmVzdGVkLmBcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgb25Qb3N0Q29uZmlndXJlQXBwICh7Y2FjaGVkQXBwSW5mbywgaXNVcmwsIGFwcFBhdGh9KSB7XG4gICAgLy8gUGljayB0aGUgcHJldmlvdXNseSBjYWNoZWQgZW50cnkgaWYgaXRzIGludGVncml0eSBoYXMgYmVlbiBwcmVzZXJ2ZWRcbiAgICBpZiAoXy5pc1BsYWluT2JqZWN0KGNhY2hlZEFwcEluZm8pXG4gICAgICAgICYmIChhd2FpdCBmcy5zdGF0KGFwcFBhdGgpKS5pc0ZpbGUoKVxuICAgICAgICAmJiBhd2FpdCBmcy5oYXNoKGFwcFBhdGgpID09PSBjYWNoZWRBcHBJbmZvLnBhY2thZ2VIYXNoXG4gICAgICAgICYmIGF3YWl0IGZzLmV4aXN0cyhjYWNoZWRBcHBJbmZvLmZ1bGxQYXRoKVxuICAgICAgICAmJiAoYXdhaXQgZnMuZ2xvYignKiovKicsIHtcbiAgICAgICAgICBjd2Q6IGNhY2hlZEFwcEluZm8uZnVsbFBhdGgsIHN0cmljdDogZmFsc2UsIG5vc29ydDogdHJ1ZVxuICAgICAgICB9KSkubGVuZ3RoID09PSBjYWNoZWRBcHBJbmZvLmludGVncml0eS5mb2xkZXIpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oYFVzaW5nICcke2NhY2hlZEFwcEluZm8uZnVsbFBhdGh9JyB3aGljaCB3YXMgY2FjaGVkIGZyb20gJyR7YXBwUGF0aH0nYCk7XG4gICAgICByZXR1cm4ge2FwcFBhdGg6IGNhY2hlZEFwcEluZm8uZnVsbFBhdGh9O1xuICAgIH1cblxuICAgIC8vIE9ubHkgbG9jYWwgLmFwcCBidW5kbGVzIHRoYXQgYXJlIGF2YWlsYWJsZSBpbi1wbGFjZSBzaG91bGQgbm90IGJlIGNhY2hlZFxuICAgIGlmIChhd2FpdCBpc0FwcEJ1bmRsZShhcHBQYXRoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEV4dHJhY3QgdGhlIGFwcCBidW5kbGUgYW5kIGNhY2hlIGl0XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB7YXBwUGF0aDogYXdhaXQgdGhpcy51bnppcEFwcChhcHBQYXRoKX07XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIENsZWFudXAgcHJldmlvdXNseSBkb3dubG9hZGVkIGFyY2hpdmVcbiAgICAgIGlmIChpc1VybCkge1xuICAgICAgICBhd2FpdCBmcy5yaW1yYWYoYXBwUGF0aCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGV0ZXJtaW5lRGV2aWNlICgpIHtcbiAgICAvLyBpbiB0aGUgb25lIGNhc2Ugd2hlcmUgd2UgY3JlYXRlIGEgc2ltLCB3ZSB3aWxsIHNldCB0aGlzIHN0YXRlXG4gICAgdGhpcy5saWZlY3ljbGVEYXRhLmNyZWF0ZVNpbSA9IGZhbHNlO1xuXG4gICAgLy8gaWYgd2UgZ2V0IGdlbmVyaWMgbmFtZXMsIHRyYW5zbGF0ZSB0aGVtXG4gICAgdGhpcy5vcHRzLmRldmljZU5hbWUgPSB0cmFuc2xhdGVEZXZpY2VOYW1lKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24sIHRoaXMub3B0cy5kZXZpY2VOYW1lKTtcblxuICAgIGNvbnN0IHNldHVwVmVyc2lvbkNhcHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLm9wdHMuaW9zU2RrVmVyc2lvbiA9IGF3YWl0IGdldEFuZENoZWNrSW9zU2RrVmVyc2lvbigpO1xuICAgICAgdGhpcy5sb2cuaW5mbyhgaU9TIFNESyBWZXJzaW9uIHNldCB0byAnJHt0aGlzLm9wdHMuaW9zU2RrVmVyc2lvbn0nYCk7XG4gICAgICBpZiAoIXRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gJiYgdGhpcy5vcHRzLmlvc1Nka1ZlcnNpb24pIHtcbiAgICAgICAgdGhpcy5sb2cuaW5mbyhgTm8gcGxhdGZvcm1WZXJzaW9uIHNwZWNpZmllZC4gVXNpbmcgdGhlIGxhdGVzdCB2ZXJzaW9uIFhjb2RlIHN1cHBvcnRzOiAnJHt0aGlzLm9wdHMuaW9zU2RrVmVyc2lvbn0nLiBgICtcbiAgICAgICAgICBgVGhpcyBtYXkgY2F1c2UgcHJvYmxlbXMgaWYgYSBzaW11bGF0b3IgZG9lcyBub3QgZXhpc3QgZm9yIHRoaXMgcGxhdGZvcm0gdmVyc2lvbi5gKTtcbiAgICAgICAgdGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiA9IG5vcm1hbGl6ZVBsYXRmb3JtVmVyc2lvbih0aGlzLm9wdHMuaW9zU2RrVmVyc2lvbik7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGlmICh0aGlzLm9wdHMudWRpZCkge1xuICAgICAgaWYgKHRoaXMub3B0cy51ZGlkLnRvTG93ZXJDYXNlKCkgPT09ICdhdXRvJykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMub3B0cy51ZGlkID0gYXdhaXQgZGV0ZWN0VWRpZCgpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAvLyBUcnlpbmcgdG8gZmluZCBtYXRjaGluZyBVRElEIGZvciBTaW11bGF0b3JcbiAgICAgICAgICB0aGlzLmxvZy53YXJuKGBDYW5ub3QgZGV0ZWN0IGFueSBjb25uZWN0ZWQgcmVhbCBkZXZpY2VzLiBGYWxsaW5nIGJhY2sgdG8gU2ltdWxhdG9yLiBPcmlnaW5hbCBlcnJvcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgICBjb25zdCBkZXZpY2UgPSBhd2FpdCBnZXRFeGlzdGluZ1NpbSh0aGlzLm9wdHMpO1xuICAgICAgICAgIGlmICghZGV2aWNlKSB7XG4gICAgICAgICAgICAvLyBObyBtYXRjaGluZyBTaW11bGF0b3IgaXMgZm91bmQuIFRocm93IGFuIGVycm9yXG4gICAgICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGBDYW5ub3QgZGV0ZWN0IHVkaWQgZm9yICR7dGhpcy5vcHRzLmRldmljZU5hbWV9IFNpbXVsYXRvciBydW5uaW5nIGlPUyAke3RoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb259YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gTWF0Y2hpbmcgU2ltdWxhdG9yIGV4aXN0cyBhbmQgaXMgZm91bmQuIFVzZSBpdFxuICAgICAgICAgIHRoaXMub3B0cy51ZGlkID0gZGV2aWNlLnVkaWQ7XG4gICAgICAgICAgY29uc3QgZGV2aWNlUGxhdGZvcm0gPSBub3JtYWxpemVQbGF0Zm9ybVZlcnNpb24oYXdhaXQgZGV2aWNlLmdldFBsYXRmb3JtVmVyc2lvbigpKTtcbiAgICAgICAgICBpZiAodGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiAhPT0gZGV2aWNlUGxhdGZvcm0pIHtcbiAgICAgICAgICAgIHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gPSBkZXZpY2VQbGF0Zm9ybTtcbiAgICAgICAgICAgIHRoaXMubG9nLmluZm8oYFNldCBwbGF0Zm9ybVZlcnNpb24gdG8gJyR7ZGV2aWNlUGxhdGZvcm19JyB0byBtYXRjaCB0aGUgZGV2aWNlIHdpdGggZ2l2ZW4gVURJRGApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBzZXR1cFZlcnNpb25DYXBzKCk7XG4gICAgICAgICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IGZhbHNlLCB1ZGlkOiBkZXZpY2UudWRpZH07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG1ha2Ugc3VyZSBpdCBpcyBhIGNvbm5lY3RlZCBkZXZpY2UuIElmIG5vdCwgdGhlIHVkaWQgcGFzc2VkIGluIGlzIGludmFsaWRcbiAgICAgICAgY29uc3QgZGV2aWNlcyA9IGF3YWl0IGdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgICAgdGhpcy5sb2cuZGVidWcoYEF2YWlsYWJsZSBkZXZpY2VzOiAke2RldmljZXMuam9pbignLCAnKX1gKTtcbiAgICAgICAgaWYgKCFkZXZpY2VzLmluY2x1ZGVzKHRoaXMub3B0cy51ZGlkKSkge1xuICAgICAgICAgIC8vIGNoZWNrIGZvciBhIHBhcnRpY3VsYXIgc2ltdWxhdG9yXG4gICAgICAgICAgdGhpcy5sb2cuZGVidWcoYE5vIHJlYWwgZGV2aWNlIHdpdGggdWRpZCAnJHt0aGlzLm9wdHMudWRpZH0nLiBMb29raW5nIGZvciBzaW11bGF0b3JgKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0U2ltdWxhdG9yKHRoaXMub3B0cy51ZGlkLCB7XG4gICAgICAgICAgICAgIGRldmljZXNTZXRQYXRoOiB0aGlzLm9wdHMuc2ltdWxhdG9yRGV2aWNlc1NldFBhdGgsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB7ZGV2aWNlLCByZWFsRGV2aWNlOiBmYWxzZSwgdWRpZDogdGhpcy5vcHRzLnVkaWR9O1xuICAgICAgICAgIH0gY2F0Y2ggKGlnbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRldmljZSBvciBzaW11bGF0b3IgVURJRDogJyR7dGhpcy5vcHRzLnVkaWR9J2ApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZXZpY2UgPSBhd2FpdCBnZXRSZWFsRGV2aWNlT2JqKHRoaXMub3B0cy51ZGlkKTtcbiAgICAgIHJldHVybiB7ZGV2aWNlLCByZWFsRGV2aWNlOiB0cnVlLCB1ZGlkOiB0aGlzLm9wdHMudWRpZH07XG4gICAgfVxuXG4gICAgLy8gTm93IHdlIGtub3cgZm9yIHN1cmUgdGhlIGRldmljZSB3aWxsIGJlIGEgU2ltdWxhdG9yXG4gICAgYXdhaXQgc2V0dXBWZXJzaW9uQ2FwcygpO1xuICAgIGlmICh0aGlzLm9wdHMuZW5mb3JjZUZyZXNoU2ltdWxhdG9yQ3JlYXRpb24pIHtcbiAgICAgIHRoaXMubG9nLmRlYnVnKGBOZXcgc2ltdWxhdG9yIGlzIHJlcXVlc3RlZC4gSWYgdGhpcyBpcyBub3Qgd2FudGVkLCBzZXQgJ2VuZm9yY2VGcmVzaFNpbXVsYXRvckNyZWF0aW9uJyBjYXBhYmlsaXR5IHRvIGZhbHNlYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGZpZ3VyZSBvdXQgdGhlIGNvcnJlY3Qgc2ltdWxhdG9yIHRvIHVzZSwgZ2l2ZW4gdGhlIGRlc2lyZWQgY2FwYWJpbGl0aWVzXG4gICAgICBjb25zdCBkZXZpY2UgPSBhd2FpdCBnZXRFeGlzdGluZ1NpbSh0aGlzLm9wdHMpO1xuXG4gICAgICAvLyBjaGVjayBmb3IgYW4gZXhpc3Rpbmcgc2ltdWxhdG9yXG4gICAgICBpZiAoZGV2aWNlKSB7XG4gICAgICAgIHJldHVybiB7ZGV2aWNlLCByZWFsRGV2aWNlOiBmYWxzZSwgdWRpZDogZGV2aWNlLnVkaWR9O1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxvZy5pbmZvKCdTaW11bGF0b3IgdWRpZCBub3QgcHJvdmlkZWQnKTtcbiAgICB9XG5cbiAgICAvLyBubyBkZXZpY2Ugb2YgdGhpcyB0eXBlIGV4aXN0cywgb3IgdGhleSByZXF1ZXN0IG5ldyBzaW0sIHNvIGNyZWF0ZSBvbmVcbiAgICB0aGlzLmxvZy5pbmZvKCdVc2luZyBkZXNpcmVkIGNhcHMgdG8gY3JlYXRlIGEgbmV3IHNpbXVsYXRvcicpO1xuICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IHRoaXMuY3JlYXRlU2ltKCk7XG4gICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IGZhbHNlLCB1ZGlkOiBkZXZpY2UudWRpZH07XG4gIH1cblxuICBhc3luYyBzdGFydFNpbSAoKSB7XG4gICAgY29uc3QgcnVuT3B0cyA9IHtcbiAgICAgIHNjYWxlRmFjdG9yOiB0aGlzLm9wdHMuc2NhbGVGYWN0b3IsXG4gICAgICBjb25uZWN0SGFyZHdhcmVLZXlib2FyZDogISF0aGlzLm9wdHMuY29ubmVjdEhhcmR3YXJlS2V5Ym9hcmQsXG4gICAgICBwYXN0ZWJvYXJkQXV0b21hdGljU3luYzogdGhpcy5vcHRzLnNpbXVsYXRvclBhc3RlYm9hcmRBdXRvbWF0aWNTeW5jID8/ICdvZmYnLFxuICAgICAgaXNIZWFkbGVzczogISF0aGlzLm9wdHMuaXNIZWFkbGVzcyxcbiAgICAgIHRyYWNlUG9pbnRlcjogdGhpcy5vcHRzLnNpbXVsYXRvclRyYWNlUG9pbnRlcixcbiAgICAgIGRldmljZVByZWZlcmVuY2VzOiB7fSxcbiAgICB9O1xuXG4gICAgLy8gYWRkIHRoZSB3aW5kb3cgY2VudGVyLCBpZiBpdCBpcyBzcGVjaWZpZWRcbiAgICBpZiAodGhpcy5vcHRzLlNpbXVsYXRvcldpbmRvd0NlbnRlcikge1xuICAgICAgcnVuT3B0cy5kZXZpY2VQcmVmZXJlbmNlcy5TaW11bGF0b3JXaW5kb3dDZW50ZXIgPSB0aGlzLm9wdHMuU2ltdWxhdG9yV2luZG93Q2VudGVyO1xuICAgIH1cblxuICAgIGlmIChfLmlzSW50ZWdlcih0aGlzLm9wdHMuc2ltdWxhdG9yU3RhcnR1cFRpbWVvdXQpKSB7XG4gICAgICBydW5PcHRzLnN0YXJ0dXBUaW1lb3V0ID0gdGhpcy5vcHRzLnNpbXVsYXRvclN0YXJ0dXBUaW1lb3V0O1xuICAgIH1cblxuICAgIC8vIFRoaXMgaXMgdG8gd29ya2Fyb3VuZCBYQ1Rlc3QgYnVnIGFib3V0IGNoYW5naW5nIFNpbXVsYXRvclxuICAgIC8vIG9yaWVudGF0aW9uIGlzIG5vdCBzeW5jaHJvbml6ZWQgdG8gdGhlIGFjdHVhbCB3aW5kb3cgb3JpZW50YXRpb25cbiAgICBjb25zdCBvcmllbnRhdGlvbiA9IF8uaXNTdHJpbmcodGhpcy5vcHRzLm9yaWVudGF0aW9uKSAmJiB0aGlzLm9wdHMub3JpZW50YXRpb24udG9VcHBlckNhc2UoKTtcbiAgICBzd2l0Y2ggKG9yaWVudGF0aW9uKSB7XG4gICAgICBjYXNlICdMQU5EU0NBUEUnOlxuICAgICAgICBydW5PcHRzLmRldmljZVByZWZlcmVuY2VzLlNpbXVsYXRvcldpbmRvd09yaWVudGF0aW9uID0gJ0xhbmRzY2FwZUxlZnQnO1xuICAgICAgICBydW5PcHRzLmRldmljZVByZWZlcmVuY2VzLlNpbXVsYXRvcldpbmRvd1JvdGF0aW9uQW5nbGUgPSA5MDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdQT1JUUkFJVCc6XG4gICAgICAgIHJ1bk9wdHMuZGV2aWNlUHJlZmVyZW5jZXMuU2ltdWxhdG9yV2luZG93T3JpZW50YXRpb24gPSAnUG9ydHJhaXQnO1xuICAgICAgICBydW5PcHRzLmRldmljZVByZWZlcmVuY2VzLlNpbXVsYXRvcldpbmRvd1JvdGF0aW9uQW5nbGUgPSAwO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLnJ1bihydW5PcHRzKTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVNpbSAoKSB7XG4gICAgdGhpcy5saWZlY3ljbGVEYXRhLmNyZWF0ZVNpbSA9IHRydWU7XG5cbiAgICAvLyBHZXQgcGxhdGZvcm0gbmFtZSBmcm9tIGNvbnN0IHNpbmNlIGl0IG11c3QgYmUgY2FzZSBzZW5zaXRpdmUgdG8gY3JlYXRlIGEgbmV3IHNpbXVsYXRvclxuICAgIGNvbnN0IHBsYXRmb3JtTmFtZSA9IHRoaXMuaXNUdk9TKCkgPyBQTEFURk9STV9OQU1FX1RWT1MgOiBQTEFURk9STV9OQU1FX0lPUztcblxuICAgIC8vIGNyZWF0ZSBzaW0gZm9yIGNhcHNcbiAgICBjb25zdCBzaW0gPSBhd2FpdCBjcmVhdGVTaW0odGhpcy5vcHRzLCBwbGF0Zm9ybU5hbWUpO1xuICAgIHRoaXMubG9nLmluZm8oYENyZWF0ZWQgc2ltdWxhdG9yIHdpdGggdWRpZCAnJHtzaW0udWRpZH0nLmApO1xuXG4gICAgcmV0dXJuIHNpbTtcbiAgfVxuXG4gIGFzeW5jIGxhdW5jaEFwcCAoKSB7XG4gICAgY29uc3QgQVBQX0xBVU5DSF9USU1FT1VUID0gMjAgKiAxMDAwO1xuXG4gICAgdGhpcy5sb2dFdmVudCgnYXBwTGF1bmNoQXR0ZW1wdGVkJyk7XG4gICAgYXdhaXQgdGhpcy5vcHRzLmRldmljZS5zaW1jdGwubGF1bmNoQXBwKHRoaXMub3B0cy5idW5kbGVJZCk7XG5cbiAgICBsZXQgY2hlY2tTdGF0dXMgPSBhc3luYyAoKSA9PiB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3N0YXR1cycsICdHRVQnKTtcbiAgICAgIGxldCBjdXJyZW50QXBwID0gcmVzcG9uc2UuY3VycmVudEFwcC5idW5kbGVJRDtcbiAgICAgIGlmIChjdXJyZW50QXBwICE9PSB0aGlzLm9wdHMuYnVuZGxlSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMub3B0cy5idW5kbGVJZH0gbm90IGluIGZvcmVncm91bmQuICR7Y3VycmVudEFwcH0gaXMgaW4gZm9yZWdyb3VuZGApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICB0aGlzLmxvZy5pbmZvKGBXYWl0aW5nIGZvciAnJHt0aGlzLm9wdHMuYnVuZGxlSWR9JyB0byBiZSBpbiBmb3JlZ3JvdW5kYCk7XG4gICAgbGV0IHJldHJpZXMgPSBwYXJzZUludChBUFBfTEFVTkNIX1RJTUVPVVQgLyAyMDAsIDEwKTtcbiAgICBhd2FpdCByZXRyeUludGVydmFsKHJldHJpZXMsIDIwMCwgY2hlY2tTdGF0dXMpO1xuICAgIHRoaXMubG9nLmluZm8oYCR7dGhpcy5vcHRzLmJ1bmRsZUlkfSBpcyBpbiBmb3JlZ3JvdW5kYCk7XG4gICAgdGhpcy5sb2dFdmVudCgnYXBwTGF1bmNoZWQnKTtcbiAgfVxuXG4gIGFzeW5jIHN0YXJ0V2RhU2Vzc2lvbiAoYnVuZGxlSWQsIHByb2Nlc3NBcmd1bWVudHMpIHtcbiAgICBjb25zdCBhcmdzID0gcHJvY2Vzc0FyZ3VtZW50cyA/IChwcm9jZXNzQXJndW1lbnRzLmFyZ3MgfHwgW10pIDogW107XG4gICAgaWYgKCFfLmlzQXJyYXkoYXJncykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcHJvY2Vzc0FyZ3VtZW50cy5hcmdzIGNhcGFiaWxpdHkgaXMgZXhwZWN0ZWQgdG8gYmUgYW4gYXJyYXkuIGAgK1xuICAgICAgICBgJHtKU09OLnN0cmluZ2lmeShhcmdzKX0gaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgIH1cbiAgICBjb25zdCBlbnYgPSBwcm9jZXNzQXJndW1lbnRzID8gKHByb2Nlc3NBcmd1bWVudHMuZW52IHx8IHt9KSA6IHt9O1xuICAgIGlmICghXy5pc1BsYWluT2JqZWN0KGVudikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcHJvY2Vzc0FyZ3VtZW50cy5lbnYgY2FwYWJpbGl0eSBpcyBleHBlY3RlZCB0byBiZSBhIGRpY3Rpb25hcnkuIGAgK1xuICAgICAgICBgJHtKU09OLnN0cmluZ2lmeShlbnYpfSBpcyBnaXZlbiBpbnN0ZWFkYCk7XG4gICAgfVxuXG4gICAgaWYgKHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLmxhbmd1YWdlKSkge1xuICAgICAgYXJncy5wdXNoKCctQXBwbGVMYW5ndWFnZXMnLCBgKCR7dGhpcy5vcHRzLmxhbmd1YWdlfSlgKTtcbiAgICAgIGFyZ3MucHVzaCgnLU5TTGFuZ3VhZ2VzJywgYCgke3RoaXMub3B0cy5sYW5ndWFnZX0pYCk7XG4gICAgfVxuICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5sb2NhbGUpKSB7XG4gICAgICBhcmdzLnB1c2goJy1BcHBsZUxvY2FsZScsIHRoaXMub3B0cy5sb2NhbGUpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMubm9SZXNldCkge1xuICAgICAgaWYgKF8uaXNOaWwodGhpcy5vcHRzLnNob3VsZFRlcm1pbmF0ZUFwcCkpIHtcbiAgICAgICAgdGhpcy5vcHRzLnNob3VsZFRlcm1pbmF0ZUFwcCA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKF8uaXNOaWwodGhpcy5vcHRzLmZvcmNlQXBwTGF1bmNoKSkge1xuICAgICAgICB0aGlzLm9wdHMuZm9yY2VBcHBMYXVuY2ggPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB3ZGFDYXBzID0ge1xuICAgICAgYnVuZGxlSWQ6IHRoaXMub3B0cy5hdXRvTGF1bmNoID09PSBmYWxzZSA/IHVuZGVmaW5lZCA6IGJ1bmRsZUlkLFxuICAgICAgYXJndW1lbnRzOiBhcmdzLFxuICAgICAgZW52aXJvbm1lbnQ6IGVudixcbiAgICAgIGV2ZW50bG9vcElkbGVEZWxheVNlYzogdGhpcy5vcHRzLndkYUV2ZW50bG9vcElkbGVEZWxheSA/PyAwLFxuICAgICAgc2hvdWxkV2FpdEZvclF1aWVzY2VuY2U6IHRoaXMub3B0cy53YWl0Rm9yUXVpZXNjZW5jZSA/PyB0cnVlLFxuICAgICAgc2hvdWxkVXNlVGVzdE1hbmFnZXJGb3JWaXNpYmlsaXR5RGV0ZWN0aW9uOiB0aGlzLm9wdHMuc2ltcGxlSXNWaXNpYmxlQ2hlY2sgPz8gZmFsc2UsXG4gICAgICBtYXhUeXBpbmdGcmVxdWVuY3k6IHRoaXMub3B0cy5tYXhUeXBpbmdGcmVxdWVuY3kgPz8gNjAsXG4gICAgICBzaG91bGRVc2VTaW5nbGV0b25UZXN0TWFuYWdlcjogdGhpcy5vcHRzLnNob3VsZFVzZVNpbmdsZXRvblRlc3RNYW5hZ2VyID8/IHRydWUsXG4gICAgICB3YWl0Rm9ySWRsZVRpbWVvdXQ6IHRoaXMub3B0cy53YWl0Rm9ySWRsZVRpbWVvdXQsXG4gICAgICBzaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzOiB0aGlzLm9wdHMuc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcyxcbiAgICAgIGVsZW1lbnRSZXNwb25zZUZpZWxkczogdGhpcy5vcHRzLmVsZW1lbnRSZXNwb25zZUZpZWxkcyxcbiAgICAgIGRpc2FibGVBdXRvbWF0aWNTY3JlZW5zaG90czogdGhpcy5vcHRzLmRpc2FibGVBdXRvbWF0aWNTY3JlZW5zaG90cyxcbiAgICAgIHNob3VsZFRlcm1pbmF0ZUFwcDogdGhpcy5vcHRzLnNob3VsZFRlcm1pbmF0ZUFwcCA/PyB0cnVlLFxuICAgICAgZm9yY2VBcHBMYXVuY2g6IHRoaXMub3B0cy5mb3JjZUFwcExhdW5jaCA/PyB0cnVlLFxuICAgICAgdXNlTmF0aXZlQ2FjaGluZ1N0cmF0ZWd5OiB0aGlzLm9wdHMudXNlTmF0aXZlQ2FjaGluZ1N0cmF0ZWd5ID8/IHRydWUsXG4gICAgICBmb3JjZVNpbXVsYXRvclNvZnR3YXJlS2V5Ym9hcmRQcmVzZW5jZTogdGhpcy5vcHRzLmZvcmNlU2ltdWxhdG9yU29mdHdhcmVLZXlib2FyZFByZXNlbmNlXG4gICAgICAgID8/ICh0aGlzLm9wdHMuY29ubmVjdEhhcmR3YXJlS2V5Ym9hcmQgPT09IHRydWUgPyBmYWxzZSA6IHRydWUpLFxuICAgIH07XG4gICAgaWYgKHRoaXMub3B0cy5hdXRvQWNjZXB0QWxlcnRzKSB7XG4gICAgICB3ZGFDYXBzLmRlZmF1bHRBbGVydEFjdGlvbiA9ICdhY2NlcHQnO1xuICAgIH0gZWxzZSBpZiAodGhpcy5vcHRzLmF1dG9EaXNtaXNzQWxlcnRzKSB7XG4gICAgICB3ZGFDYXBzLmRlZmF1bHRBbGVydEFjdGlvbiA9ICdkaXNtaXNzJztcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3Nlc3Npb24nLCAnUE9TVCcsIHtcbiAgICAgIGNhcGFiaWxpdGllczoge1xuICAgICAgICBmaXJzdE1hdGNoOiBbd2RhQ2Fwc10sXG4gICAgICAgIGFsd2F5c01hdGNoOiB7fSxcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIE92ZXJyaWRlIFByb3h5IG1ldGhvZHMgZnJvbSBCYXNlRHJpdmVyXG4gIHByb3h5QWN0aXZlICgpIHtcbiAgICByZXR1cm4gdGhpcy5qd3BQcm94eUFjdGl2ZTtcbiAgfVxuXG4gIGdldFByb3h5QXZvaWRMaXN0ICgpIHtcbiAgICBpZiAodGhpcy5pc1dlYnZpZXcoKSkge1xuICAgICAgcmV0dXJuIE5PX1BST1hZX1dFQl9MSVNUO1xuICAgIH1cbiAgICByZXR1cm4gTk9fUFJPWFlfTkFUSVZFX0xJU1Q7XG4gIH1cblxuICBjYW5Qcm94eSAoKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpc1NhZmFyaSAoKSB7XG4gICAgcmV0dXJuICEhdGhpcy5zYWZhcmk7XG4gIH1cblxuICBpc1JlYWxEZXZpY2UgKCkge1xuICAgIHJldHVybiB0aGlzLm9wdHMucmVhbERldmljZTtcbiAgfVxuXG4gIGlzU2ltdWxhdG9yICgpIHtcbiAgICByZXR1cm4gIXRoaXMub3B0cy5yZWFsRGV2aWNlO1xuICB9XG5cbiAgaXNUdk9TICgpIHtcbiAgICByZXR1cm4gXy50b0xvd2VyKHRoaXMub3B0cy5wbGF0Zm9ybU5hbWUpID09PSBfLnRvTG93ZXIoUExBVEZPUk1fTkFNRV9UVk9TKTtcbiAgfVxuXG4gIGlzV2VidmlldyAoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXNTYWZhcmkoKSB8fCB0aGlzLmlzV2ViQ29udGV4dCgpO1xuICB9XG5cbiAgdmFsaWRhdGVMb2NhdG9yU3RyYXRlZ3kgKHN0cmF0ZWd5KSB7XG4gICAgc3VwZXIudmFsaWRhdGVMb2NhdG9yU3RyYXRlZ3koc3RyYXRlZ3ksIHRoaXMuaXNXZWJDb250ZXh0KCkpO1xuICB9XG5cbiAgdmFsaWRhdGVEZXNpcmVkQ2FwcyAoY2Fwcykge1xuICAgIGlmICghc3VwZXIudmFsaWRhdGVEZXNpcmVkQ2FwcyhjYXBzKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIG1ha2Ugc3VyZSB0aGF0IHRoZSBjYXBhYmlsaXRpZXMgaGF2ZSBvbmUgb2YgYGFwcGAgb3IgYGJ1bmRsZUlkYFxuICAgIGlmIChfLnRvTG93ZXIoY2Fwcy5icm93c2VyTmFtZSkgIT09ICdzYWZhcmknICYmICFjYXBzLmFwcCAmJiAhY2Fwcy5idW5kbGVJZCkge1xuICAgICAgdGhpcy5sb2cuaW5mbygnVGhlIGRlc2lyZWQgY2FwYWJpbGl0aWVzIGluY2x1ZGUgbmVpdGhlciBhbiBhcHAgbm9yIGEgYnVuZGxlSWQuICcgK1xuICAgICAgICAnV2ViRHJpdmVyQWdlbnQgd2lsbCBiZSBzdGFydGVkIHdpdGhvdXQgdGhlIGRlZmF1bHQgYXBwJyk7XG4gICAgfVxuXG4gICAgaWYgKCF1dGlsLmNvZXJjZVZlcnNpb24oY2Fwcy5wbGF0Zm9ybVZlcnNpb24sIGZhbHNlKSkge1xuICAgICAgdGhpcy5sb2cud2FybihgJ3BsYXRmb3JtVmVyc2lvbicgY2FwYWJpbGl0eSAoJyR7Y2Fwcy5wbGF0Zm9ybVZlcnNpb259JykgaXMgbm90IGEgdmFsaWQgdmVyc2lvbiBudW1iZXIuIGAgK1xuICAgICAgICBgQ29uc2lkZXIgZml4aW5nIGl0IG9yIGJlIHJlYWR5IHRvIGV4cGVyaWVuY2UgYW4gaW5jb25zaXN0ZW50IGRyaXZlciBiZWhhdmlvci5gKTtcbiAgICB9XG5cbiAgICBsZXQgdmVyaWZ5UHJvY2Vzc0FyZ3VtZW50ID0gKHByb2Nlc3NBcmd1bWVudHMpID0+IHtcbiAgICAgIGNvbnN0IHthcmdzLCBlbnZ9ID0gcHJvY2Vzc0FyZ3VtZW50cztcbiAgICAgIGlmICghXy5pc05pbChhcmdzKSAmJiAhXy5pc0FycmF5KGFyZ3MpKSB7XG4gICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coJ3Byb2Nlc3NBcmd1bWVudHMuYXJncyBtdXN0IGJlIGFuIGFycmF5IG9mIHN0cmluZ3MnKTtcbiAgICAgIH1cbiAgICAgIGlmICghXy5pc05pbChlbnYpICYmICFfLmlzUGxhaW5PYmplY3QoZW52KSkge1xuICAgICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KCdwcm9jZXNzQXJndW1lbnRzLmVudiBtdXN0IGJlIGFuIG9iamVjdCA8a2V5LHZhbHVlPiBwYWlyIHthOmIsIGM6ZH0nKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gYHByb2Nlc3NBcmd1bWVudHNgIHNob3VsZCBiZSBKU09OIHN0cmluZyBvciBhbiBvYmplY3Qgd2l0aCBhcmd1bWVudHMgYW5kLyBlbnZpcm9ubWVudCBkZXRhaWxzXG4gICAgaWYgKGNhcHMucHJvY2Vzc0FyZ3VtZW50cykge1xuICAgICAgaWYgKF8uaXNTdHJpbmcoY2Fwcy5wcm9jZXNzQXJndW1lbnRzKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIHRyeSB0byBwYXJzZSB0aGUgc3RyaW5nIGFzIEpTT05cbiAgICAgICAgICBjYXBzLnByb2Nlc3NBcmd1bWVudHMgPSBKU09OLnBhcnNlKGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICAgICAgdmVyaWZ5UHJvY2Vzc0FyZ3VtZW50KGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYHByb2Nlc3NBcmd1bWVudHMgbXVzdCBiZSBhIEpTT04gZm9ybWF0IG9yIGFuIG9iamVjdCB3aXRoIGZvcm1hdCB7YXJncyA6IFtdLCBlbnYgOiB7YTpiLCBjOmR9fS4gYCArXG4gICAgICAgICAgICBgQm90aCBlbnZpcm9ubWVudCBhbmQgYXJndW1lbnQgY2FuIGJlIG51bGwuIEVycm9yOiAke2Vycn1gKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChfLmlzUGxhaW5PYmplY3QoY2Fwcy5wcm9jZXNzQXJndW1lbnRzKSkge1xuICAgICAgICB2ZXJpZnlQcm9jZXNzQXJndW1lbnQoY2Fwcy5wcm9jZXNzQXJndW1lbnRzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYCdwcm9jZXNzQXJndW1lbnRzIG11c3QgYmUgYW4gb2JqZWN0LCBvciBhIHN0cmluZyBKU09OIG9iamVjdCB3aXRoIGZvcm1hdCB7YXJncyA6IFtdLCBlbnYgOiB7YTpiLCBjOmR9fS4gYCArXG4gICAgICAgICAgYEJvdGggZW52aXJvbm1lbnQgYW5kIGFyZ3VtZW50IGNhbiBiZSBudWxsLmApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHRoZXJlIGlzIG5vIHBvaW50IGluIGhhdmluZyBga2V5Y2hhaW5QYXRoYCB3aXRob3V0IGBrZXljaGFpblBhc3N3b3JkYFxuICAgIGlmICgoY2Fwcy5rZXljaGFpblBhdGggJiYgIWNhcHMua2V5Y2hhaW5QYXNzd29yZCkgfHwgKCFjYXBzLmtleWNoYWluUGF0aCAmJiBjYXBzLmtleWNoYWluUGFzc3dvcmQpKSB7XG4gICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGBJZiAna2V5Y2hhaW5QYXRoJyBpcyBzZXQsICdrZXljaGFpblBhc3N3b3JkJyBtdXN0IGFsc28gYmUgc2V0IChhbmQgdmljZSB2ZXJzYSkuYCk7XG4gICAgfVxuXG4gICAgLy8gYHJlc2V0T25TZXNzaW9uU3RhcnRPbmx5YCBzaG91bGQgYmUgc2V0IHRvIHRydWUgYnkgZGVmYXVsdFxuICAgIHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seSA9ICF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seSkgfHwgdGhpcy5vcHRzLnJlc2V0T25TZXNzaW9uU3RhcnRPbmx5O1xuICAgIHRoaXMub3B0cy51c2VOZXdXREEgPSB1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy51c2VOZXdXREEpID8gdGhpcy5vcHRzLnVzZU5ld1dEQSA6IGZhbHNlO1xuXG4gICAgaWYgKGNhcHMuY29tbWFuZFRpbWVvdXRzKSB7XG4gICAgICBjYXBzLmNvbW1hbmRUaW1lb3V0cyA9IG5vcm1hbGl6ZUNvbW1hbmRUaW1lb3V0cyhjYXBzLmNvbW1hbmRUaW1lb3V0cyk7XG4gICAgfVxuXG4gICAgaWYgKF8uaXNTdHJpbmcoY2Fwcy53ZWJEcml2ZXJBZ2VudFVybCkpIHtcbiAgICAgIGNvbnN0IHtwcm90b2NvbCwgaG9zdH0gPSB1cmwucGFyc2UoY2Fwcy53ZWJEcml2ZXJBZ2VudFVybCk7XG4gICAgICBpZiAoXy5pc0VtcHR5KHByb3RvY29sKSB8fCBfLmlzRW1wdHkoaG9zdCkpIHtcbiAgICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgJ3dlYkRyaXZlckFnZW50VXJsJyBjYXBhYmlsaXR5IGlzIGV4cGVjdGVkIHRvIGNvbnRhaW4gYSB2YWxpZCBXZWJEcml2ZXJBZ2VudCBzZXJ2ZXIgVVJMLiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYCcke2NhcHMud2ViRHJpdmVyQWdlbnRVcmx9JyBpcyBnaXZlbiBpbnN0ZWFkYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNhcHMuYnJvd3Nlck5hbWUpIHtcbiAgICAgIGlmIChjYXBzLmJ1bmRsZUlkKSB7XG4gICAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYCdicm93c2VyTmFtZScgY2Fubm90IGJlIHNldCB0b2dldGhlciB3aXRoICdidW5kbGVJZCcgY2FwYWJpbGl0eWApO1xuICAgICAgfVxuICAgICAgLy8gd2FybiBpZiB0aGUgY2FwYWJpbGl0aWVzIGhhdmUgYm90aCBgYXBwYCBhbmQgYGJyb3dzZXIsIGFsdGhvdWdoIHRoaXNcbiAgICAgIC8vIGlzIGNvbW1vbiB3aXRoIHNlbGVuaXVtIGdyaWRcbiAgICAgIGlmIChjYXBzLmFwcCkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKGBUaGUgY2FwYWJpbGl0aWVzIHNob3VsZCBnZW5lcmFsbHkgbm90IGluY2x1ZGUgYm90aCBhbiAnYXBwJyBhbmQgYSAnYnJvd3Nlck5hbWUnYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNhcHMucGVybWlzc2lvbnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZvciAoY29uc3QgW2J1bmRsZUlkLCBwZXJtc10gb2YgXy50b1BhaXJzKEpTT04ucGFyc2UoY2Fwcy5wZXJtaXNzaW9ucykpKSB7XG4gICAgICAgICAgaWYgKCFfLmlzU3RyaW5nKGJ1bmRsZUlkKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtKU09OLnN0cmluZ2lmeShidW5kbGVJZCl9JyBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghXy5pc1BsYWluT2JqZWN0KHBlcm1zKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtKU09OLnN0cmluZ2lmeShwZXJtcyl9JyBtdXN0IGJlIGEgSlNPTiBvYmplY3RgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhpcy5sb2cuZXJyb3JBbmRUaHJvdyhgJyR7Y2Fwcy5wZXJtaXNzaW9uc30nIGlzIGV4cGVjdGVkIHRvIGJlIGEgdmFsaWQgb2JqZWN0IHdpdGggZm9ybWF0IGAgK1xuICAgICAgICAgIGB7XCI8YnVuZGxlSWQxPlwiOiB7XCI8c2VydmljZU5hbWUxPlwiOiBcIjxzZXJ2aWNlU3RhdHVzMT5cIiwgLi4ufSwgLi4ufS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjYXBzLnBsYXRmb3JtVmVyc2lvbiAmJiAhdXRpbC5jb2VyY2VWZXJzaW9uKGNhcHMucGxhdGZvcm1WZXJzaW9uLCBmYWxzZSkpIHtcbiAgICAgIHRoaXMubG9nLmVycm9yQW5kVGhyb3coYCdwbGF0Zm9ybVZlcnNpb24nIG11c3QgYmUgYSB2YWxpZCB2ZXJzaW9uIG51bWJlci4gYCArXG4gICAgICAgIGAnJHtjYXBzLnBsYXRmb3JtVmVyc2lvbn0nIGlzIGdpdmVuIGluc3RlYWQuYCk7XG4gICAgfVxuXG4gICAgLy8gYWRkaXRpb25hbFdlYnZpZXdCdW5kbGVJZHMgaXMgYW4gYXJyYXksIEpTT04gYXJyYXksIG9yIHN0cmluZ1xuICAgIGlmIChjYXBzLmFkZGl0aW9uYWxXZWJ2aWV3QnVuZGxlSWRzKSB7XG4gICAgICBjYXBzLmFkZGl0aW9uYWxXZWJ2aWV3QnVuZGxlSWRzID0gdGhpcy5oZWxwZXJzLnBhcnNlQ2Fwc0FycmF5KGNhcHMuYWRkaXRpb25hbFdlYnZpZXdCdW5kbGVJZHMpO1xuICAgIH1cblxuICAgIC8vIGZpbmFsbHksIHJldHVybiB0cnVlIHNpbmNlIHRoZSBzdXBlcmNsYXNzIGNoZWNrIHBhc3NlZCwgYXMgZGlkIHRoaXNcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGFzeW5jIGluc3RhbGxBVVQgKCkge1xuICAgIGlmICh0aGlzLmlzU2FmYXJpKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB2ZXJpZnlBcHBsaWNhdGlvblBsYXRmb3JtKHRoaXMub3B0cy5hcHAsIHtcbiAgICAgIGlzU2ltdWxhdG9yOiB0aGlzLmlzU2ltdWxhdG9yKCksXG4gICAgICBpc1R2T1M6IHRoaXMuaXNUdk9TKCksXG4gICAgfSk7XG5cbiAgICBpZiAodGhpcy5pc1JlYWxEZXZpY2UoKSkge1xuICAgICAgYXdhaXQgaW5zdGFsbFRvUmVhbERldmljZSh0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMuYXBwLCB0aGlzLm9wdHMuYnVuZGxlSWQsIHtcbiAgICAgICAgbm9SZXNldDogdGhpcy5vcHRzLm5vUmVzZXQsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMub3B0cy5hcHBQdXNoVGltZW91dCxcbiAgICAgICAgc3RyYXRlZ3k6IHRoaXMub3B0cy5hcHBJbnN0YWxsU3RyYXRlZ3ksXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgaW5zdGFsbFRvU2ltdWxhdG9yKHRoaXMub3B0cy5kZXZpY2UsIHRoaXMub3B0cy5hcHAsIHRoaXMub3B0cy5idW5kbGVJZCwge1xuICAgICAgICBub1Jlc2V0OiB0aGlzLm9wdHMubm9SZXNldCxcbiAgICAgICAgbmV3U2ltdWxhdG9yOiB0aGlzLmxpZmVjeWNsZURhdGEuY3JlYXRlU2ltLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmICh0aGlzLm9wdHMub3RoZXJBcHBzKSB7XG4gICAgICBhd2FpdCB0aGlzLmluc3RhbGxPdGhlckFwcHModGhpcy5vcHRzLm90aGVyQXBwcyk7XG4gICAgfVxuXG4gICAgaWYgKHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLmlvc0luc3RhbGxQYXVzZSkpIHtcbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy82ODg5XG4gICAgICBsZXQgcGF1c2UgPSBwYXJzZUludCh0aGlzLm9wdHMuaW9zSW5zdGFsbFBhdXNlLCAxMCk7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgaW9zSW5zdGFsbFBhdXNlIHNldC4gUGF1c2luZyAke3BhdXNlfSBtcyBiZWZvcmUgY29udGludWluZ2ApO1xuICAgICAgYXdhaXQgQi5kZWxheShwYXVzZSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgaW5zdGFsbE90aGVyQXBwcyAob3RoZXJBcHBzKSB7XG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgIHRoaXMubG9nLndhcm4oJ0NhcGFiaWxpdHkgb3RoZXJBcHBzIGlzIG9ubHkgc3VwcG9ydGVkIGZvciBTaW11bGF0b3JzJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCBhcHBzTGlzdDtcbiAgICB0cnkge1xuICAgICAgYXBwc0xpc3QgPSB0aGlzLmhlbHBlcnMucGFyc2VDYXBzQXJyYXkob3RoZXJBcHBzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmxvZy5lcnJvckFuZFRocm93KGBDb3VsZCBub3QgcGFyc2UgXCJvdGhlckFwcHNcIiBjYXBhYmlsaXR5OiAke2UubWVzc2FnZX1gKTtcbiAgICB9XG4gICAgaWYgKF8uaXNFbXB0eShhcHBzTGlzdCkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oYEdvdCB6ZXJvIGFwcHMgZnJvbSAnb3RoZXJBcHBzJyBjYXBhYmlsaXR5IHZhbHVlLiBEb2luZyBub3RoaW5nYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYXBwUGF0aHMgPSBhd2FpdCBCLmFsbChhcHBzTGlzdC5tYXAoXG4gICAgICAoYXBwKSA9PiB0aGlzLmhlbHBlcnMuY29uZmlndXJlQXBwKGFwcCwgJy5hcHAnKVxuICAgICkpO1xuICAgIGZvciAoY29uc3Qgb3RoZXJBcHAgb2YgYXBwUGF0aHMpIHtcbiAgICAgIGF3YWl0IGluc3RhbGxUb1NpbXVsYXRvcih0aGlzLm9wdHMuZGV2aWNlLCBvdGhlckFwcCwgdW5kZWZpbmVkLCB7XG4gICAgICAgIG5vUmVzZXQ6IHRoaXMub3B0cy5ub1Jlc2V0LFxuICAgICAgICBuZXdTaW11bGF0b3I6IHRoaXMubGlmZWN5Y2xlRGF0YS5jcmVhdGVTaW0sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0IHJlZHVjZU1vdGlvbiBhcyAnaXNFbmFibGVkJyBvbmx5IHdoZW4gdGhlIGNhcGFiaWxpdGllcyBoYXMgJ3JlZHVjZU1vdGlvbidcbiAgICogVGhlIGNhbGwgaXMgaWdub3JlZCBmb3IgcmVhbCBkZXZpY2VzLlxuICAgKiBAcGFyYW0gez9ib29sZWFufSBpc0VuYWJsZWQgV2V0aGVyIGVuYWJsZSByZWR1Y2VNb3Rpb25cbiAgICovXG4gIGFzeW5jIHNldFJlZHVjZU1vdGlvbiAoaXNFbmFibGVkKSB7XG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkgfHwgIV8uaXNCb29sZWFuKGlzRW5hYmxlZCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmxvZy5pbmZvKGBTZXR0aW5nIHJlZHVjZU1vdGlvbiB0byAke2lzRW5hYmxlZH1gKTtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVNldHRpbmdzKHtyZWR1Y2VNb3Rpb246IGlzRW5hYmxlZH0pO1xuICB9XG5cbiAgYXN5bmMgc2V0SW5pdGlhbE9yaWVudGF0aW9uIChvcmllbnRhdGlvbikge1xuICAgIGlmICghXy5pc1N0cmluZyhvcmllbnRhdGlvbikpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ1NraXBwaW5nIHNldHRpbmcgb2YgdGhlIGluaXRpYWwgZGlzcGxheSBvcmllbnRhdGlvbi4gJyArXG4gICAgICAgICdTZXQgdGhlIFwib3JpZW50YXRpb25cIiBjYXBhYmlsaXR5IHRvIGVpdGhlciBcIkxBTkRTQ0FQRVwiIG9yIFwiUE9SVFJBSVRcIiwgaWYgdGhpcyBpcyBhbiB1bmRlc2lyZWQgYmVoYXZpb3IuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG9yaWVudGF0aW9uID0gb3JpZW50YXRpb24udG9VcHBlckNhc2UoKTtcbiAgICBpZiAoIV8uaW5jbHVkZXMoWydMQU5EU0NBUEUnLCAnUE9SVFJBSVQnXSwgb3JpZW50YXRpb24pKSB7XG4gICAgICB0aGlzLmxvZy5kZWJ1ZyhgVW5hYmxlIHRvIHNldCBpbml0aWFsIG9yaWVudGF0aW9uIHRvICcke29yaWVudGF0aW9ufSdgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5sb2cuZGVidWcoYFNldHRpbmcgaW5pdGlhbCBvcmllbnRhdGlvbiB0byAnJHtvcmllbnRhdGlvbn0nYCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucHJveHlDb21tYW5kKCcvb3JpZW50YXRpb24nLCAnUE9TVCcsIHtvcmllbnRhdGlvbn0pO1xuICAgICAgdGhpcy5vcHRzLmN1ck9yaWVudGF0aW9uID0gb3JpZW50YXRpb247XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLmxvZy53YXJuKGBTZXR0aW5nIGluaXRpYWwgb3JpZW50YXRpb24gZmFpbGVkIHdpdGg6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9XG5cbiAgX2dldENvbW1hbmRUaW1lb3V0IChjbWROYW1lKSB7XG4gICAgaWYgKHRoaXMub3B0cy5jb21tYW5kVGltZW91dHMpIHtcbiAgICAgIGlmIChjbWROYW1lICYmIF8uaGFzKHRoaXMub3B0cy5jb21tYW5kVGltZW91dHMsIGNtZE5hbWUpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wdHMuY29tbWFuZFRpbWVvdXRzW2NtZE5hbWVdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMub3B0cy5jb21tYW5kVGltZW91dHNbREVGQVVMVF9USU1FT1VUX0tFWV07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXNzaW9uIGNhcGFiaWxpdGllcyBtZXJnZWQgd2l0aCB3aGF0IFdEQSByZXBvcnRzXG4gICAqIFRoaXMgaXMgYSBsaWJyYXJ5IGNvbW1hbmQgYnV0IG5lZWRzIHRvIGNhbGwgJ3N1cGVyJyBzbyBjYW4ndCBiZSBvblxuICAgKiBhIGhlbHBlciBvYmplY3RcbiAgICovXG4gIGFzeW5jIGdldFNlc3Npb24gKCkge1xuICAgIC8vIGNhbGwgc3VwZXIgdG8gZ2V0IGV2ZW50IHRpbWluZ3MsIGV0Yy4uLlxuICAgIGNvbnN0IGRyaXZlclNlc3Npb24gPSBhd2FpdCBzdXBlci5nZXRTZXNzaW9uKCk7XG4gICAgaWYgKCF0aGlzLndkYUNhcHMpIHtcbiAgICAgIHRoaXMud2RhQ2FwcyA9IGF3YWl0IHRoaXMucHJveHlDb21tYW5kKCcvJywgJ0dFVCcpO1xuICAgIH1cblxuICAgIGNvbnN0IHNob3VsZEdldERldmljZUNhcHMgPSBfLmlzQm9vbGVhbih0aGlzLm9wdHMuaW5jbHVkZURldmljZUNhcHNUb1Nlc3Npb25JbmZvKVxuICAgICAgPyB0aGlzLm9wdHMuaW5jbHVkZURldmljZUNhcHNUb1Nlc3Npb25JbmZvXG4gICAgICA6IHRydWU7IC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICBpZiAoc2hvdWxkR2V0RGV2aWNlQ2FwcyAmJiAhdGhpcy5kZXZpY2VDYXBzKSB7XG4gICAgICBjb25zdCB7c3RhdHVzQmFyU2l6ZSwgc2NhbGV9ID0gYXdhaXQgdGhpcy5nZXRTY3JlZW5JbmZvKCk7XG4gICAgICB0aGlzLmRldmljZUNhcHMgPSB7XG4gICAgICAgIHBpeGVsUmF0aW86IHNjYWxlLFxuICAgICAgICBzdGF0QmFySGVpZ2h0OiBzdGF0dXNCYXJTaXplLmhlaWdodCxcbiAgICAgICAgdmlld3BvcnRSZWN0OiBhd2FpdCB0aGlzLmdldFZpZXdwb3J0UmVjdCgpLFxuICAgICAgfTtcbiAgICB9XG4gICAgdGhpcy5sb2cuaW5mbygnTWVyZ2luZyBXREEgY2FwcyBvdmVyIEFwcGl1bSBjYXBzIGZvciBzZXNzaW9uIGRldGFpbCByZXNwb25zZScpO1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt1ZGlkOiB0aGlzLm9wdHMudWRpZH0sIGRyaXZlclNlc3Npb24sXG4gICAgICB0aGlzLndkYUNhcHMuY2FwYWJpbGl0aWVzLCB0aGlzLmRldmljZUNhcHMgfHwge30pO1xuICB9XG5cbiAgYXN5bmMgcmVzZXQgKCkge1xuICAgIGlmICh0aGlzLm9wdHMubm9SZXNldCkge1xuICAgICAgLy8gVGhpcyBpcyB0byBtYWtlIHN1cmUgcmVzZXQgaGFwcGVucyBldmVuIGlmIG5vUmVzZXQgaXMgc2V0IHRvIHRydWVcbiAgICAgIGxldCBvcHRzID0gXy5jbG9uZURlZXAodGhpcy5vcHRzKTtcbiAgICAgIG9wdHMubm9SZXNldCA9IGZhbHNlO1xuICAgICAgb3B0cy5mdWxsUmVzZXQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IHNodXRkb3duSGFuZGxlciA9IHRoaXMucmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93bjtcbiAgICAgIHRoaXMucmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93biA9ICgpID0+IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5SZXNldChvcHRzKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucmVzZXRPblVuZXhwZWN0ZWRTaHV0ZG93biA9IHNodXRkb3duSGFuZGxlcjtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgc3VwZXIucmVzZXQoKTtcbiAgfVxufVxuXG5PYmplY3QuYXNzaWduKFhDVUlUZXN0RHJpdmVyLnByb3RvdHlwZSwgY29tbWFuZHMpO1xuXG5leHBvcnQgZGVmYXVsdCBYQ1VJVGVzdERyaXZlcjtcbmV4cG9ydCB7IFhDVUlUZXN0RHJpdmVyIH07XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBQUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBSUE7O0FBQ0E7O0FBSUE7O0FBQ0E7O0FBS0E7O0FBR0E7O0FBQ0E7O0FBUUE7O0FBSUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBR0EsTUFBTUEsd0JBQXdCLEdBQUcscUJBQWpDO0FBQ0EsTUFBTUMsNEJBQTRCLEdBQUcsOEJBQXJDO0FBRUEsTUFBTUMsb0JBQW9CLEdBQUcsQ0FBQ0MsaUJBQUQsRUFBVUMsaUJBQVYsQ0FBN0I7QUFDQSxNQUFNQyxzQkFBc0IsR0FBRyxDQUEvQjtBQUNBLE1BQU1DLGlCQUFpQixHQUFHO0VBQ3hCQyxpQkFBaUIsRUFBRSxLQURLO0VBRXhCQyxzQkFBc0Is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
