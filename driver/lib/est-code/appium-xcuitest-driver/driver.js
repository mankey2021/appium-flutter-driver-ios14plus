"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XCUITestDriver = void 0;
const appium_idb_1 = __importDefault(require("appium-idb"));
const appium_ios_simulator_1 = require("appium-ios-simulator");
const appium_webdriveragent_1 = require("appium-webdriveragent");
const driver_1 = require("appium/driver");
const support_1 = require("appium/support");
const async_lock_1 = __importDefault(require("async-lock"));
const asyncbox_1 = require("asyncbox");
const bluebird_1 = __importDefault(require("bluebird"));
const lodash_1 = __importDefault(require("lodash"));
const lru_cache_1 = require("lru-cache");
const node_events_1 = __importDefault(require("node:events"));
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = __importDefault(require("node:url"));
const app_utils_1 = require("./app-utils");
const commands_1 = __importDefault(require("./commands"));
const desired_caps_1 = require("./desired-caps");
const device_connections_factory_1 = __importDefault(require("./device-connections-factory"));
const execute_method_map_1 = require("./execute-method-map");
const method_map_1 = require("./method-map");
const py_ios_device_client_1 = __importDefault(require("./py-ios-device-client"));
const real_device_management_1 = require("./real-device-management");
const simulator_management_1 = require("./simulator-management");
const utils_1 = require("./utils");
const SHUTDOWN_OTHER_FEAT_NAME = 'shutdown_other_sims';
const CUSTOMIZE_RESULT_BUNDPE_PATH = 'customize_result_bundle_path';
const SUPPORTED_EXTENSIONS = [app_utils_1.IPA_EXT, app_utils_1.APP_EXT];
const MAX_ARCHIVE_SCAN_DEPTH = 1;
const defaultServerCaps = {
    webStorageEnabled: false,
    locationContextEnabled: false,
    browserName: '',
    platform: 'MAC',
    javascriptEnabled: true,
    databaseEnabled: false,
    takesScreenshot: true,
    networkConnectionEnabled: false,
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
    // Read https://github.com/appium/WebDriverAgent/blob/master/WebDriverAgentLib/Utilities/FBConfiguration.m for following settings' values
    mjpegServerScreenshotQuality: 25,
    mjpegServerFramerate: 10,
    screenshotQuality: 1,
    mjpegScalingFactor: 100,
    // set `reduceMotion` to `null` so that it will be verified but still set either true/false
    reduceMotion: null,
    pageSourceExcludedAttributes: ''
};
// This lock assures, that each driver session does not
// affect shared resources of the other parallel sessions
const SHARED_RESOURCES_GUARD = new async_lock_1.default();
const WEB_ELEMENTS_CACHE_SIZE = 500;
const SUPPORTED_ORIENATIONS = ['LANDSCAPE', 'PORTRAIT'];
/* eslint-disable no-useless-escape */
/** @type {import('@appium/types').RouteMatcher[]} */
const NO_PROXY_NATIVE_LIST = [
    ['DELETE', /window/],
    ['GET', /^\/session\/[^\/]+$/],
    ['GET', /alert_text/],
    ['GET', /alert\/[^\/]+/],
    ['GET', /appium/],
    ['GET', /attribute/],
    ['GET', /context/],
    ['GET', /location/],
    ['GET', /log/],
    ['GET', /screenshot/],
    ['GET', /size/],
    ['GET', /source/],
    ['GET', /timeouts$/],
    ['GET', /url/],
    ['GET', /window/],
    ['POST', /accept_alert/],
    ['POST', /actions$/],
    ['DELETE', /actions$/],
    ['POST', /alert_text/],
    ['POST', /alert\/[^\/]+/],
    ['POST', /appium/],
    ['POST', /appium\/device\/is_locked/],
    ['POST', /appium\/device\/lock/],
    ['POST', /appium\/device\/unlock/],
    ['POST', /back/],
    ['POST', /clear/],
    ['POST', /context/],
    ['POST', /dismiss_alert/],
    ['POST', /element\/active/],
    ['POST', /element$/],
    ['POST', /elements$/],
    ['POST', /execute/],
    ['POST', /keys/],
    ['POST', /log/],
    ['POST', /receive_async_response/],
    ['POST', /session\/[^\/]+\/location/],
    ['POST', /shake/],
    ['POST', /timeouts/],
    ['POST', /touch/],
    ['POST', /url/],
    ['POST', /value/],
    ['POST', /window/],
    ['DELETE', /cookie/],
    ['GET', /cookie/],
    ['POST', /cookie/],
];
const NO_PROXY_WEB_LIST = /** @type {import('@appium/types').RouteMatcher[]} */ ([
    ['GET', /attribute/],
    ['GET', /element/],
    ['GET', /text/],
    ['GET', /title/],
    ['POST', /clear/],
    ['POST', /click/],
    ['POST', /element/],
    ['POST', /forward/],
    ['POST', /frame/],
    ['POST', /keys/],
    ['POST', /refresh/],
]).concat(NO_PROXY_NATIVE_LIST);
/* eslint-enable no-useless-escape */
const MEMOIZED_FUNCTIONS = ['getStatusBarHeight', 'getDevicePixelRatio', 'getScreenInfo'];
const BUNDLE_VERSION_PATTERN = /CFBundleVersion\s+=\s+"?([^(;|")]+)/;
/**
 * @implements {ExternalDriver<XCUITestDriverConstraints, FullContext|string>}
 * @extends {BaseDriver<XCUITestDriverConstraints>}
 * @privateRemarks **This class should be considered "final"**. It cannot be extended
 * due to use of public class field assignments.  If extending this class becomes a hard requirement, refer to the implementation of `BaseDriver` on how to do so.
 */
class XCUITestDriver extends driver_1.BaseDriver {
    /**
     *
     * @param {XCUITestDriverOpts} opts
     * @param {boolean} shouldValidateCaps
     */
    constructor(opts = /** @type {XCUITestDriverOpts} */ ({}), shouldValidateCaps = true) {
        super(opts, shouldValidateCaps);
        /*---------------+
         | ACTIVEAPPINFO |
         +---------------+*/
        this.mobileGetActiveAppInfo = commands_1.default.activeAppInfoExtensions.mobileGetActiveAppInfo;
        /*-------+
         | ALERT |
         +-------+*/
        this.getAlertText = commands_1.default.alertExtensions.getAlertText;
        this.setAlertText = commands_1.default.alertExtensions.setAlertText;
        this.postAcceptAlert = commands_1.default.alertExtensions.postAcceptAlert;
        this.postDismissAlert = commands_1.default.alertExtensions.postDismissAlert;
        this.getAlertButtons = commands_1.default.alertExtensions.getAlertButtons;
        this.mobileHandleAlert = commands_1.default.alertExtensions.mobileHandleAlert;
        /*---------------+
         | APPMANAGEMENT |
         +---------------+*/
        this.mobileInstallApp = commands_1.default.appManagementExtensions.mobileInstallApp;
        this.mobileIsAppInstalled = commands_1.default.appManagementExtensions.mobileIsAppInstalled;
        this.mobileRemoveApp = commands_1.default.appManagementExtensions.mobileRemoveApp;
        this.mobileLaunchApp = commands_1.default.appManagementExtensions.mobileLaunchApp;
        this.mobileTerminateApp = commands_1.default.appManagementExtensions.mobileTerminateApp;
        this.mobileActivateApp = commands_1.default.appManagementExtensions.mobileActivateApp;
        this.mobileKillApp = commands_1.default.appManagementExtensions.mobileKillApp;
        this.mobileQueryAppState = commands_1.default.appManagementExtensions.mobileQueryAppState;
        this.installApp = commands_1.default.appManagementExtensions.installApp;
        this.activateApp = commands_1.default.appManagementExtensions.activateApp;
        this.isAppInstalled = commands_1.default.appManagementExtensions.isAppInstalled;
        // @ts-ignore it must return boolean
        this.terminateApp = commands_1.default.appManagementExtensions.terminateApp;
        this.queryAppState = commands_1.default.appManagementExtensions.queryAppState;
        this.mobileListApps = commands_1.default.appManagementExtensions.mobileListApps;
        this.mobileClearApp = commands_1.default.appManagementExtensions.mobileClearApp;
        /*------------+
         | APPEARANCE |
         +------------+*/
        this.mobileSetAppearance = commands_1.default.appearanceExtensions.mobileSetAppearance;
        this.mobileGetAppearance = commands_1.default.appearanceExtensions.mobileGetAppearance;
        /*------------+
         | AUDIT      |
         +------------+*/
        this.mobilePerformAccessibilityAudit = commands_1.default.auditExtensions.mobilePerformAccessibilityAudit;
        /*---------+
         | BATTERY |
         +---------+*/
        this.mobileGetBatteryInfo = commands_1.default.batteryExtensions.mobileGetBatteryInfo;
        /*-----------+
         | BIOMETRIC |
         +-----------+*/
        this.mobileEnrollBiometric = commands_1.default.biometricExtensions.mobileEnrollBiometric;
        this.mobileSendBiometricMatch = commands_1.default.biometricExtensions.mobileSendBiometricMatch;
        this.mobileIsBiometricEnrolled = commands_1.default.biometricExtensions.mobileIsBiometricEnrolled;
        /*-------------+
         | CERTIFICATE |
         +-------------+*/
        this.mobileInstallCertificate = commands_1.default.certificateExtensions.mobileInstallCertificate;
        this.mobileListCertificates = commands_1.default.certificateExtensions.mobileListCertificates;
        this.mobileRemoveCertificate = commands_1.default.certificateExtensions.mobileRemoveCertificate;
        /*-----------+
         | CLIPBOARD |
         +-----------+*/
        this.setClipboard = commands_1.default.clipboardExtensions.setClipboard;
        this.getClipboard = commands_1.default.clipboardExtensions.getClipboard;
        /*-----------+
         | CONDITION |
         +-----------+*/
        this.listConditionInducers = commands_1.default.conditionExtensions.listConditionInducers;
        this.enableConditionInducer = commands_1.default.conditionExtensions.enableConditionInducer;
        this.disableConditionInducer = commands_1.default.conditionExtensions.disableConditionInducer;
        /*---------+
         | CONTEXT |
         +---------+*/
        this.getContexts = commands_1.default.contextExtensions.getContexts;
        this.getCurrentContext = commands_1.default.contextExtensions.getCurrentContext;
        this.getWindowHandle = commands_1.default.contextExtensions.getWindowHandle;
        this.getWindowHandles = commands_1.default.contextExtensions.getWindowHandles;
        this.setContext = commands_1.default.contextExtensions.setContext;
        this.setWindow = commands_1.default.contextExtensions.setWindow;
        this.activateRecentWebview = commands_1.default.contextExtensions.activateRecentWebview;
        this.connectToRemoteDebugger = commands_1.default.contextExtensions.connectToRemoteDebugger;
        this.getContextsAndViews = commands_1.default.contextExtensions.getContextsAndViews;
        this.listWebFrames = commands_1.default.contextExtensions.listWebFrames;
        this.mobileGetContexts = commands_1.default.contextExtensions.mobileGetContexts;
        this.onPageChange = commands_1.default.contextExtensions.onPageChange;
        this.useNewSafari = commands_1.default.contextExtensions.useNewSafari;
        this.getCurrentUrl = commands_1.default.contextExtensions.getCurrentUrl;
        this.getNewRemoteDebugger = commands_1.default.contextExtensions.getNewRemoteDebugger;
        this.getRecentWebviewContextId = commands_1.default.contextExtensions.getRecentWebviewContextId;
        this.isWebContext = commands_1.default.contextExtensions.isWebContext;
        this.isWebview = commands_1.default.contextExtensions.isWebview;
        this.setCurrentUrl = commands_1.default.contextExtensions.setCurrentUrl;
        this.stopRemote = commands_1.default.contextExtensions.stopRemote;
        /*------------+
         | DEVICEINFO |
         +------------+*/
        this.mobileGetDeviceInfo = commands_1.default.deviceInfoExtensions.mobileGetDeviceInfo;
        /*---------+
         | ELEMENT |
         +---------+*/
        this.elementDisplayed = commands_1.default.elementExtensions.elementDisplayed;
        this.elementEnabled = commands_1.default.elementExtensions.elementEnabled;
        this.elementSelected = commands_1.default.elementExtensions.elementSelected;
        this.getName = commands_1.default.elementExtensions.getName;
        this.getNativeAttribute = commands_1.default.elementExtensions.getNativeAttribute;
        this.getAttribute = commands_1.default.elementExtensions.getAttribute;
        this.getProperty = commands_1.default.elementExtensions.getProperty;
        this.getText = commands_1.default.elementExtensions.getText;
        this.getElementRect = commands_1.default.elementExtensions.getElementRect;
        this.getLocation = commands_1.default.elementExtensions.getLocation;
        this.getLocationInView = commands_1.default.elementExtensions.getLocationInView;
        this.getSize = commands_1.default.elementExtensions.getSize;
        /** @deprecated */
        this.setValueImmediate = commands_1.default.elementExtensions.setValueImmediate;
        this.setValue = commands_1.default.elementExtensions.setValue;
        this.keys = commands_1.default.elementExtensions.keys;
        this.clear = commands_1.default.elementExtensions.clear;
        this.getContentSize = commands_1.default.elementExtensions.getContentSize;
        this.getNativeRect = commands_1.default.elementExtensions.getNativeRect;
        /*---------+
         | EXECUTE |
         +---------+*/
        this.receiveAsyncResponse = commands_1.default.executeExtensions.receiveAsyncResponse;
        this.execute = commands_1.default.executeExtensions.execute;
        this.executeAsync = commands_1.default.executeExtensions.executeAsync;
        this.executeMobile = commands_1.default.executeExtensions.executeMobile;
        /*--------------+
         | FILEMOVEMENT |
         +--------------+*/
        this.pushFile = commands_1.default.fileMovementExtensions.pushFile;
        this.mobilePushFile = commands_1.default.fileMovementExtensions.mobilePushFile;
        this.pullFile = commands_1.default.fileMovementExtensions.pullFile;
        this.mobilePullFile = commands_1.default.fileMovementExtensions.mobilePullFile;
        this.mobileDeleteFolder = commands_1.default.fileMovementExtensions.mobileDeleteFolder;
        this.mobileDeleteFile = commands_1.default.fileMovementExtensions.mobileDeleteFile;
        this.pullFolder = commands_1.default.fileMovementExtensions.pullFolder;
        this.mobilePullFolder = commands_1.default.fileMovementExtensions.mobilePullFolder;
        /*------+
         | FIND |
         +------+*/
        this.findElOrEls = commands_1.default.findExtensions.findElOrEls;
        this.findNativeElementOrElements = commands_1.default.findExtensions.findNativeElementOrElements;
        this.doNativeFind = commands_1.default.findExtensions.doNativeFind;
        this.getFirstVisibleChild = commands_1.default.findExtensions.getFirstVisibleChild;
        /*---------+
         | GENERAL |
         +---------+*/
        this.active = commands_1.default.generalExtensions.active;
        this.background = commands_1.default.appManagementExtensions.background;
        this.touchId = commands_1.default.generalExtensions.touchId;
        this.toggleEnrollTouchId = commands_1.default.generalExtensions.toggleEnrollTouchId;
        this.getWindowSize = commands_1.default.generalExtensions.getWindowSize;
        this.getDeviceTime = commands_1.default.generalExtensions.getDeviceTime;
        this.mobileGetDeviceTime = commands_1.default.generalExtensions.mobileGetDeviceTime;
        this.getWindowRect = commands_1.default.generalExtensions.getWindowRect;
        this.getStrings = commands_1.default.appStringsExtensions.getStrings;
        this.removeApp = commands_1.default.generalExtensions.removeApp;
        this.launchApp = commands_1.default.generalExtensions.launchApp;
        this.closeApp = commands_1.default.generalExtensions.closeApp;
        this.setUrl = commands_1.default.generalExtensions.setUrl;
        this.getViewportRect = commands_1.default.generalExtensions.getViewportRect;
        this.getScreenInfo = commands_1.default.generalExtensions.getScreenInfo;
        this.getStatusBarHeight = commands_1.default.generalExtensions.getStatusBarHeight;
        this.getDevicePixelRatio = commands_1.default.generalExtensions.getDevicePixelRatio;
        this.mobilePressButton = commands_1.default.generalExtensions.mobilePressButton;
        this.mobileSiriCommand = commands_1.default.generalExtensions.mobileSiriCommand;
        this.getWindowSizeWeb = commands_1.default.generalExtensions.getWindowSizeWeb;
        this.getWindowSizeNative = commands_1.default.generalExtensions.getWindowSizeNative;
        /*-------------+
         | GEOLOCATION |
         +-------------+*/
        this.mobileGetSimulatedLocation = commands_1.default.geolocationExtensions.mobileGetSimulatedLocation;
        this.mobileSetSimulatedLocation = commands_1.default.geolocationExtensions.mobileSetSimulatedLocation;
        this.mobileResetSimulatedLocation = commands_1.default.geolocationExtensions.mobileResetSimulatedLocation;
        /*---------+
         | GESTURE |
         +---------+*/
        this.mobileShake = commands_1.default.gestureExtensions.mobileShake;
        this.click = commands_1.default.gestureExtensions.click;
        this.releaseActions = commands_1.default.gestureExtensions.releaseActions;
        this.performActions = commands_1.default.gestureExtensions.performActions;
        this.performTouch = commands_1.default.gestureExtensions.performTouch;
        this.performMultiAction = commands_1.default.gestureExtensions.performMultiAction;
        this.nativeClick = commands_1.default.gestureExtensions.nativeClick;
        this.mobileScrollToElement = commands_1.default.gestureExtensions.mobileScrollToElement;
        this.mobileScroll = commands_1.default.gestureExtensions.mobileScroll;
        this.mobileSwipe = commands_1.default.gestureExtensions.mobileSwipe;
        this.mobilePinch = commands_1.default.gestureExtensions.mobilePinch;
        this.mobileDoubleTap = commands_1.default.gestureExtensions.mobileDoubleTap;
        this.mobileTwoFingerTap = commands_1.default.gestureExtensions.mobileTwoFingerTap;
        this.mobileTouchAndHold = commands_1.default.gestureExtensions.mobileTouchAndHold;
        this.mobileTap = commands_1.default.gestureExtensions.mobileTap;
        this.mobileDragFromToForDuration = commands_1.default.gestureExtensions.mobileDragFromToForDuration;
        this.mobileDragFromToWithVelocity = commands_1.default.gestureExtensions.mobileDragFromToWithVelocity;
        this.mobileTapWithNumberOfTaps = commands_1.default.gestureExtensions.mobileTapWithNumberOfTaps;
        this.mobileForcePress = commands_1.default.gestureExtensions.mobileForcePress;
        this.mobileSelectPickerWheelValue = commands_1.default.gestureExtensions.mobileSelectPickerWheelValue;
        this.mobileRotateElement = commands_1.default.gestureExtensions.mobileRotateElement;
        this.getCoordinates = commands_1.default.gestureExtensions.getCoordinates;
        /*-------+
         | IOHID |
         +-------+*/
        this.mobilePerformIoHidEvent = commands_1.default.iohidExtensions.mobilePerformIoHidEvent;
        /*-----------+
         | KEYCHAINS |
         +-----------+*/
        this.mobileClearKeychains = commands_1.default.keychainsExtensions.mobileClearKeychains;
        /*----------+
         | KEYBOARD |
         +----------+*/
        this.hideKeyboard = commands_1.default.keyboardExtensions.hideKeyboard;
        this.mobileHideKeyboard = commands_1.default.keyboardExtensions.mobileHideKeyboard;
        this.isKeyboardShown = commands_1.default.keyboardExtensions.isKeyboardShown;
        /*--------------+
         | LOCALIZATION |
         +--------------+*/
        this.mobileConfigureLocalization = commands_1.default.localizationExtensions.mobileConfigureLocalization;
        /*----------+
         | LOCATION |
         +----------+*/
        this.getGeoLocation = commands_1.default.locationExtensions.getGeoLocation;
        this.setGeoLocation = commands_1.default.locationExtensions.setGeoLocation;
        this.mobileResetLocationService = commands_1.default.locationExtensions.mobileResetLocationService;
        /*------+
         | LOCK |
         +------+*/
        this.lock = commands_1.default.lockExtensions.lock;
        this.unlock = commands_1.default.lockExtensions.unlock;
        this.isLocked = commands_1.default.lockExtensions.isLocked;
        /*-----+
         | LOG |
         +-----+*/
        this.extractLogs = commands_1.default.logExtensions.extractLogs;
        this.supportedLogTypes = commands_1.default.logExtensions.supportedLogTypes;
        this.startLogCapture = commands_1.default.logExtensions.startLogCapture;
        this.mobileStartLogsBroadcast = commands_1.default.logExtensions.mobileStartLogsBroadcast;
        this.mobileStopLogsBroadcast = commands_1.default.logExtensions.mobileStopLogsBroadcast;
        /*------------+
         | NAVIGATION |
         +------------+*/
        this.back = commands_1.default.navigationExtensions.back;
        this.forward = commands_1.default.navigationExtensions.forward;
        this.closeWindow = commands_1.default.navigationExtensions.closeWindow;
        this.nativeBack = commands_1.default.navigationExtensions.nativeBack;
        this.mobileDeepLink = commands_1.default.navigationExtensions.mobileDeepLink;
        /*---------------+
         | NOTIFICATIONS |
         +---------------+*/
        this.mobilePushNotification = commands_1.default.notificationsExtensions.mobilePushNotification;
        this.mobileExpectNotification = commands_1.default.notificationsExtensions.mobileExpectNotification;
        /*------------+
         | PASTEBOARD |
         +------------+*/
        this.mobileSetPasteboard = commands_1.default.pasteboardExtensions.mobileSetPasteboard;
        this.mobileGetPasteboard = commands_1.default.pasteboardExtensions.mobileGetPasteboard;
        /*------+
         | PCAP |
         +------+*/
        this.mobileStartPcap = commands_1.default.pcapExtensions.mobileStartPcap;
        this.mobileStopPcap = commands_1.default.pcapExtensions.mobileStopPcap;
        /*-------------+
         | PERFORMANCE |
         +-------------+*/
        this.mobileStartPerfRecord = commands_1.default.performanceExtensions.mobileStartPerfRecord;
        this.mobileStopPerfRecord = commands_1.default.performanceExtensions.mobileStopPerfRecord;
        /*-------------+
         | PERMISSIONS |
         +-------------+*/
        this.mobileResetPermission = commands_1.default.permissionsExtensions.mobileResetPermission;
        this.mobileGetPermission = commands_1.default.permissionsExtensions.mobileGetPermission;
        this.mobileSetPermissions = commands_1.default.permissionsExtensions.mobileSetPermissions;
        /*-------------+
         | PROXYHELPER |
         +-------------+*/
        this.proxyCommand = commands_1.default.proxyHelperExtensions.proxyCommand;
        /*-------------+
         | RECORDAUDIO |
         +-------------+*/
        this.startAudioRecording = commands_1.default.recordAudioExtensions.startAudioRecording;
        this.stopAudioRecording = commands_1.default.recordAudioExtensions.stopAudioRecording;
        /*--------------+
         | RECORDSCREEN |
         +--------------+*/
        this._recentScreenRecorder = commands_1.default.recordScreenExtensions._recentScreenRecorder;
        this.startRecordingScreen = commands_1.default.recordScreenExtensions.startRecordingScreen;
        this.stopRecordingScreen = commands_1.default.recordScreenExtensions.stopRecordingScreen;
        /*-------------+
         | SCREENSHOTS |
         +-------------+*/
        this.getScreenshot = commands_1.default.screenshotExtensions.getScreenshot;
        this.getElementScreenshot = commands_1.default.screenshotExtensions.getElementScreenshot;
        this.getViewportScreenshot = commands_1.default.screenshotExtensions.getViewportScreenshot;
        /*--------+
         | SOURCE |
         +--------+*/
        this.getPageSource = commands_1.default.sourceExtensions.getPageSource;
        this.mobileGetSource = commands_1.default.sourceExtensions.mobileGetSource;
        /*----------+
         | TIMEOUTS |
         +----------+*/
        this.pageLoadTimeoutW3C = commands_1.default.timeoutExtensions.pageLoadTimeoutW3C;
        this.pageLoadTimeoutMJSONWP = commands_1.default.timeoutExtensions.pageLoadTimeoutMJSONWP;
        this.scriptTimeoutW3C = commands_1.default.timeoutExtensions.scriptTimeoutW3C;
        this.scriptTimeoutMJSONWP = commands_1.default.timeoutExtensions.scriptTimeoutMJSONWP;
        this.asyncScriptTimeout = commands_1.default.timeoutExtensions.asyncScriptTimeout;
        this.setPageLoadTimeout = commands_1.default.timeoutExtensions.setPageLoadTimeout;
        this.setAsyncScriptTimeout = commands_1.default.timeoutExtensions.setAsyncScriptTimeout;
        /*-----+
         | WEB |
         +-----+*/
        this.setFrame = commands_1.default.webExtensions.setFrame;
        this.getCssProperty = commands_1.default.webExtensions.getCssProperty;
        this.submit = commands_1.default.webExtensions.submit;
        this.refresh = commands_1.default.webExtensions.refresh;
        this.getUrl = commands_1.default.webExtensions.getUrl;
        this.title = commands_1.default.webExtensions.title;
        this.getCookies = commands_1.default.webExtensions.getCookies;
        this.setCookie = commands_1.default.webExtensions.setCookie;
        this.deleteCookie = commands_1.default.webExtensions.deleteCookie;
        this.deleteCookies = commands_1.default.webExtensions.deleteCookies;
        this._deleteCookie = commands_1.default.webExtensions._deleteCookie;
        this.cacheWebElement = commands_1.default.webExtensions.cacheWebElement;
        this.cacheWebElements = commands_1.default.webExtensions.cacheWebElements;
        this.executeAtom = commands_1.default.webExtensions.executeAtom;
        this.executeAtomAsync = commands_1.default.webExtensions.executeAtomAsync;
        this.getAtomsElement = commands_1.default.webExtensions.getAtomsElement;
        this.convertElementsForAtoms = commands_1.default.webExtensions.convertElementsForAtoms;
        this.getElementId = commands_1.default.webExtensions.getElementId;
        this.hasElementId = commands_1.default.webExtensions.hasElementId;
        this.findWebElementOrElements = commands_1.default.webExtensions.findWebElementOrElements;
        this.clickWebCoords = commands_1.default.webExtensions.clickWebCoords;
        this.getSafariIsIphone = commands_1.default.webExtensions.getSafariIsIphone;
        this.getSafariDeviceSize = commands_1.default.webExtensions.getSafariDeviceSize;
        this.getSafariIsNotched = commands_1.default.webExtensions.getSafariIsNotched;
        this.getExtraTranslateWebCoordsOffset = commands_1.default.webExtensions.getExtraTranslateWebCoordsOffset;
        this.getExtraNativeWebTapOffset = commands_1.default.webExtensions.getExtraNativeWebTapOffset;
        this.nativeWebTap = commands_1.default.webExtensions.nativeWebTap;
        this.translateWebCoords = commands_1.default.webExtensions.translateWebCoords;
        this.checkForAlert = commands_1.default.webExtensions.checkForAlert;
        this.waitForAtom = commands_1.default.webExtensions.waitForAtom;
        this.mobileWebNav = commands_1.default.webExtensions.mobileWebNav;
        this.getWdaLocalhostRoot = commands_1.default.webExtensions.getWdaLocalhostRoot;
        this.mobileCalibrateWebToRealCoordinatesTranslation = commands_1.default.webExtensions.mobileCalibrateWebToRealCoordinatesTranslation;
        this.mobileUpdateSafariPreferences = commands_1.default.webExtensions.mobileUpdateSafariPreferences;
        /*--------+
         | XCTEST |
         +--------+*/
        this.mobileRunXCTest = commands_1.default.xctestExtensions.mobileRunXCTest;
        this.mobileInstallXCTestBundle = commands_1.default.xctestExtensions.mobileInstallXCTestBundle;
        this.mobileListXCTestBundles = commands_1.default.xctestExtensions.mobileListXCTestBundles;
        this.mobileListXCTestsInTestBundle = commands_1.default.xctestExtensions.mobileListXCTestsInTestBundle;
        this.locatorStrategies = [
            'xpath',
            'id',
            'name',
            'class name',
            '-ios predicate string',
            '-ios class chain',
            'accessibility id',
            'css selector',
        ];
        this.webLocatorStrategies = [
            'link text',
            'css selector',
            'tag name',
            'link text',
            'partial link text',
        ];
        this.curWebFrames = [];
        this._perfRecorders = [];
        this.desiredCapConstraints = desired_caps_1.desiredCapConstraints;
        this.webElementsCache = new lru_cache_1.LRUCache({
            max: WEB_ELEMENTS_CACHE_SIZE,
        });
        this.webviewCalibrationResult = null;
        this._waitingAtoms = {
            count: 0,
            alertNotifier: new node_events_1.default(),
            alertMonitor: bluebird_1.default.resolve(),
        };
        this.resetIos();
        this.settings = new driver_1.DeviceSettings(DEFAULT_SETTINGS, this.onSettingsUpdate.bind(this));
        this.logs = {};
        this._trafficCapture = null;
        // memoize functions here, so that they are done on a per-instance basis
        for (const fn of MEMOIZED_FUNCTIONS) {
            this[fn] = lodash_1.default.memoize(this[fn]);
        }
        this.lifecycleData = {};
        this._audioRecorder = null;
    }
    async onSettingsUpdate(key, value) {
        // skip sending the update request to the WDA nor saving it in opts
        // to not spend unnecessary time.
        if (['pageSourceExcludedAttributes'].includes(key)) {
            return;
        }
        if (key !== 'nativeWebTap' && key !== 'nativeWebTapStrict') {
            return await this.proxyCommand('/appium/settings', 'POST', {
                settings: { [key]: value },
            });
        }
        this.opts[key] = !!value;
    }
    resetIos() {
        this.opts = this.opts || {};
        this.wda = null;
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        this.opts.device = null;
        this.jwpProxyActive = false;
        this.proxyReqRes = null;
        this.safari = false;
        this.cachedWdaStatus = null;
        this.curWebFrames = [];
        this._currentUrl = null;
        this.curContext = null;
        this.xcodeVersion = undefined;
        this.contexts = [];
        this.implicitWaitMs = 0;
        this.pageLoadMs = 6000;
        this.landscapeWebCoordsOffset = 0;
        this.remote = null;
        this._conditionInducerService = null;
        this.webElementsCache = new lru_cache_1.LRUCache({
            max: WEB_ELEMENTS_CACHE_SIZE,
        });
        this._waitingAtoms = {
            count: 0,
            alertNotifier: new node_events_1.default(),
            alertMonitor: bluebird_1.default.resolve(),
        };
    }
    get driverData() {
        // TODO fill out resource info here
        return {};
    }
    async getStatus() {
        const status = {
            ready: true,
            message: 'The driver is ready to accept new connections',
            build: await (0, utils_1.getDriverInfo)(),
        };
        if (this.cachedWdaStatus) {
            status.wda = this.cachedWdaStatus;
        }
        return status;
    }
    mergeCliArgsToOpts() {
        let didMerge = false;
        // this.cliArgs should never include anything we do not expect.
        for (const [key, value] of Object.entries(this.cliArgs ?? {})) {
            if (lodash_1.default.has(this.opts, key)) {
                this.log.info(`CLI arg '${key}' with value '${value}' overwrites value '${this.opts[key]}' sent in via caps)`);
                didMerge = true;
            }
            this.opts[key] = value;
        }
        return didMerge;
    }
    isXcodebuildNeeded() {
        return !(this.opts.webDriverAgentUrl || this.opts.usePreinstalledWDA);
    }
    async createSession(w3cCaps1, w3cCaps2, w3cCaps3, driverData) {
        try {
            let [sessionId, caps] = await super.createSession(w3cCaps1, w3cCaps2, w3cCaps3, driverData);
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            this.opts.sessionId = sessionId;
            // merge cli args to opts, and if we did merge any, revalidate opts to ensure the final set
            // is also consistent
            if (this.mergeCliArgsToOpts()) {
                this.validateDesiredCaps({ ...caps, ...this.cliArgs });
            }
            await this.start();
            // merge server capabilities + desired capabilities
            caps = Object.assign({}, defaultServerCaps, caps);
            // update the udid with what is actually used
            caps.udid = this.opts.udid;
            // ensure we track nativeWebTap capability as a setting as well
            if (lodash_1.default.has(this.opts, 'nativeWebTap')) {
                await this.updateSettings({ nativeWebTap: this.opts.nativeWebTap });
            }
            // ensure we track nativeWebTapStrict capability as a setting as well
            if (lodash_1.default.has(this.opts, 'nativeWebTapStrict')) {
                await this.updateSettings({ nativeWebTapStrict: this.opts.nativeWebTapStrict });
            }
            // ensure we track useJSONSource capability as a setting as well
            if (lodash_1.default.has(this.opts, 'useJSONSource')) {
                await this.updateSettings({ useJSONSource: this.opts.useJSONSource });
            }
            /** @type {import('./types').WDASettings} */
            let wdaSettings = {
                elementResponseAttributes: DEFAULT_SETTINGS.elementResponseAttributes,
                shouldUseCompactResponses: DEFAULT_SETTINGS.shouldUseCompactResponses,
            };
            if (lodash_1.default.has(this.opts, 'elementResponseAttributes')) {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                wdaSettings.elementResponseAttributes = this.opts.elementResponseAttributes;
            }
            if (lodash_1.default.has(this.opts, 'shouldUseCompactResponses')) {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                wdaSettings.shouldUseCompactResponses = this.opts.shouldUseCompactResponses;
            }
            if (lodash_1.default.has(this.opts, 'mjpegServerScreenshotQuality')) {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                wdaSettings.mjpegServerScreenshotQuality = this.opts.mjpegServerScreenshotQuality;
            }
            if (lodash_1.default.has(this.opts, 'mjpegServerFramerate')) {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                wdaSettings.mjpegServerFramerate = this.opts.mjpegServerFramerate;
            }
            if (lodash_1.default.has(this.opts, 'screenshotQuality')) {
                this.log.info(`Setting the quality of phone screenshot: '${this.opts.screenshotQuality}'`);
                wdaSettings.screenshotQuality = this.opts.screenshotQuality;
            }
            // ensure WDA gets our defaults instead of whatever its own might be
            await this.updateSettings(wdaSettings);
            // turn on mjpeg stream reading if requested
            if (this.opts.mjpegScreenshotUrl) {
                this.log.info(`Starting MJPEG stream reading URL: '${this.opts.mjpegScreenshotUrl}'`);
                this.mjpegStream = new support_1.mjpeg.MJpegStream(this.opts.mjpegScreenshotUrl);
                await this.mjpegStream.start();
            }
            return /** @type {[string, import('@appium/types').DriverCaps<XCUITestDriverConstraints>]} */ ([
                sessionId,
                caps,
            ]);
        }
        catch (e) {
            this.log.error(JSON.stringify(e));
            await this.deleteSession();
            throw e;
        }
    }
    /**
     * Returns the default URL for Safari browser
     * @returns {string} The default URL
     */
    getDefaultUrl() {
        // Setting this to some external URL slows down the session init
        return `${this.getWdaLocalhostRoot()}/health`;
    }
    async start() {
        this.opts.noReset = !!this.opts.noReset;
        this.opts.fullReset = !!this.opts.fullReset;
        await (0, utils_1.printUser)();
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        this.opts.iosSdkVersion = null; // For WDA and xcodebuild
        const { device, udid, realDevice } = await this.determineDevice();
        this.log.info(`Determining device to run tests on: udid: '${udid}', real device: ${realDevice}`);
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        this.opts.device = device;
        this.opts.udid = udid;
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        this.opts.realDevice = realDevice;
        if (this.opts.simulatorDevicesSetPath) {
            if (realDevice) {
                this.log.info(`The 'simulatorDevicesSetPath' capability is only supported for Simulator devices`);
            }
            else {
                this.log.info(`Setting simulator devices set path to '${this.opts.simulatorDevicesSetPath}'`);
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                this.opts.device.devicesSetPath = this.opts.simulatorDevicesSetPath;
            }
        }
        // at this point if there is no platformVersion, get it from the device
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        if (!this.opts.platformVersion && this.opts.device) {
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            this.opts.platformVersion = await this.opts.device.getPlatformVersion();
            this.log.info(`No platformVersion specified. Using device version: '${this.opts.platformVersion}'`);
        }
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        const normalizedVersion = (0, utils_1.normalizePlatformVersion)(this.opts.platformVersion);
        if (this.opts.platformVersion !== normalizedVersion) {
            this.log.info(`Normalized platformVersion capability value '${this.opts.platformVersion}' to '${normalizedVersion}'`);
            this.opts.platformVersion = normalizedVersion;
        }
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        if (lodash_1.default.isEmpty(this.xcodeVersion) && (this.isXcodebuildNeeded() || !this.opts.realDevice)) {
            // no `webDriverAgentUrl`, or on a simulator, so we need an Xcode version
            this.xcodeVersion = await (0, utils_1.getAndCheckXcodeVersion)();
        }
        this.logEvent('xcodeDetailsRetrieved');
        if (lodash_1.default.toLower(this.opts.browserName) === 'safari') {
            this.log.info('Safari test requested');
            this.safari = true;
            this.opts.app = undefined;
            this.opts.processArguments = this.opts.processArguments || {};
            this.opts.bundleId = app_utils_1.SAFARI_BUNDLE_ID;
            this._currentUrl = this.opts.safariInitialUrl || this.getDefaultUrl();
        }
        else if (this.opts.app || this.opts.bundleId) {
            await this.configureApp();
        }
        this.logEvent('appConfigured');
        // fail very early if the app doesn't actually exist
        // or if bundle id doesn't point to an installed app
        if (this.opts.app) {
            await (0, utils_1.checkAppPresent)(this.opts.app);
            if (!this.opts.bundleId) {
                this.opts.bundleId = await app_utils_1.extractBundleId.bind(this)(this.opts.app);
            }
        }
        await this.runReset();
        this.wda = new appium_webdriveragent_1.WebDriverAgent(
        /** @type {import('appium-xcode').XcodeVersion} */ (this.xcodeVersion), this.opts, this.log);
        // Derived data path retrieval is an expensive operation
        // We could start that now in background and get the cached result
        // whenever it is needed
        // eslint-disable-next-line promise/prefer-await-to-then
        this.wda.retrieveDerivedDataPath().catch((e) => this.log.debug(e));
        const memoizedLogInfo = lodash_1.default.memoize(() => {
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
            await this.initSimulator();
            if (!isLogCaptureStarted) {
                // Retry log capture if Simulator was not running before
                await startLogCapture();
            }
        }
        else if (this.opts.customSSLCert) {
            await new py_ios_device_client_1.default(udid).installProfile({ payload: this.opts.customSSLCert });
            this.logEvent('customCertInstalled');
        }
        await this.installAUT();
        // if we only have bundle identifier and no app, fail if it is not already installed
        if (!this.opts.app &&
            this.opts.bundleId &&
            !this.isSafari() &&
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            !(await this.opts.device.isAppInstalled(this.opts.bundleId))) {
            this.log.errorAndThrow(`App with bundle identifier '${this.opts.bundleId}' unknown`);
        }
        if (this.isSimulator()) {
            if (this.opts.permissions) {
                this.log.debug('Setting the requested permissions before WDA is started');
                for (const [bundleId, permissionsMapping] of lodash_1.default.toPairs(JSON.parse(this.opts.permissions))) {
                    // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                    await this.opts.device.setPermissions(bundleId, permissionsMapping);
                }
            }
            // TODO: Deprecate and remove this block together with calendarAccessAuthorized capability
            if (lodash_1.default.isBoolean(this.opts.calendarAccessAuthorized)) {
                this.log.warn(`The 'calendarAccessAuthorized' capability is deprecated and will be removed soon. ` +
                    `Consider using 'permissions' one instead with 'calendar' key`);
                const methodName = `${this.opts.calendarAccessAuthorized ? 'enable' : 'disable'}CalendarAccess`;
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                await this.opts.device[methodName](this.opts.bundleId);
            }
        }
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        await this.startWda(this.opts.sessionId, realDevice);
        if (this.opts.orientation) {
            await this.setInitialOrientation(this.opts.orientation);
            this.logEvent('orientationSet');
        }
        if (this.isSafari() || this.opts.autoWebview) {
            await this.activateRecentWebview();
        }
        if (this.isSafari()) {
            if (!(this.opts.safariInitialUrl === '' ||
                (this.opts.noReset && lodash_1.default.isNil(this.opts.safariInitialUrl)))) {
                this.log.info(`About to set the initial Safari URL to '${this.getCurrentUrl()}'.` +
                    `Use 'safariInitialUrl' capability in order to customize it`);
                await this.setUrl(this.getCurrentUrl());
            }
            else {
                this.setCurrentUrl(await this.getUrl());
            }
        }
    }
    /**
     * Start the simulator and initialize based on capabilities
     */
    async initSimulator() {
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        const device = this.opts.device;
        if (this.opts.shutdownOtherSimulators) {
            this.ensureFeatureEnabled(SHUTDOWN_OTHER_FEAT_NAME);
            await (0, simulator_management_1.shutdownOtherSimulators)(device);
        }
        await this.startSim();
        if (this.opts.customSSLCert) {
            // Simulator must be booted in order to call this helper
            await device.addCertificate(this.opts.customSSLCert);
            this.logEvent('customCertInstalled');
        }
        if (await (0, simulator_management_1.setSafariPrefs)(device, this.opts)) {
            this.log.debug('Safari preferences have been updated');
        }
        if (await (0, simulator_management_1.setLocalizationPrefs)(device, this.opts)) {
            this.log.debug('Localization preferences have been updated');
        }
        const promises = ['reduceMotion', 'reduceTransparency', 'autoFillPasswords']
            .filter((optName) => lodash_1.default.isBoolean(this.opts[optName]))
            .map((optName) => device[`set${lodash_1.default.upperFirst(optName)}`](this.opts[optName]));
        await bluebird_1.default.all(promises);
        if (this.opts.launchWithIDB) {
            try {
                const idb = new appium_idb_1.default({ udid: this.opts.udid });
                await idb.connect();
                device.idb = idb;
            }
            catch (e) {
                this.log.debug(e.stack);
                this.log.warn(`idb will not be used for Simulator interaction. Original error: ${e.message}`);
            }
        }
        this.logEvent('simStarted');
    }
    /**
     * Start WebDriverAgentRunner
     * @param {string} sessionId - The id of the target session to launch WDA with.
     * @param {boolean} realDevice - Equals to true if the test target device is a real device.
     */
    async startWda(sessionId, realDevice) {
        // Don't cleanup the processes if webDriverAgentUrl is set
        if (!support_1.util.hasValue(this.wda.webDriverAgentUrl)) {
            await this.wda.cleanupObsoleteProcesses();
        }
        const usePortForwarding = this.isRealDevice() && !this.wda.webDriverAgentUrl && (0, utils_1.isLocalHost)(this.wda.wdaBaseUrl);
        await device_connections_factory_1.default.requestConnection(this.opts.udid, this.wda.url.port, {
            devicePort: usePortForwarding ? this.wda.wdaRemotePort : null,
            usePortForwarding,
        });
        // Let multiple WDA binaries with different derived data folders be built in parallel
        // Concurrent WDA builds from the same source will cause xcodebuild synchronization errors
        let synchronizationKey = XCUITestDriver.name;
        if (this.opts.useXctestrunFile || !(await this.wda.isSourceFresh())) {
            // First-time compilation is an expensive operation, which is done faster if executed
            // sequentially. Xcodebuild spreads the load caused by the clang compiler to all available CPU cores
            const derivedDataPath = await this.wda.retrieveDerivedDataPath();
            if (derivedDataPath) {
                synchronizationKey = node_path_1.default.normalize(derivedDataPath);
            }
        }
        this.log.debug(`Starting WebDriverAgent initialization with the synchronization key '${synchronizationKey}'`);
        if (SHARED_RESOURCES_GUARD.isBusy() && !this.opts.derivedDataPath && !this.opts.bootstrapPath) {
            this.log.debug(`Consider setting a unique 'derivedDataPath' capability value for each parallel driver instance ` +
                `to avoid conflicts and speed up the building process`);
        }
        if (this.opts.usePreinstalledWDA) {
            if (!this.isRealDevice()) {
                throw new Error(`'usePreinstalledWDA' capability is only supported for real devices. ` +
                    `'useXctestrunFile' or 'usePrebuiltWDA' may help to get similar errort on Simulators.`);
            }
            // below will be only for real devices if the caps has "this.opts.usePreinstalledWDA"
            if (this.opts.prebuiltWDAPath && !(await support_1.fs.exists(this.opts.prebuiltWDAPath))) {
                throw new Error(`'${this.opts.prebuiltWDAPath}' provided as 'prebuiltWDAPath' capability did not exist. ` +
                    `Please make sure if the path exits at the given path.`);
            }
        }
        return await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
            if (this.opts.useNewWDA) {
                this.log.debug(`Capability 'useNewWDA' set to true, so uninstalling WDA before proceeding`);
                await this.wda.quitAndUninstall();
                this.logEvent('wdaUninstalled');
            }
            else if (!support_1.util.hasValue(this.wda.webDriverAgentUrl) && this.isXcodebuildNeeded()) {
                await this.wda.setupCaching();
            }
            // local helper for the two places we need to uninstall wda and re-start it
            const quitAndUninstall = async (msg) => {
                this.log.debug(msg);
                if (this.opts.webDriverAgentUrl) {
                    this.log.debug('Not quitting/uninstalling WebDriverAgent since webDriverAgentUrl capability is provided');
                    throw new Error(msg);
                }
                else if (this.opts.usePreinstalledWDA) {
                    this.log.debug('Not uninstalling WebDriverAgent since this.opts.usePreinstalledWDA capability is provided');
                    throw new Error(msg);
                }
                this.log.warn('Quitting and uninstalling WebDriverAgent');
                await this.wda.quitAndUninstall();
                throw new Error(msg);
            };
            // Used in the following WDA build
            if (this.opts.resultBundlePath) {
                this.ensureFeatureEnabled(CUSTOMIZE_RESULT_BUNDPE_PATH);
            }
            const startupRetries = this.opts.wdaStartupRetries ||
                (this.isRealDevice() ? WDA_REAL_DEV_STARTUP_RETRIES : WDA_SIM_STARTUP_RETRIES);
            const startupRetryInterval = this.opts.wdaStartupRetryInterval || WDA_STARTUP_RETRY_INTERVAL;
            this.log.debug(`Trying to start WebDriverAgent ${startupRetries} times with ${startupRetryInterval}ms interval`);
            if (!support_1.util.hasValue(this.opts.wdaStartupRetries) &&
                !support_1.util.hasValue(this.opts.wdaStartupRetryInterval)) {
                this.log.debug(`These values can be customized by changing wdaStartupRetries/wdaStartupRetryInterval capabilities`);
            }
            let retryCount = 0;
            await (0, asyncbox_1.retryInterval)(startupRetries, startupRetryInterval, async () => {
                this.logEvent('wdaStartAttempted');
                if (retryCount > 0) {
                    this.log.info(`Retrying WDA startup (${retryCount + 1} of ${startupRetries})`);
                }
                try {
                    if (this.opts.usePreinstalledWDA) {
                        // Stop the existing process before starting a new one to start a fresh WDA process every session.
                        await this.mobileKillApp(this.wda.bundleIdForXctest);
                        if (this.opts.prebuiltWDAPath) {
                            const candidateBundleId = await app_utils_1.extractBundleId.bind(this)(this.opts.prebuiltWDAPath);
                            this.wda.updatedWDABundleId = candidateBundleId.replace('.xctrunner', '');
                            this.log.info(`Installing prebuilt WDA ${this.opts.prebuiltWDAPath}`);
                            // Note: The CFBundleVersion in the test bundle was always 1.
                            // It may not be able to compare with the installed versio.
                            await (0, real_device_management_1.installToRealDevice)(
                            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                            this.opts.device, this.opts.prebuiltWDAPath, candidateBundleId, {
                                skipUninstall: true,
                                timeout: this.opts.appPushTimeout,
                                strategy: this.opts.appInstallStrategy,
                            });
                        }
                    }
                    // Over Xcode 10 will often try to access the app from its staging
                    // directory before fully moving it there, and fail. Retrying once
                    // immediately helps
                    this.cachedWdaStatus = await (0, asyncbox_1.retry)(2, this.wda.launch.bind(this.wda), sessionId, realDevice);
                }
                catch (err) {
                    this.logEvent('wdaStartFailed');
                    retryCount++;
                    let errorMsg = `Unable to launch WebDriverAgent because of xcodebuild failure: ${err.message}`;
                    if (this.isRealDevice()) {
                        errorMsg +=
                            `. Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` +
                                `Try to remove the WebDriverAgentRunner application from the device if it is installed ` +
                                `and reboot the device.`;
                    }
                    if (this.opts.usePreinstalledWDA) {
                        // In case the bundle id process start got failed because of
                        // auth popup in the device. Then, the bundle id process itself started. It is safe to stop it here.
                        await this.mobileKillApp(this.wda.bundleIdForXctest);
                        // Mostly it failed to start the WDA process as no the bundle id
                        // e.g. '<bundle id of WDA> not found on device <udid>'
                        throw new Error(`Unable to launch WebDriverAgent because of failure: ${err.message}. ` +
                            `Please make sure if the ${this.wda.bundleIdForXctest} exists and it is launchable. ` +
                            `${WDA_REAL_DEV_TUTORIAL_URL} may help to complete the preparation.`);
                    }
                    else {
                        await quitAndUninstall(errorMsg);
                    }
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
                    await (0, asyncbox_1.retryInterval)(15, 1000, async () => {
                        this.logEvent('wdaSessionAttempted');
                        this.log.debug('Sending createSession command to WDA');
                        try {
                            this.cachedWdaStatus =
                                this.cachedWdaStatus || (await this.proxyCommand('/status', 'GET'));
                            await this.startWdaSession(this.opts.bundleId, this.opts.processArguments);
                        }
                        catch (err) {
                            originalStacktrace = err.stack;
                            this.log.debug(`Failed to create WDA session (${err.message}). Retrying...`);
                            throw err;
                        }
                    });
                    this.logEvent('wdaSessionStarted');
                }
                catch (err) {
                    if (originalStacktrace) {
                        this.log.debug(originalStacktrace);
                    }
                    let errorMsg = `Unable to start WebDriverAgent session because of xcodebuild failure: ${err.message}`;
                    if (this.isRealDevice()) {
                        errorMsg +=
                            ` Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` +
                                `Try to remove the WebDriverAgentRunner application from the device if it is installed ` +
                                `and reboot the device.`;
                    }
                    await quitAndUninstall(errorMsg);
                }
                if (this.opts.clearSystemFiles && this.isXcodebuildNeeded()) {
                    await (0, utils_1.markSystemFilesForCleanup)(this.wda);
                }
                // we expect certain socket errors until this point, but now
                // mark things as fully working
                this.wda.fullyStarted = true;
                this.logEvent('wdaStarted');
            });
        });
    }
    /**
     *
     * @param {XCUITestDriverOpts} [opts]
     */
    async runReset(opts) {
        this.logEvent('resetStarted');
        if (this.isRealDevice()) {
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            await (0, real_device_management_1.runRealDeviceReset)(this.opts.device, opts || this.opts);
        }
        else {
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            await (0, simulator_management_1.runSimulatorReset)(this.opts.device, opts || this.opts);
        }
        this.logEvent('resetComplete');
    }
    async deleteSession() {
        await (0, utils_1.removeAllSessionWebSocketHandlers)(this.server, this.sessionId);
        for (const recorder of lodash_1.default.compact([
            this._recentScreenRecorder,
            this._audioRecorder,
            this._trafficCapture,
        ])) {
            await recorder.interrupt(true);
            await recorder.cleanup();
        }
        if (!lodash_1.default.isEmpty(this._perfRecorders)) {
            await bluebird_1.default.all(this._perfRecorders.map((x) => x.stop(true)));
            this._perfRecorders = [];
        }
        if (this._conditionInducerService) {
            this.disableConditionInducer();
        }
        await this.stop();
        if (this.wda && this.isXcodebuildNeeded()) {
            if (this.opts.clearSystemFiles) {
                let synchronizationKey = XCUITestDriver.name;
                const derivedDataPath = await this.wda.retrieveDerivedDataPath();
                if (derivedDataPath) {
                    synchronizationKey = node_path_1.default.normalize(derivedDataPath);
                }
                await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
                    await (0, utils_1.clearSystemFiles)(this.wda);
                });
            }
            else {
                this.log.debug('Not clearing log files. Use `clearSystemFiles` capability to turn on.');
            }
        }
        if (this.remote) {
            this.log.debug('Found a remote debugger session. Removing...');
            await this.stopRemote();
        }
        if (this.opts.resetOnSessionStartOnly === false) {
            await this.runReset(Object.assign({}, this.opts, {
                enforceSimulatorShutdown: true,
            }));
        }
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        const simulatorDevice = this.isSimulator() ? this.opts.device : null;
        if (simulatorDevice && this.lifecycleData.createSim) {
            this.log.debug(`Deleting simulator created for this run (udid: '${simulatorDevice.udid}')`);
            await (0, simulator_management_1.shutdownSimulator)(simulatorDevice);
            await simulatorDevice.delete();
        }
        const shouldResetLocationServivce = this.isRealDevice() && !!this.opts.resetLocationService;
        if (shouldResetLocationServivce) {
            try {
                await this.mobileResetLocationService();
            }
            catch (ignore) {
                /* Ignore this error since mobileResetLocationService already logged the error */
            }
        }
        if (!lodash_1.default.isEmpty(this.logs)) {
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
                }
                catch (err) {
                    // an error here should not short-circuit the rest of clean up
                    this.log.debug(`Unable to DELETE session on WDA: '${err.message}'. Continuing shutdown.`);
                }
            }
            // The former could cache the xcodebuild, so should not quit the process.
            // If the session skiped the xcodebuild (this.wda.canSkipXcodebuild), the this.wda instance
            // should quit properly.
            if ((!this.wda.webDriverAgentUrl && this.opts.useNewWDA) || this.wda.canSkipXcodebuild) {
                await this.wda.quit();
            }
        }
        device_connections_factory_1.default.releaseConnection(this.opts.udid);
    }
    /**
     *
     * @param {string} cmd
     * @param {...any} args
     * @returns {Promise<any>}
     */
    async executeCommand(cmd, ...args) {
        this.log.debug(`Executing command '${cmd}'`);
        if (cmd === 'receiveAsyncResponse') {
            return await this.receiveAsyncResponse(...args);
        }
        // TODO: once this fix gets into base driver remove from here
        if (cmd === 'getStatus') {
            return await this.getStatus();
        }
        return await super.executeCommand(cmd, ...args);
    }
    async configureApp() {
        function appIsPackageOrBundle(app) {
            return /^([a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)+$/.test(app);
        }
        // the app name is a bundleId assign it to the bundleId property
        if (!this.opts.bundleId && appIsPackageOrBundle(this.opts.app)) {
            this.opts.bundleId = this.opts.app;
            this.opts.app = '';
        }
        // we have a bundle ID, but no app, or app is also a bundle
        if (this.opts.bundleId &&
            appIsPackageOrBundle(this.opts.bundleId) &&
            (this.opts.app === '' || appIsPackageOrBundle(this.opts.app))) {
            this.log.debug('App is an iOS bundle, will attempt to run as pre-existing');
            return;
        }
        // check for supported build-in apps
        switch (lodash_1.default.toLower(this.opts.app)) {
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
            supportedExtensions: SUPPORTED_EXTENSIONS,
        });
    }
    /**
     * Unzip the given archive and find a matching .app bundle in it
     *
     * @param {string} appPath The path to the archive.
     * @param {number} depth [0] the current nesting depth. App bundles whose nesting level
     * is greater than 1 are not supported.
     * @returns {Promise<string>} Full path to the first matching .app bundle..
     * @throws If no matching .app bundles were found in the provided archive.
     */
    async unzipApp(appPath, depth = 0) {
        if (depth > MAX_ARCHIVE_SCAN_DEPTH) {
            throw new Error('Nesting of package bundles is not supported');
        }
        const [rootDir, matchedPaths] = await (0, app_utils_1.findApps)(appPath, SUPPORTED_EXTENSIONS);
        if (lodash_1.default.isEmpty(matchedPaths)) {
            this.log.debug(`'${node_path_1.default.basename(appPath)}' has no bundles`);
        }
        else {
            this.log.debug(`Found ${support_1.util.pluralize('bundle', matchedPaths.length, true)} in ` +
                `'${node_path_1.default.basename(appPath)}': ${matchedPaths}`);
        }
        try {
            for (const matchedPath of matchedPaths) {
                const fullPath = node_path_1.default.join(rootDir, matchedPath);
                if (await (0, app_utils_1.isAppBundle)(fullPath)) {
                    const supportedPlatforms = await (0, app_utils_1.fetchSupportedAppPlatforms)(fullPath);
                    if (this.isSimulator() && !supportedPlatforms.some((p) => lodash_1.default.includes(p, 'Simulator'))) {
                        this.log.info(`'${matchedPath}' does not have Simulator devices in the list of supported platforms ` +
                            `(${supportedPlatforms.join(',')}). Skipping it`);
                        continue;
                    }
                    if (this.isRealDevice() && !supportedPlatforms.some((p) => lodash_1.default.includes(p, 'OS'))) {
                        this.log.info(`'${matchedPath}' does not have real devices in the list of supported platforms ` +
                            `(${supportedPlatforms.join(',')}). Skipping it`);
                        continue;
                    }
                    this.log.info(`'${matchedPath}' is the resulting application bundle selected from '${appPath}'`);
                    return await (0, app_utils_1.isolateAppBundle)(fullPath);
                }
                else if (lodash_1.default.endsWith(lodash_1.default.toLower(fullPath), app_utils_1.IPA_EXT) && (await support_1.fs.stat(fullPath)).isFile()) {
                    try {
                        return await this.unzipApp(fullPath, depth + 1);
                    }
                    catch (e) {
                        this.log.warn(`Skipping processing of '${matchedPath}': ${e.message}`);
                    }
                }
            }
        }
        finally {
            await support_1.fs.rimraf(rootDir);
        }
        throw new Error(`${this.opts.app} did not have any matching ${app_utils_1.APP_EXT} or ${app_utils_1.IPA_EXT} ` +
            `bundles. Please make sure the provided package is valid and contains at least one matching ` +
            `application bundle which is not nested.`);
    }
    async onPostConfigureApp({ cachedAppInfo, isUrl, appPath }) {
        // Pick the previously cached entry if its integrity has been preserved
        if (lodash_1.default.isPlainObject(cachedAppInfo) &&
            (await support_1.fs.stat(appPath)).isFile() &&
            (await support_1.fs.hash(appPath)) === cachedAppInfo.packageHash &&
            (await support_1.fs.exists(cachedAppInfo.fullPath)) &&
            (await support_1.fs.glob('**/*', {
                cwd: cachedAppInfo.fullPath,
            })).length === cachedAppInfo.integrity.folder) {
            this.log.info(`Using '${cachedAppInfo.fullPath}' which was cached from '${appPath}'`);
            return { appPath: cachedAppInfo.fullPath };
        }
        // Only local .app bundles that are available in-place should not be cached
        if (await (0, app_utils_1.isAppBundle)(appPath)) {
            return false;
        }
        // Extract the app bundle and cache it
        try {
            return { appPath: await this.unzipApp(appPath) };
        }
        finally {
            // Cleanup previously downloaded archive
            if (isUrl) {
                await support_1.fs.rimraf(appPath);
            }
        }
    }
    async determineDevice() {
        // in the one case where we create a sim, we will set this state
        this.lifecycleData.createSim = false;
        // if we get generic names, translate them
        this.opts.deviceName = (0, utils_1.translateDeviceName)(this.opts.platformVersion, this.opts.deviceName);
        const setupVersionCaps = async () => {
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            this.opts.iosSdkVersion = await (0, utils_1.getAndCheckIosSdkVersion)();
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            this.log.info(`iOS SDK Version set to '${this.opts.iosSdkVersion}'`);
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            if (!this.opts.platformVersion && this.opts.iosSdkVersion) {
                this.log.info(
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                `No platformVersion specified. Using the latest version Xcode supports: '${this.opts.iosSdkVersion}'. ` +
                    `This may cause problems if a simulator does not exist for this platform version.`);
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                this.opts.platformVersion = (0, utils_1.normalizePlatformVersion)(this.opts.iosSdkVersion);
            }
        };
        if (this.opts.udid) {
            if (this.opts.udid.toLowerCase() === utils_1.UDID_AUTO) {
                try {
                    this.opts.udid = await (0, utils_1.detectUdid)();
                }
                catch (err) {
                    // Trying to find matching UDID for Simulator
                    this.log.warn(`Cannot detect any connected real devices. Falling back to Simulator. Original error: ${err.message}`);
                    await setupVersionCaps();
                    // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                    const device = await (0, simulator_management_1.getExistingSim)(this.opts);
                    if (!device) {
                        // No matching Simulator is found. Throw an error
                        this.log.errorAndThrow(`Cannot detect udid for ${this.opts.deviceName} Simulator running iOS ${this.opts.platformVersion}`);
                    }
                    this.opts.udid = device.udid;
                    return { device, realDevice: false, udid: device.udid };
                }
            }
            else {
                // make sure it is a connected device. If not, the udid passed in is invalid
                const devices = await (0, real_device_management_1.getConnectedDevices)();
                this.log.debug(`Available devices: ${devices.join(', ')}`);
                if (!devices.includes(this.opts.udid)) {
                    // check for a particular simulator
                    this.log.debug(`No real device with udid '${this.opts.udid}'. Looking for a simulator`);
                    try {
                        const device = await (0, appium_ios_simulator_1.getSimulator)(this.opts.udid, {
                            devicesSetPath: this.opts.simulatorDevicesSetPath,
                        });
                        return { device, realDevice: false, udid: this.opts.udid };
                    }
                    catch (ign) {
                        throw new Error(`Unknown device or simulator UDID: '${this.opts.udid}'`);
                    }
                }
            }
            const device = (0, real_device_management_1.getRealDeviceObj)(this.opts.udid);
            return { device, realDevice: true, udid: this.opts.udid };
        }
        this.log.info(`No real device udid has been provided in capabilities. ` +
            `Will select a matching simulator to run the test.`);
        await setupVersionCaps();
        if (this.opts.enforceFreshSimulatorCreation) {
            this.log.debug(`New simulator is requested. If this is not wanted, set 'enforceFreshSimulatorCreation' capability to false`);
        }
        else {
            // figure out the correct simulator to use, given the desired capabilities
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            const device = await (0, simulator_management_1.getExistingSim)(this.opts);
            // check for an existing simulator
            if (device) {
                return { device, realDevice: false, udid: device.udid };
            }
        }
        // no device of this type exists, or they request new sim, so create one
        this.log.info('Using desired caps to create a new simulator');
        const device = await this.createSim();
        return { device, realDevice: false, udid: device.udid };
    }
    async startSim() {
        const runOpts = {
            scaleFactor: this.opts.scaleFactor,
            connectHardwareKeyboard: !!this.opts.connectHardwareKeyboard,
            pasteboardAutomaticSync: this.opts.simulatorPasteboardAutomaticSync ?? 'off',
            isHeadless: !!this.opts.isHeadless,
            tracePointer: this.opts.simulatorTracePointer,
            devicePreferences: {},
        };
        // add the window center, if it is specified
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        if (this.opts.SimulatorWindowCenter) {
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            runOpts.devicePreferences.SimulatorWindowCenter = this.opts.SimulatorWindowCenter;
        }
        if (lodash_1.default.isInteger(this.opts.simulatorStartupTimeout)) {
            runOpts.startupTimeout = this.opts.simulatorStartupTimeout;
        }
        // This is to workaround XCTest bug about changing Simulator
        // orientation is not synchronized to the actual window orientation
        const orientation = lodash_1.default.isString(this.opts.orientation) && this.opts.orientation.toUpperCase();
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
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        await this.opts.device.run(runOpts);
    }
    async createSim() {
        this.lifecycleData.createSim = true;
        // create sim for caps
        const sim = await (0, simulator_management_1.createSim)(this.opts);
        this.log.info(`Created simulator with udid '${sim.udid}'.`);
        return sim;
    }
    async startWdaSession(bundleId, processArguments) {
        const args = processArguments ? processArguments.args || [] : [];
        if (!lodash_1.default.isArray(args)) {
            throw new Error(`processArguments.args capability is expected to be an array. ` +
                `${JSON.stringify(args)} is given instead`);
        }
        const env = processArguments ? processArguments.env || {} : {};
        if (!lodash_1.default.isPlainObject(env)) {
            throw new Error(`processArguments.env capability is expected to be a dictionary. ` +
                `${JSON.stringify(env)} is given instead`);
        }
        if (support_1.util.hasValue(this.opts.language)) {
            args.push('-AppleLanguages', `(${this.opts.language})`);
            args.push('-NSLanguages', `(${this.opts.language})`);
        }
        if (support_1.util.hasValue(this.opts.locale)) {
            args.push('-AppleLocale', this.opts.locale);
        }
        if (this.opts.noReset) {
            if (lodash_1.default.isNil(this.opts.shouldTerminateApp)) {
                this.opts.shouldTerminateApp = false;
            }
            if (lodash_1.default.isNil(this.opts.forceAppLaunch)) {
                this.opts.forceAppLaunch = false;
            }
        }
        /** @type {WDACapabilities} */
        const wdaCaps = /** @type {any} */ ({
            bundleId: this.opts.autoLaunch === false ? undefined : bundleId,
            arguments: args,
            environment: env,
            eventloopIdleDelaySec: this.opts.wdaEventloopIdleDelay ?? 0,
            shouldWaitForQuiescence: this.opts.waitForQuiescence ?? true,
            shouldUseTestManagerForVisibilityDetection: this.opts.simpleIsVisibleCheck ?? false,
            maxTypingFrequency: this.opts.maxTypingFrequency ?? 60,
            shouldUseSingletonTestManager: this.opts.shouldUseSingletonTestManager ?? true,
            waitForIdleTimeout: this.opts.waitForIdleTimeout,
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            shouldUseCompactResponses: this.opts.shouldUseCompactResponses,
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            elementResponseFields: this.opts.elementResponseFields,
            disableAutomaticScreenshots: this.opts.disableAutomaticScreenshots,
            shouldTerminateApp: this.opts.shouldTerminateApp ?? true,
            forceAppLaunch: this.opts.forceAppLaunch ?? true,
            useNativeCachingStrategy: this.opts.useNativeCachingStrategy ?? true,
            forceSimulatorSoftwareKeyboardPresence: 
            // @ts-expect-error - do not assign arbitrary properties to `this.opts`
            this.opts.forceSimulatorSoftwareKeyboardPresence ??
                (this.opts.connectHardwareKeyboard === true ? false : true),
        });
        if (this.opts.autoAcceptAlerts) {
            wdaCaps.defaultAlertAction = 'accept';
        }
        else if (this.opts.autoDismissAlerts) {
            wdaCaps.defaultAlertAction = 'dismiss';
        }
        await this.proxyCommand('/session', 'POST', {
            capabilities: {
                firstMatch: [wdaCaps],
                alwaysMatch: {},
            },
        });
    }
    // Override Proxy methods from BaseDriver
    proxyActive() {
        return Boolean(this.jwpProxyActive);
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
    /**
     *
     * @returns {boolean}
     */
    isRealDevice() {
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        return Boolean(this.opts.realDevice);
    }
    isSimulator() {
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        return !this.opts.realDevice;
    }
    validateLocatorStrategy(strategy) {
        super.validateLocatorStrategy(strategy, this.isWebContext());
    }
    /**
     *
     * @param {any} caps
     * @returns {caps is import('@appium/types').DriverCaps<XCUITestDriverConstraints>}
     */
    validateDesiredCaps(caps) {
        if (!super.validateDesiredCaps(caps)) {
            return false;
        }
        // make sure that the capabilities have one of `app` or `bundleId`
        if (lodash_1.default.toLower(caps.browserName) !== 'safari' && !caps.app && !caps.bundleId) {
            this.log.info('The desired capabilities include neither an app nor a bundleId. ' +
                'WebDriverAgent will be started without the default app');
        }
        if (!support_1.util.coerceVersion(String(caps.platformVersion), false)) {
            this.log.warn(`'platformVersion' capability ('${caps.platformVersion}') is not a valid version number. ` +
                `Consider fixing it or be ready to experience an inconsistent driver behavior.`);
        }
        let verifyProcessArgument = (processArguments) => {
            const { args, env } = processArguments;
            if (!lodash_1.default.isNil(args) && !lodash_1.default.isArray(args)) {
                this.log.errorAndThrow('processArguments.args must be an array of strings');
            }
            if (!lodash_1.default.isNil(env) && !lodash_1.default.isPlainObject(env)) {
                this.log.errorAndThrow('processArguments.env must be an object <key,value> pair {a:b, c:d}');
            }
        };
        // `processArguments` should be JSON string or an object with arguments and/ environment details
        if (caps.processArguments) {
            if (lodash_1.default.isString(caps.processArguments)) {
                try {
                    // try to parse the string as JSON
                    caps.processArguments = JSON.parse(caps.processArguments);
                    verifyProcessArgument(caps.processArguments);
                }
                catch (err) {
                    this.log.errorAndThrow(`processArguments must be a JSON format or an object with format {args : [], env : {a:b, c:d}}. ` +
                        `Both environment and argument can be null. Error: ${err}`);
                }
            }
            else if (lodash_1.default.isPlainObject(caps.processArguments)) {
                verifyProcessArgument(caps.processArguments);
            }
            else {
                this.log.errorAndThrow(`'processArguments must be an object, or a string JSON object with format {args : [], env : {a:b, c:d}}. ` +
                    `Both environment and argument can be null.`);
            }
        }
        // there is no point in having `keychainPath` without `keychainPassword`
        if ((caps.keychainPath && !caps.keychainPassword) ||
            (!caps.keychainPath && caps.keychainPassword)) {
            this.log.errorAndThrow(`If 'keychainPath' is set, 'keychainPassword' must also be set (and vice versa).`);
        }
        // `resetOnSessionStartOnly` should be set to true by default
        this.opts.resetOnSessionStartOnly =
            !support_1.util.hasValue(this.opts.resetOnSessionStartOnly) || this.opts.resetOnSessionStartOnly;
        this.opts.useNewWDA = support_1.util.hasValue(this.opts.useNewWDA) ? this.opts.useNewWDA : false;
        if (caps.commandTimeouts) {
            caps.commandTimeouts = (0, utils_1.normalizeCommandTimeouts)(caps.commandTimeouts);
        }
        if (lodash_1.default.isString(caps.webDriverAgentUrl)) {
            const { protocol, host } = node_url_1.default.parse(caps.webDriverAgentUrl);
            if (lodash_1.default.isEmpty(protocol) || lodash_1.default.isEmpty(host)) {
                this.log.errorAndThrow(`'webDriverAgentUrl' capability is expected to contain a valid WebDriverAgent server URL. ` +
                    `'${caps.webDriverAgentUrl}' is given instead`);
            }
        }
        if (caps.browserName) {
            if (caps.bundleId) {
                this.log.errorAndThrow(`'browserName' cannot be set together with 'bundleId' capability`);
            }
            // warn if the capabilities have both `app` and `browser, although this
            // is common with selenium grid
            if (caps.app) {
                this.log.warn(`The capabilities should generally not include both an 'app' and a 'browserName'`);
            }
        }
        if (caps.permissions) {
            try {
                for (const [bundleId, perms] of lodash_1.default.toPairs(JSON.parse(caps.permissions))) {
                    if (!lodash_1.default.isString(bundleId)) {
                        throw new Error(`'${JSON.stringify(bundleId)}' must be a string`);
                    }
                    if (!lodash_1.default.isPlainObject(perms)) {
                        throw new Error(`'${JSON.stringify(perms)}' must be a JSON object`);
                    }
                }
            }
            catch (e) {
                this.log.errorAndThrow(`'${caps.permissions}' is expected to be a valid object with format ` +
                    `{"<bundleId1>": {"<serviceName1>": "<serviceStatus1>", ...}, ...}. Original error: ${e.message}`);
            }
        }
        if (caps.platformVersion && !support_1.util.coerceVersion(caps.platformVersion, false)) {
            this.log.errorAndThrow(`'platformVersion' must be a valid version number. ` +
                `'${caps.platformVersion}' is given instead.`);
        }
        // additionalWebviewBundleIds is an array, JSON array, or string
        if (caps.additionalWebviewBundleIds) {
            caps.additionalWebviewBundleIds = this.helpers.parseCapsArray(caps.additionalWebviewBundleIds);
        }
        // finally, return true since the superclass check passed, as did this
        return true;
    }
    async checkAutInstallationState() {
        // @ts-expect-error - do not assign arbitrary properties to `this.opts`
        const { enforceAppInstall, fullReset, noReset, bundleId, device, app } = this.opts;
        const wasAppInstalled = await device.isAppInstalled(bundleId);
        if (wasAppInstalled) {
            this.log.info(`App '${bundleId}' is already installed`);
            if (noReset) {
                this.log.info('noReset is requested. The app will not be be (re)installed');
                return {
                    install: false,
                    skipUninstall: true,
                };
            }
        }
        else {
            this.log.info(`App '${bundleId}' is not installed yet or it has an offload and ` +
                'cannot be detected, which might keep the local data.');
        }
        if (enforceAppInstall !== false || fullReset || !wasAppInstalled) {
            return {
                install: true,
                skipUninstall: !wasAppInstalled,
            };
        }
        const candidateBundleVersion = await app_utils_1.extractBundleVersion.bind(this)(app);
        this.log.debug(`CFBundleVersion from Info.plist: ${candidateBundleVersion}`);
        if (!candidateBundleVersion) {
            return {
                install: true,
                skipUninstall: false,
            };
        }
        const appBundleVersion = this.isRealDevice()
            ? (await device.fetchAppInfo(bundleId))?.CFBundleVersion
            : BUNDLE_VERSION_PATTERN.exec(await device.simctl.appInfo(bundleId))?.[1];
        this.log.debug(`CFBundleVersion from installed app info: ${appBundleVersion}`);
        if (!appBundleVersion) {
            return {
                install: true,
                skipUninstall: false,
            };
        }
        let shouldUpgrade;
        try {
            shouldUpgrade = support_1.util.compareVersions(candidateBundleVersion, '>', appBundleVersion);
        }
        catch (err) {
            this.log.warn(`App versions comparison is not possible: ${err.message}`);
            return {
                install: true,
                skipUninstall: false,
            };
        }
        if (shouldUpgrade) {
            this.log.info(`The installed version of ${bundleId} is lower than the candidate one ` +
                `(${candidateBundleVersion} > ${appBundleVersion}). The app will be upgraded.`);
        }
        else {
            this.log.info(`The candidate version of ${bundleId} is lower than the installed one ` +
                `(${candidateBundleVersion} <= ${appBundleVersion}). The app won't be reinstalled.`);
        }
        return {
            install: shouldUpgrade,
            skipUninstall: true,
        };
    }
    async installAUT() {
        // install any other apps
        if (this.opts.otherApps) {
            await this.installOtherApps(this.opts.otherApps);
        }
        if (this.isSafari() || !this.opts.app) {
            return;
        }
        await app_utils_1.verifyApplicationPlatform.bind(this)(this.opts.app, {
            isSimulator: this.isSimulator(),
            isTvOS: (0, utils_1.isTvOs)(this.opts.platformName),
        });
        const { install, skipUninstall } = await this.checkAutInstallationState();
        if (install) {
            if (this.isRealDevice()) {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                await (0, real_device_management_1.installToRealDevice)(this.opts.device, this.opts.app, this.opts.bundleId, {
                    skipUninstall,
                    timeout: this.opts.appPushTimeout,
                    strategy: this.opts.appInstallStrategy,
                });
            }
            else {
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                await (0, simulator_management_1.installToSimulator)(this.opts.device, this.opts.app, this.opts.bundleId, {
                    skipUninstall,
                    newSimulator: this.lifecycleData?.createSim,
                });
            }
            if (support_1.util.hasValue(this.opts.iosInstallPause)) {
                // https://github.com/appium/appium/issues/6889
                const pauseMs = parseInt(this.opts.iosInstallPause, 10);
                this.log.debug(`iosInstallPause set. Pausing ${pauseMs} ms before continuing`);
                await bluebird_1.default.delay(pauseMs);
            }
            this.logEvent('appInstalled');
        }
    }
    async installOtherApps(otherApps) {
        /** @type {string[]|undefined} */
        let appsList;
        try {
            appsList = this.helpers.parseCapsArray(otherApps);
        }
        catch (e) {
            this.log.errorAndThrow(`Could not parse "otherApps" capability: ${e.message}`);
        }
        if (!appsList || !appsList.length) {
            this.log.info(`Got zero apps from 'otherApps' capability value. Doing nothing`);
            return;
        }
        /** @type {string[]} */
        const appPaths = await bluebird_1.default.all(appsList.map((app) => this.helpers.configureApp(app, '.app')));
        /** @type {string[]} */
        const appIds = await bluebird_1.default.all(appPaths.map((appPath) => app_utils_1.extractBundleId.bind(this)(appPath)));
        for (const [appId, appPath] of lodash_1.default.zip(appIds, appPaths)) {
            if (this.isRealDevice()) {
                await (0, real_device_management_1.installToRealDevice)(
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                this.opts.device, appPath, appId, {
                    skipUninstall: true,
                    timeout: this.opts.appPushTimeout,
                    strategy: this.opts.appInstallStrategy,
                });
            }
            else {
                await (0, simulator_management_1.installToSimulator)(
                // @ts-expect-error - do not assign arbitrary properties to `this.opts`
                this.opts.device, 
                // @ts-ignore the path should always be defined
                appPath, appId, {
                    newSimulator: this.lifecycleData.createSim,
                });
            }
        }
    }
    async setInitialOrientation(orientation) {
        const dstOrientation = lodash_1.default.toUpper(orientation);
        if (!SUPPORTED_ORIENATIONS.includes(dstOrientation)) {
            this.log.debug(`The initial orientation value '${orientation}' is unknown. ` +
                `Only ${JSON.stringify(SUPPORTED_ORIENATIONS)} are supported.`);
            return;
        }
        this.log.debug(`Setting initial orientation to '${dstOrientation}'`);
        try {
            await this.proxyCommand('/orientation', 'POST', { orientation: dstOrientation });
        }
        catch (err) {
            this.log.warn(`Setting initial orientation failed with: ${err.message}`);
        }
    }
    _getCommandTimeout(cmdName) {
        if (this.opts.commandTimeouts) {
            if (cmdName && lodash_1.default.has(this.opts.commandTimeouts, cmdName)) {
                return this.opts.commandTimeouts[cmdName];
            }
            return this.opts.commandTimeouts[utils_1.DEFAULT_TIMEOUT_KEY];
        }
    }
    /**
     * Reset the current session (run the delete session and create session subroutines)
     */
    // eslint-disable-next-line require-await
    async reset() {
        throw new Error(`The reset API has been deprecated and is not supported anymore. ` +
            `Consider using corresponding 'mobile:' extensions to manage the state of the app under test.`);
    }
}
exports.XCUITestDriver = XCUITestDriver;
XCUITestDriver.newMethodMap = method_map_1.newMethodMap;
XCUITestDriver.executeMethodMap = execute_method_map_1.executeMethodMap;
exports.default = XCUITestDriver;
/**
 * @template {import('@appium/types').Constraints} C
 * @template [Ctx=string]
 * @typedef {import('@appium/types').ExternalDriver<C, Ctx>} ExternalDriver
 */
/**
 * @typedef {typeof desiredCapConstraints} XCUITestDriverConstraints
 * @typedef {import('@appium/types').DriverOpts<XCUITestDriverConstraints>} XCUITestDriverOpts
 * @typedef {import('./commands/types').FullContext} FullContext
 * @typedef {import('./types').WDACapabilities} WDACapabilities
 * @typedef {import('appium-xcode').XcodeVersion} XcodeVersion
 */
//# sourceMappingURL=driver.js.map